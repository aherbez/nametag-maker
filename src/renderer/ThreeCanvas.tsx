import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type {
  BedSettings,
  BuildResult,
  MeshData,
  NameList,
  NametagParams,
  TagColors,
} from "../shared/types";
import { layoutTags } from "./layout";
import { createTagMaterial } from "./tagMaterial";

/** What the sidebar shows about the latest build. */
export interface BuildSummary {
  warnings: string[];
  /** The plate's calculated width (single tag only). */
  width?: number;
  /** Counts for a batch built from a name list. */
  batch?: { tags: number; beds: number };
  error?: string;
}

/** Progress of the build in flight, or null when idle. */
export type BuildProgress = { done: number; total: number } | null;

/**
 * Everything a build depends on. A new object means a new build; App
 * memoizes it so unrelated re-renders don't trigger one.
 */
export interface BuildJob {
  params: NametagParams;
  /** Build one tag per name, laid out on print beds; null for one tag. */
  names: NameList | null;
  bed: BedSettings;
}

// Space between print beds when several are shown side by side.
const BED_GAP = 30;

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

function disposeChildren(group: THREE.Group) {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
    }
  }
  group.clear();
}

const bedFillMaterial = new THREE.MeshBasicMaterial({ color: 0x25253d });
const bedLineMaterial = new THREE.LineBasicMaterial({ color: 0x6a6a8a });

/** A flat outline of a print bed, centered at (cx, 0, 0). */
function makeBedOutline(bed: BedSettings, cx: number): THREE.Object3D {
  const outline = new THREE.Group();
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(bed.width, bed.height),
    bedFillMaterial,
  );
  fill.rotation.x = -Math.PI / 2;
  // Just below the tags' bottom faces so they don't fight for depth.
  fill.position.set(cx, -0.05, 0);
  const hw = bed.width / 2;
  const hh = bed.height / 2;
  const line = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(cx - hw, 0, -hh),
      new THREE.Vector3(cx + hw, 0, -hh),
      new THREE.Vector3(cx + hw, 0, hh),
      new THREE.Vector3(cx - hw, 0, hh),
    ]),
    bedLineMaterial,
  );
  outline.add(fill, line);
  return outline;
}

/**
 * Collapse per-tag warnings: one that applies to every tag is shown once;
 * others list the names they apply to.
 */
function summarizeWarnings(
  byWarning: Map<string, string[]>,
  tagCount: number,
): string[] {
  return [...byWarning].map(([warning, names]) => {
    if (names.length === tagCount) return warning;
    const shown = names.slice(0, 3).map((n) => `“${n}”`).join(", ");
    const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
    return `${shown}${more}: ${warning}`;
  });
}

/** Export a set of meshes as one binary STL, rotated so Z is up. */
function exportStl(meshes: THREE.Object3D[], offsetX = 0): ArrayBuffer {
  // The scene is Y-up but slicers expect Z-up: rotate so the plates lie
  // flat with the text reading correctly from above.
  const zUp = new THREE.Group();
  zUp.rotation.x = Math.PI / 2;
  for (const mesh of meshes) {
    const copy = mesh.clone();
    copy.position.x -= offsetX;
    zUp.add(copy);
  }
  zUp.updateMatrixWorld(true);
  const result = new STLExporter().parse(zUp, { binary: true });
  return result.buffer as ArrayBuffer;
}

interface ThreeCanvasProps {
  job: BuildJob;
  colors: TagColors;
  onProgress: (progress: BuildProgress) => void;
  /** Called after each build (and as a batch progresses) with its outcome. */
  onBuildResult: (summary: BuildSummary) => void;
}

