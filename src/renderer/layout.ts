import type { BedSettings } from "../shared/types";

export interface Placement {
  bed: number;
  /** Part center, relative to its bed's center (X across, Z front to back). */
  x: number;
  z: number;
}

export interface BedLayout {
  /** One entry per part; null for parts too big to fit on a bed. */
  placements: (Placement | null)[];
  beds: number;
}

/** A part's footprint on the bed. */
export interface Footprint {
  width: number;
  depth: number;
}

export function fitsOnBed(part: Footprint, bed: BedSettings): boolean {
  return part.width <= bed.width && part.depth <= bed.height;
}

/**
 * Pack parts onto print beds in rows, in order: left to right until a row
 * is full, then the next row back to front, then a new bed. Each row is as
 * deep as its deepest part, and parts are centered front to back within
 * their row. Each bed's block of parts is centered on it.
 */
export function layoutParts(parts: Footprint[], bed: BedSettings): BedLayout {
  const { width: bedW, height: bedH, spacing } = bed;

  // First pass: assign each part a row and a left edge, and size the rows.
  const rows: { bed: number; top: number; depth: number }[] = [];
  const slots: ({ row: number; left: number } | null)[] = [];
  let x = 0;
  for (const part of parts) {
    if (!fitsOnBed(part, bed)) {
      slots.push(null);
      continue;
    }
    let row = rows[rows.length - 1];
    if (row && x > 0 && x + part.width > bedW) {
      // Wrap to a new row behind this one.
      row = { bed: row.bed, top: row.top + row.depth + spacing, depth: 0 };
      rows.push(row);
      x = 0;
    }
    if (!row || row.top + Math.max(row.depth, part.depth) > bedH) {
      // Start a new bed.
      row = { bed: row ? row.bed + 1 : 0, top: 0, depth: 0 };
      rows.push(row);
      x = 0;
    }
    row.depth = Math.max(row.depth, part.depth);
    slots.push({ row: rows.length - 1, left: x });
    x += part.width + spacing;
  }
  const beds = rows.length > 0 ? rows[rows.length - 1].bed + 1 : 0;

  // Measure each bed's block so it can be centered.
  const blockW = new Array(beds).fill(0);
  const blockH = new Array(beds).fill(0);
  slots.forEach((slot, i) => {
    if (!slot) return;
    const row = rows[slot.row];
    blockW[row.bed] = Math.max(blockW[row.bed], slot.left + parts[i].width);
    blockH[row.bed] = Math.max(blockH[row.bed], row.top + row.depth);
  });

  const placements = slots.map((slot, i) => {
    if (!slot) return null;
    const row = rows[slot.row];
    const offsetX = (bedW - blockW[row.bed]) / 2;
    const offsetZ = (bedH - blockH[row.bed]) / 2;
    return {
      bed: row.bed,
      x: -bedW / 2 + offsetX + slot.left + parts[i].width / 2,
      z: -bedH / 2 + offsetZ + row.top + row.depth / 2,
    };
  });

  return { placements, beds };
}
