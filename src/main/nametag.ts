import fs from "fs";
import opentype from "opentype.js";
import {
  BACKING_CUP_WALL,
  MAGNET_CLEARANCE,
  MAGNET_POCKET_SHORTFALL,
  type NametagParams,
  type Polygon,
  type Pt,
} from "../shared/types";

// Coordinate conventions
// ----------------------
// The model is built Y-up (matching Three.js). The base plate sits on the
// XZ plane with its bottom face at y = 0 and its top face at y = thickness.
//
// All 2D layout (image + text) happens in a Y-up plane that is mapped onto
// the top face as (u, v) → (x = u, z = -v), so that the top of the text
// points away from a viewer looking down at the plate from +Z.

// Relief solids start this far below the top face so the fuse never has to
// deal with exactly coincident faces.
const SINK = 0.1;

// Points closer together than this (in mm) are merged.
const POINT_TOL = 0.01;

// Fillet radius where a backing cup meets its plate, as a fraction of the
// cup's height.
const CUP_FILLET_RATIO = 0.8;

// Number of line segments used to approximate each glyph curve.
const CURVE_SEGMENTS = 6;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OC = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Shape = any;

/**
 * Build the nametag solid. `fontPath` is the font file to use for the
 * text, or null for the system default.
 */
export function buildNametag(
  oc: OC,
  p: NametagParams,
  fontPath: string | null,
): { shape: Shape; width: number; warnings: string[] } {
  const warnings: string[] = [];
  const usableH = p.depth - 2 * p.margin;

  // Lay the content out left to right, starting from the plate's left edge
  // at x = 0: margin, image, margin, text, margin. The plate's width is
  // whatever that adds up to.
  const relief: Polygon[] = [];
  let textPolys: Polygon[] = [];
  let x = p.margin;
  let hasContent = false;

  if (usableH <= 0) {
    warnings.push("The margin leaves no room for the image or text.");
  } else {
    // Image: scaled to imageSize (shrunk if it's taller than the space
    // between the margins), centered vertically.
    if (p.image.length > 0) {
      const bb = bounds(p.image);
      const bw = bb.maxX - bb.minX;
      const bh = bb.maxY - bb.minY;
      if (bw > 0 && bh > 0) {
        const wanted = p.imageSize / Math.max(bw, bh);
        const s = Math.min(wanted, usableH / bh);
        if (s < wanted * 0.999) {
          warnings.push(
            "The image was shrunk to fit between the top and bottom margins.",
          );
        }
        relief.push(
          ...transformPolygons(
            p.image,
            s,
            x - bb.minX * s,
            -((bb.minY + bb.maxY) / 2) * s,
          ),
        );
        x += bw * s + p.margin;
        hasContent = true;
      }
    }

    // Text: scaled so its outline fills the depth between the margins.
    const text = p.text.trim();
    if (text) {
      // The size here is nominal; the outlines are rescaled below.
      const glyphs = textToPolygons(text, usableH, fontPath);
      if (glyphs.length > 0) {
        const bb = bounds(glyphs);
        const s = usableH / (bb.maxY - bb.minY);
        textPolys = transformPolygons(
          glyphs,
          s,
          x - bb.minX * s,
          -((bb.minY + bb.maxY) / 2) * s,
        );
        x += (bb.maxX - bb.minX) * s + p.margin;
        hasContent = true;
      }
    }
  }

  // With nothing to show, fall back to a square plate. Either way, the
  // plate is at least as wide as its magnet backing.
  const contentWidth = hasContent ? x : p.depth;
  const width = Math.max(contentWidth, minTagWidth(p));
  // Center the text in whatever the plate gained beyond the image.
  relief.push(
    ...transformPolygons(textPolys, 1, (width - contentWidth) / 2, 0),
  );
  const base = cutMagnetPockets(
    oc,
    makeBase(oc, p, width, warnings),
    p,
    width,
    warnings,
  );

  // Shift everything so the plate is centered on the origin.
  const centered = transformPolygons(relief, 1, -width / 2, 0);

  const tools: Shape[] = [];
  let skipped = 0;
  for (const poly of centered) {
    const cleaned = cleanPolygon(poly);
    if (!cleaned) continue;
    try {
      tools.push(
        polygonToSolid(
          oc,
          cleaned,
          p.thickness - SINK,
          p.reliefHeight + SINK,
        ),
      );
    } catch {
      skipped++;
    }
  }
  if (skipped > 0) {
    warnings.push(`${skipped} outline(s) could not be converted and were skipped.`);
  }
  if (tools.length === 0 || p.reliefHeight <= 0) {
    return { shape: base, width, warnings };
  }

  return { shape: fuseAll(oc, base, tools), width, warnings };
}

