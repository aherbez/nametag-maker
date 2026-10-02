import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { MeshData, NametagParams, TagColors } from "../shared/types";
import { createTagMaterial } from "./tagMaterial";

/** What the sidebar shows about the latest build. */
export interface BuildSummary {
  warnings: string[];
  /** The plate's calculated width; absent if the build failed. */
  width?: number;
  error?: string;
}

function meshDataToThree(
  data: MeshData,
  material: THREE.Material,
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(new Float32Array(data.vertices), 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(new Float32Array(data.normals), 3),
  );
  geometry.setIndex(
    new THREE.BufferAttribute(new Uint32Array(data.indices), 1),
  );
  geometry.computeBoundingBox();
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

interface ThreeCanvasProps {
  params: NametagParams;
  colors: TagColors;
  onLoadingChange: (loading: boolean) => void;
  /** Called after each rebuild with its outcome. */
  onBuildResult: (summary: BuildSummary) => void;
}

export default function ThreeCanvas({
  params,
  colors,
  onLoadingChange,
  onBuildResult,
}: ThreeCanvasProps) {
  const [tagMaterial] = useState(createTagMaterial);
  const containerRef = useRef<HTMLDivElement>(null);
  const [group, setGroup] = useState<THREE.Group>();
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const controlsRef = useRef<OrbitControls>(null);

  // Builds run one at a time. Params that change mid-build are picked up
  // when it finishes; results for params that have since changed are
  // dropped rather than shown.
  const latestParams = useRef(params);
  latestParams.current = params;
  const building = useRef(false);
  // Auto-framing stops once the user has moved the camera themselves.
  const userMovedCamera = useRef(false);

  useEffect(() => {
    if (!group || building.current) return;

    function frameCamera() {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls || userMovedCamera.current) return;
      const box = new THREE.Box3().setFromObject(group!);
      const center = box.getCenter(new THREE.Vector3());
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const fov = camera.fov * (Math.PI / 180);
      const distance = sphere.radius / Math.sin(fov / 2);
      // Look down at the plate from slightly in front of it.
      camera.position
        .copy(center)
        .add(new THREE.Vector3(0, distance * 0.8, distance * 0.6));
      controls.target.copy(center);
      controls.update();
    }

    async function buildLatest() {
      building.current = true;
      onLoadingChange(true);
      let built: NametagParams | null = null;
      while (built !== latestParams.current) {
        const p: NametagParams = latestParams.current;
        built = p;
        try {
          const result = await window.electronAPI.buildNametag(p);
          if (p !== latestParams.current) continue;
          group!.clear();
          group!.add(meshDataToThree(result.mesh, tagMaterial.material));
          tagMaterial.setBaseHeight(p.thickness);
          onBuildResult({ warnings: result.warnings, width: result.width });
          frameCamera();
        } catch (e) {
          if (p !== latestParams.current) continue;
          onBuildResult({
            warnings: [],
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      building.current = false;
      onLoadingChange(false);
    }

    buildLatest();
  }, [group, params]);

  // Colors are display-only, so they apply immediately without a rebuild.
  useEffect(() => {
    tagMaterial.setColors(colors.base, colors.relief);
  }, [tagMaterial, colors]);

  // Listen for "Export as STL" from the File menu
  useEffect(() => {
    if (!group) return;
    const handleExport = () => {
      // The scene is Y-up but slicers expect Z-up: rotate so the plate lies
      // flat with the text reading correctly from above.
      const zUp = new THREE.Group();
      zUp.rotation.x = Math.PI / 2;
      for (const child of group.children) zUp.add(child.clone());
      zUp.updateMatrixWorld(true);

      const exporter = new STLExporter();
      const result = exporter.parse(zUp, { binary: true });
      const name = params.text.trim().replace(/[^\w-]+/g, "_") || "nametag";
      window.electronAPI.saveSTL(
        result.buffer as ArrayBuffer,
        `nametag_${name}.stl`,
      );
    };
    const cleanup = window.electronAPI.onExportSTL(handleExport);
    return cleanup;
  }, [group, params]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let animationId: number;
    let rendererInstance: THREE.WebGLRenderer | null = null;
    let controlsInstance: OrbitControls | null = null;
    let resizeHandler: (() => void) | null = null;

    async function init() {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1a2e);

      const camera = new THREE.PerspectiveCamera(
        75,
        container!.clientWidth / container!.clientHeight,
        0.1,
        1000,
      );
      camera.position.set(-2, 1.5, 2);
      camera.lookAt(0.5, 0.5, 0.5);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(container!.clientWidth, container!.clientHeight);
      renderer.setPixelRatio(window.devicePixelRatio);
      container!.appendChild(renderer.domElement);
      rendererInstance = renderer;

      // Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
      scene.add(ambientLight);
      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
      directionalLight.position.set(5, 5, 5);
      scene.add(directionalLight);

      // Orbit controls
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.target.set(0.5, 0.5, 0.5);
      controls.update();
      // "start" fires only for user interaction, not programmatic moves.
      controls.addEventListener("start", () => {
        userMovedCamera.current = true;
      });
      controlsInstance = controls;

      cameraRef.current = camera;
      controlsRef.current = controls;

      const modelGroup = new THREE.Group();
      scene.add(modelGroup);

      // Start render loop (shows empty scene while OpenCascade loads)
      function animate() {
        if (cancelled) return;
        animationId = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      }
      animate();

      const onResize = () => {
        camera.aspect = container!.clientWidth / container!.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container!.clientWidth, container!.clientHeight);
      };
      window.addEventListener("resize", onResize);
      resizeHandler = onResize;

      setGroup(modelGroup);
    }

    init();

    return () => {
      cancelled = true;
      if (animationId) cancelAnimationFrame(animationId);
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      controlsInstance?.dispose();
      if (rendererInstance) {
        rendererInstance.dispose();
        container.removeChild(rendererInstance.domElement);
      }
    };
  }, []);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}
