import { ipcMain } from "electron";
import path from "path";
import type { BuildResult, MeshData, NametagParams } from "../shared/types";
import { buildNametag } from "./nametag";
import { resolveFont } from "./settings";

// OpenCascade is loaded once and cached for the lifetime of the process.
// Uses dynamic import() because the package is ESM ("type": "module").
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ocPromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getOC(): Promise<any> {
  if (!ocPromise) {
    // Vite bundles the Emscripten glue code into out/main/, but the WASM file
    // stays in node_modules. Resolve the real path at runtime so the Emscripten
    // runtime can find it.
    const pkgDir = path.dirname(require.resolve("opencascade.js/package.json"));
    const wasmPath = path.join(pkgDir, "dist", "opencascade.full.wasm");
    ocPromise = import("opencascade.js/dist/node.js").then((mod) =>
      mod.default({ mainWasm: wasmPath }),
    );
  }
  return ocPromise;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeToMesh(oc: any, shape: any): MeshData {
  new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.1, false);

  const vertices: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  const faceExplorer = new oc.TopExp_Explorer_2(
    shape,
    oc.TopAbs_ShapeEnum.TopAbs_FACE,
    oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
  );

  while (faceExplorer.More()) {
    const face = oc.TopoDS.Face_1(faceExplorer.Current());
    const location = new oc.TopLoc_Location_1();
    const handleTri = oc.BRep_Tool.Triangulation(
      face,
      location,
      0, // Poly_MeshPurpose_NONE
    );

    if (!handleTri.IsNull()) {
      const tri = handleTri.get();
      const transform = location.Transformation();
      const nbNodes = tri.NbNodes();
      const nbTriangles = tri.NbTriangles();
      const reversed =
        face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;

      if (!tri.HasNormals()) {
        tri.ComputeNormals();
      }

      for (let i = 1; i <= nbNodes; i++) {
        const p = tri.Node(i).Transformed(transform);
        vertices.push(p.X(), p.Y(), p.Z());

        const n = tri.Normal_1(i);
        const dir = reversed ? -1 : 1;
        normals.push(n.X() * dir, n.Y() * dir, n.Z() * dir);
      }

      for (let i = 1; i <= nbTriangles; i++) {
        const t = tri.Triangle(i);
        const n1 = t.Value(1) - 1 + vertexOffset;
        const n2 = t.Value(2) - 1 + vertexOffset;
        const n3 = t.Value(3) - 1 + vertexOffset;
        if (reversed) {
          indices.push(n1, n3, n2);
        } else {
          indices.push(n1, n2, n3);
        }
      }

      vertexOffset += nbNodes;
    }

    faceExplorer.Next();
  }

  return {
    vertices: new Float32Array(vertices),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}

export function registerCadHandlers(): void {
  // Begin loading OpenCascade immediately — the WASM compilation runs in
  // parallel with renderer startup so it's already done (or nearly done)
  // by the time the first IPC call arrives.
  getOC();

  ipcMain.handle(
    "cad:build-nametag",
    async (_event, params: NametagParams): Promise<BuildResult> => {
      const oc = await getOC();
      try {
        const { shape, width, warnings } = buildNametag(
          oc,
          params,
          resolveFont(params.fontFile),
        );
        return { mesh: shapeToMesh(oc, shape), width, warnings };
      } catch (e) {
        // OpenCascade throws raw numbers (C++ exception pointers), which
        // don't survive IPC meaningfully — wrap them in a real Error.
        throw new Error(
          e instanceof Error ? e.message : `OpenCascade error (${String(e)})`,
        );
      }
    },
  );
}