// ---------------------------------------------------------------------------
// Base plate
// ---------------------------------------------------------------------------

/**
 * A rounded rectangle extruded by `thickness`, with its top edges filleted.
 * The bottom edges stay sharp so the plate sits flat on a print bed.
 */
function makeBase(
  oc: OC,
  p: NametagParams,
  width: number,
  warnings: string[],
): Shape {
  const hw = width / 2;
  const hd = p.depth / 2;
  let r = Math.max(0, Math.min(p.cornerRadius, hw, hd));
  if (r < 0.01) r = 0;

  const mkWire = new oc.BRepBuilderAPI_MakeWire_1();
  const pnt = (x: number, z: number) => new oc.gp_Pnt_3(x, 0, z);
  const addCurve = (curve: Shape) =>
    mkWire.Add_1(
      new oc.BRepBuilderAPI_MakeEdge_24(
        new oc.Handle_Geom_Curve_2(curve.Value().get()),
      ).Edge(),
    );
  const addSegment = (x1: number, z1: number, x2: number, z2: number) => {
    if (Math.hypot(x2 - x1, z2 - z1) < 1e-6) return;
    addCurve(new oc.GC_MakeSegment_1(pnt(x1, z1), pnt(x2, z2)));
  };
  // Quarter arc around the corner center (cx, cz), from direction a to b.
  const addCorner = (
    cx: number,
    cz: number,
    ax: number,
    az: number,
    bx: number,
    bz: number,
  ) => {
    if (r === 0) return;
    const m = Math.SQRT1_2;
    addCurve(
      new oc.GC_MakeArcOfCircle_4(
        pnt(cx + ax * r, cz + az * r),
        pnt(cx + (ax + bx) * m * r, cz + (az + bz) * m * r),
        pnt(cx + bx * r, cz + bz * r),
      ),
    );
  };

  addSegment(hw, -hd + r, hw, hd - r);
  addCorner(hw - r, hd - r, 1, 0, 0, 1);
  addSegment(hw - r, hd, -hw + r, hd);
  addCorner(-hw + r, hd - r, 0, 1, -1, 0);
  addSegment(-hw, hd - r, -hw, -hd + r);
  addCorner(-hw + r, -hd + r, -1, 0, 0, -1);
  addSegment(-hw + r, -hd, hw - r, -hd);
  addCorner(hw - r, -hd + r, 0, -1, 1, 0);

  const face = new oc.BRepBuilderAPI_MakeFace_15(mkWire.Wire(), true).Face();
  const prism = new oc.BRepPrimAPI_MakePrism_1(
    face,
    new oc.gp_Vec_4(0, p.thickness, 0),
    false,
    true,
  );
  const solid = prism.Shape();

  // A top-edge fillet can't be larger than the plate is thick, nor larger
  // than the corner radius it has to roll around.
  const maxFillet = Math.min(p.thickness, r > 0 ? r : Infinity) - 0.01;
  const fillet = Math.min(p.edgeFillet, maxFillet);
  if (fillet < p.edgeFillet) {
    warnings.push(
      `Edge fillet reduced to ${fillet.toFixed(2)} mm (it must be smaller than the thickness and corner radius).`,
    );
  }
  if (fillet <= 0.01) return solid;

  try {
    const mkFillet = new oc.BRepFilletAPI_MakeFillet(
      solid,
      oc.ChFi3d_FilletShape.ChFi3d_Rational,
    );
    const edges = new oc.TopExp_Explorer_2(
      prism.LastShape_1(),
      oc.TopAbs_ShapeEnum.TopAbs_EDGE,
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    for (; edges.More(); edges.Next()) {
      mkFillet.Add_2(fillet, oc.TopoDS.Edge_1(edges.Current()));
    }
    mkFillet.Build(new oc.Message_ProgressRange_1());
    if (mkFillet.IsDone()) return mkFillet.Shape();
  } catch {
    // fall through
  }
  warnings.push("The edge fillet failed; showing the plate without it.");
  return solid;
}

/**
 * Cut two cylindrical magnet pockets up into the plate's bottom face,
 * centered front to back and `magnetSpacing` apart (center to center).
 */
function cutMagnetPockets(
  oc: OC,
  base: Shape,
  p: NametagParams,
  width: number,
  warnings: string[],
): Shape {
  if (p.magnetDiameter <= 0 || p.magnetHeight <= 0) return base;

  const diameter = p.magnetDiameter + MAGNET_CLEARANCE;
  const pocketDepth = p.magnetHeight - MAGNET_POCKET_SHORTFALL;
  const skip = (reason: string) => {
    warnings.push(`Magnet pockets left out: ${reason}`);
    return base;
  };
  if (pocketDepth <= 0) {
    return skip(
      `the magnet height must be more than ${MAGNET_POCKET_SHORTFALL} mm.`,
    );
  }
  if (pocketDepth >= p.thickness) {
    return skip(
      `the pockets (${pocketDepth.toFixed(1)} mm deep) must be shallower than the plate thickness (${p.thickness} mm).`,
    );
  }
  if (diameter >= p.depth) {
    return skip(
      `the pockets (${diameter.toFixed(1)} mm) are wider than the plate is deep.`,
    );
  }
  if (p.magnetSpacing <= diameter) {
    return skip(
      `the spacing must be more than the pocket width (${diameter.toFixed(1)} mm).`,
    );
  }
  if (p.magnetSpacing + diameter >= width) {
    return skip(
      `the plate (${width.toFixed(1)} mm wide) is too narrow for pockets ${p.magnetSpacing} mm apart.`,
    );
  }

  // Start each cylinder just below the bottom face so the cut never has to
  // deal with exactly coincident faces.
  const below = 0.1;
  const tools = [-p.magnetSpacing / 2, p.magnetSpacing / 2].map((x) =>
    makeCylinder(oc, x, -below, diameter / 2, pocketDepth + below),
  );
  return cutAll(oc, base, tools) ?? skip("the cut failed.");
}

/** An upright cylinder whose bottom face is centered at (x, y0, 0). */
function makeCylinder(oc: OC, x: number, y0: number, r: number, h: number) {
  return new oc.BRepPrimAPI_MakeCylinder_3(
    new oc.gp_Ax2_3(new oc.gp_Pnt_3(x, y0, 0), new oc.gp_Dir_4(0, 1, 0)),
    r,
    h,
  ).Shape();
}

/** Cut every tool out of the base at once; null if the cut fails. */
function cutAll(oc: OC, base: Shape, tools: Shape[]): Shape | null {
  const args = new oc.TopTools_ListOfShape_1();
  args.Append_1(base);
  const toolList = new oc.TopTools_ListOfShape_1();
  for (const t of tools) toolList.Append_1(t);
  const cut = new oc.BRepAlgoAPI_Cut_1();
  cut.SetArguments(args);
  cut.SetTools(toolList);
  cut.Build(new oc.Message_ProgressRange_1());
  return cut.HasErrors() ? null : cut.Shape();
}

// ---------------------------------------------------------------------------
// Magnet backing
// ---------------------------------------------------------------------------

/** The backing's width: both cups, with the margin clear beyond each. */
function backingWidth(p: NametagParams): number {
  const cup = p.magnetDiameter + MAGNET_CLEARANCE + BACKING_CUP_WALL;
  return p.magnetSpacing + cup + 2 * p.margin;
}

/** Tags with magnets are never narrower than their backing. */
function minTagWidth(p: NametagParams): number {
  return p.magnetDiameter > 0 && p.magnetHeight > 0 ? backingWidth(p) : 0;
}

/**
 * Build the backing that holds the matching pair of magnets: a plate like
 * the tag's base (same corner radius and edge fillet), with two open cups
 * on top lined up with the tag's pockets. Centered on the origin with its
 * bottom face at y = 0. `shape` is null when there's no backing to make.
 */
export function buildBacking(
  oc: OC,
  p: NametagParams,
): { shape: Shape | null; width: number; depth: number; warnings: string[] } {
  const warnings: string[] = [];
  const inner = p.magnetDiameter + MAGNET_CLEARANCE;
  const outer = inner + BACKING_CUP_WALL;
  const width = backingWidth(p);
  const depth = p.backingDepth > 0 ? p.backingDepth : 2 * p.magnetDiameter;
  const result = (shape: Shape | null) => ({ shape, width, depth, warnings });
  const skip = (reason: string) => {
    warnings.push(`Magnet backing left out: ${reason}`);
    return result(null);
  };

  if (p.magnetDiameter <= 0 || p.magnetHeight <= 0) return result(null);

  const cupHeight = p.magnetHeight - MAGNET_POCKET_SHORTFALL;
  if (cupHeight <= 0) {
    return skip(
      `the magnet height must be more than ${MAGNET_POCKET_SHORTFALL} mm.`,
    );
  }
  if (p.backingHeight <= 0) {
    return skip("its height must be more than 0.");
  }
  if (p.magnetSpacing < outer) {
    return skip(
      `the magnet spacing must be at least the cup width (${outer.toFixed(1)} mm).`,
    );
  }
  if (outer > depth) {
    warnings.push(
      `The magnet backing's cups (${outer.toFixed(1)} mm) are wider than the backing is deep (${depth.toFixed(1)} mm).`,
    );
  }

  const plateWarnings: string[] = [];
  const plate = makeBase(
    oc,
    { ...p, depth, thickness: p.backingHeight },
    width,
    plateWarnings,
  );
  warnings.push(...plateWarnings.map((w) => `Magnet backing: ${w}`));

  // Each cup is a tube sunk slightly into the plate, so the plate's top face
  // is the cup's floor and the fuse never sees coincident faces.
  const top = p.backingHeight;
  const cups: Shape[] = [];
  for (const x of [-p.magnetSpacing / 2, p.magnetSpacing / 2]) {
    const tube = cutAll(
      oc,
      makeCylinder(oc, x, top - SINK, outer / 2, cupHeight + SINK),
      [makeCylinder(oc, x, top - 2 * SINK, inner / 2, cupHeight + 3 * SINK)],
    );
    if (!tube) return skip("the cups couldn't be made.");
    cups.push(tube);
  }

  let backing: Shape;
  try {
    backing = fuseAll(oc, plate, cups);
  } catch {
    return skip("the cups couldn't be attached to the plate.");
  }
  return result(
    filletCupBases(
      oc,
      backing,
      outer / 2,
      top,
      cupHeight * CUP_FILLET_RATIO,
      warnings,
    ),
  );
}

/**
 * Fillet the circular edges where the cups' outsides meet the plate's top
 * face (radius `r`, at height `y`). Returns the shape unfilleted, with a
 * warning, if that fails.
 */
function filletCupBases(
  oc: OC,
  shape: Shape,
  r: number,
  y: number,
  fillet: number,
  warnings: string[],
): Shape {
  if (fillet <= 0.01) return shape;
  try {
    const mkFillet = new oc.BRepFilletAPI_MakeFillet(
      shape,
      oc.ChFi3d_FilletShape.ChFi3d_Rational,
    );
    // A map visits each edge once, unlike an explorer, which revisits
    // edges shared between faces.
    const edges = new oc.TopTools_IndexedMapOfShape_1();
    oc.TopExp.MapShapes_1(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, edges);
    let found = 0;
    for (let i = 1; i <= edges.Extent(); i++) {
      const edge = oc.TopoDS.Edge_1(edges.FindKey(i));
      const curve = new oc.BRepAdaptor_Curve_2(edge);
      if (curve.GetType() !== oc.GeomAbs_CurveType.GeomAbs_Circle) continue;
      const circle = curve.Circle();
      if (
        Math.abs(circle.Radius() - r) < POINT_TOL &&
        Math.abs(circle.Location().Y() - y) < POINT_TOL
      ) {
        mkFillet.Add_2(fillet, edge);
        found++;
      }
    }
    if (found > 0) {
      mkFillet.Build(new oc.Message_ProgressRange_1());
      if (mkFillet.IsDone()) return mkFillet.Shape();
    }
  } catch {
    // fall through
  }
  warnings.push(
    "Magnet backing: the fillet around the cups failed; showing them without it.",
  );
  return shape;
}

// ---------------------------------------------------------------------------
// Relief geometry
// ---------------------------------------------------------------------------

/** Extrude a 2D polygon (with holes) upward from height y0 by h. */
function polygonToSolid(oc: OC, poly: Polygon, y0: number, h: number): Shape {
  const makeWire = (pts: Pt[]) => {
    const mk = new oc.BRepBuilderAPI_MakePolygon_1();
    for (const pt of pts) mk.Add_1(new oc.gp_Pnt_3(pt.x, y0, -pt.y));
    mk.Close();
    return mk.Wire();
  };

  // The face's plane normal is derived from the outer wire, so holes just
  // need to wind the opposite way to it.
  const mkFace = new oc.BRepBuilderAPI_MakeFace_15(
    makeWire(withWinding(poly.outer, true)),
    true,
  );
  for (const hole of poly.holes) {
    mkFace.Add(makeWire(withWinding(hole, false)));
  }
  if (!mkFace.IsDone()) throw new Error("face construction failed");

  return new oc.BRepPrimAPI_MakePrism_1(
    mkFace.Face(),
    new oc.gp_Vec_4(0, h, 0),
    false,
    true,
  ).Shape();
}

/**
 * Fuse every tool solid onto the base in a single general-fuse operation,
 * which (unlike a compound) copes with tools that overlap one another.
 */
function fuseAll(oc: OC, base: Shape, tools: Shape[]): Shape {
  const args = new oc.TopTools_ListOfShape_1();
  args.Append_1(base);
  const toolList = new oc.TopTools_ListOfShape_1();
  for (const t of tools) toolList.Append_1(t);

  const fuse = new oc.BRepAlgoAPI_Fuse_1();
  fuse.SetArguments(args);
  fuse.SetTools(toolList);
  fuse.Build(new oc.Message_ProgressRange_1());
  if (fuse.HasErrors()) throw new Error("Boolean fuse failed");

  // Merge the coplanar face fragments the fuse leaves behind.
  const unify = new oc.ShapeUpgrade_UnifySameDomain_2(
    fuse.Shape(),
    true,
    true,
    false,
  );
  unify.Build();
  return unify.Shape();
}

// ---------------------------------------------------------------------------
// 2D polygon helpers
// ---------------------------------------------------------------------------

function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return a / 2;
}

