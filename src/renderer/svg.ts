import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import type { Polygon } from "../shared/types";

// Points sampled along each curve segment of an SVG path.
const CURVE_DIVISIONS = 12;

/**
 * Parse an SVG document into filled outlines (Y-up, in SVG user units).
 * Only filled shapes are used; stroke-only paths have no area to extrude.
 */
export function svgToPolygons(svgText: string): Polygon[] {
  const { paths } = new SVGLoader().parse(svgText);
  const polygons: Polygon[] = [];

  for (const path of paths) {
    const style = path.userData?.style;
    if (!style || style.fill === "none" || style.fillOpacity === 0) continue;

    for (const shape of SVGLoader.createShapes(path)) {
      const { shape: outer, holes } = shape.extractPoints(CURVE_DIVISIONS);
      // SVG is Y-down; flip to Y-up.
      const flip = (pts: { x: number; y: number }[]) =>
        pts.map((p) => ({ x: p.x, y: -p.y }));
      polygons.push({ outer: flip(outer), holes: holes.map(flip) });
    }
  }

  return polygons;
}
