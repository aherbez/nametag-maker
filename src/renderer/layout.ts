import type { BedSettings } from "../shared/types";

export interface Placement {
  bed: number;
  /** Tag center, relative to its bed's center (X across, Z front to back). */
  x: number;
  z: number;
}

export interface BedLayout {
  /** One entry per tag; null for tags too big to fit on a bed. */
  placements: (Placement | null)[];
  beds: number;
}

/**
 * Pack tags onto print beds in rows: left to right until a row is full,
 * then the next row back to front, then a new bed. Tags all share the same
 * depth but vary in width. Each bed's block of tags is centered on it.
 */
export function layoutTags(
  widths: number[],
  depth: number,
  bed: BedSettings,
): BedLayout {
  const { width: bedW, height: bedH, spacing } = bed;
  const rowsPerBed = Math.floor((bedH + spacing) / (depth + spacing));

  // First pass: assign each tag a bed, row, and left edge.
  const slots: ({ bed: number; row: number; left: number } | null)[] = [];
  let bedIndex = 0;
  let row = 0;
  let x = 0;
  let used = false;
  for (const w of widths) {
    if (rowsPerBed < 1 || w > bedW) {
      slots.push(null);
      continue;
    }
    if (x > 0 && x + w > bedW) {
      row++;
      x = 0;
    }
    if (row >= rowsPerBed) {
      bedIndex++;
      row = 0;
    }
    slots.push({ bed: bedIndex, row, left: x });
    x += w + spacing;
    used = true;
  }
  const beds = used ? bedIndex + 1 : 0;

  // Measure each bed's block so it can be centered.
  const blockW = new Array(beds).fill(0);
  const rowsUsed = new Array(beds).fill(0);
  slots.forEach((slot, i) => {
    if (!slot) return;
    blockW[slot.bed] = Math.max(blockW[slot.bed], slot.left + widths[i]);
    rowsUsed[slot.bed] = Math.max(rowsUsed[slot.bed], slot.row + 1);
  });

  const placements = slots.map((slot, i) => {
    if (!slot) return null;
    const blockH = rowsUsed[slot.bed] * (depth + spacing) - spacing;
    const offsetX = (bedW - blockW[slot.bed]) / 2;
    const offsetZ = (bedH - blockH) / 2;
    return {
      bed: slot.bed,
      x: -bedW / 2 + offsetX + slot.left + widths[i] / 2,
      z: -bedH / 2 + offsetZ + slot.row * (depth + spacing) + depth / 2,
    };
  });

  return { placements, beds };
}