function withWinding(pts: Pt[], ccw: boolean): Pt[] {
  return signedArea(pts) > 0 === ccw ? pts : [...pts].reverse();
}

function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (
      poly[i].y > pt.y !== poly[j].y > pt.y &&
      pt.x <
        ((poly[j].x - poly[i].x) * (pt.y - poly[i].y)) /
          (poly[j].y - poly[i].y) +
          poly[i].x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Drop duplicate points; returns null if the ring is degenerate. */
function cleanRing(pts: Pt[]): Pt[] | null {
  const out: Pt[] = [];
  for (const pt of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > POINT_TOL) {
      out.push(pt);
    }
  }
  while (
    out.length > 2 &&
    Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <=
      POINT_TOL
  ) {
    out.pop();
  }
  if (out.length < 3 || Math.abs(signedArea(out)) < POINT_TOL * POINT_TOL) {
    return null;
  }
  return out;
}

function cleanPolygon(poly: Polygon): Polygon | null {
  const outer = cleanRing(poly.outer);
  if (!outer) return null;
  const holes = poly.holes
    .map(cleanRing)
    .filter((h): h is Pt[] => h !== null);
  return { outer, holes };
}

function bounds(polys: Polygon[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const pt of poly.outer) {
      minX = Math.min(minX, pt.x);
      maxX = Math.max(maxX, pt.x);
      minY = Math.min(minY, pt.y);
      maxY = Math.max(maxY, pt.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function transformPolygons(
  polys: Polygon[],
  scale: number,
  dx: number,
  dy: number,
): Polygon[] {
  const tf = (pts: Pt[]) =>
    pts.map((pt) => ({ x: pt.x * scale + dx, y: pt.y * scale + dy }));
  return polys.map((poly) => ({
    outer: tf(poly.outer),
    holes: poly.holes.map(tf),
  }));
}

/**
 * Group flat contours into polygons-with-holes by nesting depth: a contour
 * inside an even number of others is an outline, an odd number is a hole.
 * This works regardless of the font's winding convention (TrueType and CFF
 * fonts wind their outlines in opposite directions).
 */
function nestContours(contours: Pt[][]): Polygon[] {
  const items = contours.map((pts) => ({
    pts,
    area: Math.abs(signedArea(pts)),
    containers: [] as number[],
  }));
  items.forEach((item, i) => {
    items.forEach((other, j) => {
      if (
        i !== j &&
        other.area > item.area &&
        pointInPolygon(item.pts[0], other.pts)
      ) {
        item.containers.push(j);
      }
    });
  });

  const polygons = new Map<number, Polygon>();
  items.forEach((item, i) => {
    if (item.containers.length % 2 === 0) {
      polygons.set(i, { outer: item.pts, holes: [] });
    }
  });
  items.forEach((item) => {
    if (item.containers.length % 2 === 0) return;
    // The hole belongs to the smallest outline that contains it.
    const parent = item.containers
      .filter((j) => polygons.has(j))
      .sort((a, b) => items[a].area - items[b].area)[0];
    if (parent !== undefined) polygons.get(parent)!.holes.push(item.pts);
  });
  return [...polygons.values()];
}

// ---------------------------------------------------------------------------
// Text → polygons via opentype.js
//
// OpenCascade.js's WASM build has no working FreeType file I/O, so we parse
// fonts with opentype.js (pure JS) and flatten glyph outlines to polylines.
// ---------------------------------------------------------------------------

function sampleQuadBezier(p0: Pt, cp: Pt, p1: Pt, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const s = 1 - t;
    pts.push({
      x: s * s * p0.x + 2 * s * t * cp.x + t * t * p1.x,
      y: s * s * p0.y + 2 * s * t * cp.y + t * t * p1.y,
    });
  }
  return pts;
}

function sampleCubicBezier(p0: Pt, c1: Pt, c2: Pt, p1: Pt, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const s = 1 - t;
    pts.push({
      x:
        s * s * s * p0.x +
        3 * s * s * t * c1.x +
        3 * s * t * t * c2.x +
        t * t * t * p1.x,
      y:
        s * s * s * p0.y +
        3 * s * s * t * c1.y +
        3 * s * t * t * c2.y +
        t * t * t * p1.y,
    });
  }
  return pts;
}

// Locate a .ttf font on the host OS.
export function findSystemFont(): string {
  const candidates = [
    // Linux
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    // macOS
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    // Windows
    "C:\\Windows\\Fonts\\arialbd.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    "No system font found. Install dejavu-sans or liberation-sans.",
  );
}

// Parsed fonts by file path. Stored fonts get a unique file name each time
// one is chosen, so a path always refers to the same font.
const fontCache = new Map<string, opentype.Font>();

function getFont(fontPath: string | null): opentype.Font {
  const file = fontPath ?? findSystemFont();
  let font = fontCache.get(file);
  if (!font) {
    font = opentype.loadSync(file);
    fontCache.set(file, font);
  }
  return font;
}

/** Convert a text string into Y-up polygons, at the given font size. */
function textToPolygons(
  text: string,
  fontSize: number,
  fontPath: string | null,
): Polygon[] {
  const path = getFont(fontPath).getPath(text, 0, 0, fontSize);

  // opentype.js paths are Y-down; flip to Y-up as we go.
  const pt = (x: number, y: number): Pt => ({ x, y: -y });

  const contours: Pt[][] = [];
  let current: Pt[] = [];
  let cursor: Pt = { x: 0, y: 0 };

  for (const cmd of path.commands) {
    switch (cmd.type) {
      case "M":
        if (current.length > 2) contours.push(current);
        cursor = pt(cmd.x, cmd.y);
        current = [cursor];
        break;
      case "L":
        cursor = pt(cmd.x, cmd.y);
        current.push(cursor);
        break;
      case "Q": {
        const end = pt(cmd.x, cmd.y);
        current.push(
          ...sampleQuadBezier(cursor, pt(cmd.x1, cmd.y1), end, CURVE_SEGMENTS),
        );
        cursor = end;
        break;
      }
      case "C": {
        const end = pt(cmd.x, cmd.y);
        current.push(
          ...sampleCubicBezier(
            cursor,
            pt(cmd.x1, cmd.y1),
            pt(cmd.x2, cmd.y2),
            end,
            CURVE_SEGMENTS,
          ),
        );
        cursor = end;
        break;
      }
      case "Z":
        if (current.length > 2) contours.push(current);
        current = [];
        break;
    }
  }
  if (current.length > 2) contours.push(current);

  return nestContours(contours);
}