export default function ThreeCanvas({
  job,
  colors,
  onProgress,
  onBuildResult,
}: ThreeCanvasProps) {
  const [tagMaterial] = useState(createTagMaterial);
  const containerRef = useRef<HTMLDivElement>(null);
  // Tags go in one group and bed outlines in another, so exports only ever
  // see tags.
  const [groups, setGroups] = useState<{
    tags: THREE.Group;
    beds: THREE.Group;
  }>();
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const controlsRef = useRef<OrbitControls>(null);

  // Builds run one at a time. A job that changes mid-build is picked up as
  // soon as the current step finishes; stale results are dropped.
  const latestJob = useRef(job);
  latestJob.current = job;
  const building = useRef(false);
  // Auto-framing stops once the user has moved the camera themselves (and
  // resumes when a new name list is loaded).
  const userMovedCamera = useRef(false);
  // Built tags by name, valid for one set of params. Lets a bed-size change
  // (or reloading an overlapping list) re-lay out without rebuilding.
  const batchCache = useRef<{
    params: NametagParams | null;
    results: Map<string, BuildResult>;
  }>({ params: null, results: new Map() });
  // What's currently on screen, for export.
  const shown = useRef<
    | { kind: "single"; text: string }
    | { kind: "batch"; baseName: string; beds: number; bed: BedSettings }
    | null
  >(null);

  useEffect(() => {
    if (!groups || building.current) return;
    const { tags: tagGroup, beds: bedGroup } = groups;

    function frameCamera() {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera || !controls || userMovedCamera.current) return;
      const box = new THREE.Box3().setFromObject(tagGroup);
      if (bedGroup.children.length > 0) box.expandByObject(bedGroup);
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

    async function buildSingle(j: BuildJob) {
      onProgress({ done: 0, total: 1 });
      try {
        const result = await window.electronAPI.buildNametag(j.params);
        if (j !== latestJob.current) return;
        disposeChildren(tagGroup);
        disposeChildren(bedGroup);
        tagGroup.add(meshDataToThree(result.mesh, tagMaterial.material));
        tagMaterial.setBaseHeight(j.params.thickness);
        shown.current = { kind: "single", text: j.params.text };
        onBuildResult({ warnings: result.warnings, width: result.width });
        frameCamera();
      } catch (e) {
        if (j !== latestJob.current) return;
        onBuildResult({
          warnings: [],
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    async function buildBatch(j: BuildJob, list: NameList) {
      const { names } = list;
      disposeChildren(tagGroup);
      disposeChildren(bedGroup);
      tagMaterial.setBaseHeight(j.params.thickness);
      shown.current = null;

      const meshes: THREE.Mesh[] = [];
      const widths: number[] = [];
      const warnings = new Map<string, string[]>();
      const warn = (w: string, name: string) =>
        warnings.set(w, [...(warnings.get(w) ?? []), name]);
      let beds = 0;

      // Re-place every tag built so far. Each new tag can change how its
      // bed's block is centered, so earlier positions shift too.
      const relayout = () => {
        const layout = layoutTags(widths, j.params.depth, j.bed);
        beds = layout.beds;
        layout.placements.forEach((place, i) => {
          meshes[i].visible = place !== null;
          if (!place) return;
          const bedX = place.bed * (j.bed.width + BED_GAP);
          meshes[i].position.set(bedX + place.x, 0, place.z);
          meshes[i].userData.bed = place.bed;
        });
        while (bedGroup.children.length < beds) {
          const b = bedGroup.children.length;
          bedGroup.add(makeBedOutline(j.bed, b * (j.bed.width + BED_GAP)));
        }
      };

      if (batchCache.current.params !== j.params) {
        batchCache.current = { params: j.params, results: new Map() };
      }
      const cache = batchCache.current.results;

      for (let i = 0; i < names.length; i++) {
        if (j !== latestJob.current) return;
        onProgress({ done: i, total: names.length });
        let result = cache.get(names[i]);
        if (!result) {
          try {
            result = await window.electronAPI.buildNametag({
              ...j.params,
              text: names[i],
            });
          } catch {
            warn("Couldn't be built.", names[i]);
            continue;
          }
          cache.set(names[i], result);
        }
        if (j !== latestJob.current) return;
        for (const w of result.warnings) warn(w, names[i]);
        const mesh = meshDataToThree(result.mesh, tagMaterial.material);
        mesh.userData.name = names[i];
        meshes.push(mesh);
        widths.push(result.width);
        tagGroup.add(mesh);
        relayout();
        frameCamera();
      }

      const placed = meshes.filter((m) => m.visible).length;
      if (placed < meshes.length) {
        meshes
          .filter((m) => !m.visible)
          .forEach((m) =>
            warn(
              `Too big for the ${j.bed.width} × ${j.bed.height} mm bed; left out.`,
              m.userData.name,
            ),
          );
      }
      shown.current = { kind: "batch", baseName: list.baseName, beds, bed: j.bed };
      onBuildResult({
        warnings: summarizeWarnings(warnings, names.length),
        batch: { tags: placed, beds },
      });
    }

    async function buildLatest() {
      building.current = true;
      let built: BuildJob | null = null;
      while (built !== latestJob.current) {
        const j: BuildJob = latestJob.current;
        // A newly loaded list gets framed even if the camera was moved.
        if (j.names !== built?.names) userMovedCamera.current = false;
        built = j;
        if (j.names) await buildBatch(j, j.names);
        else await buildSingle(j);
      }
      building.current = false;
      onProgress(null);
    }

    buildLatest();
  }, [groups, job]);

  // Colors are display-only, so they apply immediately without a rebuild.
  useEffect(() => {
    tagMaterial.setColors(colors.base, colors.relief);
  }, [tagMaterial, colors]);

  // Listen for "Export as STL" from the File menu (or the Save button).
  useEffect(() => {
    if (!groups) return;
    const handleExport = () => {
      const current = shown.current;
      if (!current || building.current) return;
      if (current.kind === "single") {
        const name = current.text.trim().replace(/[^\w-]+/g, "_") || "nametag";
        window.electronAPI.saveSTL(
          exportStl(groups.tags.children),
          `nametag_${name}.stl`,
        );
        return;
      }
      // One STL per bed, each positioned relative to its bed's center.
      const buffers: ArrayBuffer[] = [];
      for (let b = 0; b < current.beds; b++) {
        const onBed = groups.tags.children.filter(
          (m) => m.visible && m.userData.bed === b,
        );
        buffers.push(exportStl(onBed, b * (current.bed.width + BED_GAP)));
      }
      window.electronAPI.saveSTLBatch(buffers, current.baseName);
    };
    return window.electronAPI.onExportSTL(handleExport);
  }, [groups]);

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
        // Far enough to frame several print beds side by side.
        10000,
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

      const tagGroup = new THREE.Group();
      const bedGroup = new THREE.Group();
      scene.add(tagGroup, bedGroup);

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

      setGroups({ tags: tagGroup, beds: bedGroup });
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
