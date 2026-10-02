// Types shared between the main process, preload script, and renderer.

export interface Pt {
  x: number;
  y: number;
}

/** A closed 2D outline with optional holes. Coordinates are Y-up. */
export interface Polygon {
  outer: Pt[];
  holes: Pt[][];
}

/** Extra diameter given to magnet pockets so the magnets press-fit. */
export const MAGNET_CLEARANCE = 0.4;

export interface NametagParams {
  /**
   * Base plate size along Z. (Its width along X is calculated from the
   * content: margins, image, and text.)
   */
  depth: number;
  /** Base plate extrusion height. */
  thickness: number;
  /** Radius of the plate's rounded corners (seen from above). */
  cornerRadius: number;
  /** Fillet radius applied to the plate's top edges. */
  edgeFillet: number;
  /** How far the image and text rise above the plate's top face. */
  reliefHeight: number;
  /**
   * Distance kept clear between the plate edge, image, and text. The text
   * is scaled to fill the plate's depth inside this margin, and the plate's
   * width is set by the content plus these margins.
   */
  margin: number;
  text: string;
  /** Largest dimension of the image; shrunk if it doesn't fit. */
  imageSize: number;
  /**
   * Diameter of the magnets to embed in the bottom; the pockets are made
   * slightly larger. 0 for no pockets.
   */
  magnetDiameter: number;
  /** How deep the magnet pockets go into the bottom. 0 for no pockets. */
  magnetDepth: number;
  /** Image outlines in arbitrary (SVG) units. Empty for no image. */
  image: Polygon[];
  /**
   * Stored font file (an opaque id from the app settings), or null to use
   * the system default font.
   */
  fontFile: string | null;
}

/** The parameters edited in the sidebar; the image and font come from Settings. */
export type ControlParams = Omit<NametagParams, "image" | "fontFile">;

/** Preview colors, as #rrggbb strings. */
export interface TagColors {
  base: string;
  relief: string;
}

export interface MeshData {
  vertices: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface BuildResult {
  mesh: MeshData;
  /** The plate's calculated width. */
  width: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** A user-chosen file that has been copied into app storage. */
export interface StoredAsset {
  /** The file's original name, for display. */
  name: string;
  /** The copy's file name inside the app's assets directory. */
  file: string;
}

export type ImageSetting =
  | { type: "default" }
  | { type: "none" }
  | ({ type: "custom" } & StoredAsset);

export type FontSetting = { type: "default" } | ({ type: "custom" } & StoredAsset);

/** The printer bed that batches of tags are laid out on. */
export interface BedSettings {
  width: number;
  height: number;
  /** Gap between neighboring tags. */
  spacing: number;
}

export const DEFAULT_BED: BedSettings = { width: 220, height: 220, spacing: 5 };

/** Settings as persisted by the main process. */
export interface AppSettings {
  image: ImageSetting;
  font: FontSetting;
  bed: BedSettings;
  /** Saved sidebar values; missing fields fall back to the app defaults. */
  params: Partial<ControlParams>;
  colors: Partial<TagColors>;
}

/** Settings as seen by the renderer, with what it needs to use them. */
export interface SettingsView extends AppSettings {
  /** Contents of the custom SVG, when `image.type` is "custom". */
  svgText: string | null;
  /** Display name of the system font used when `font.type` is "default". */
  defaultFontName: string;
}

/** An SVG the user picked but hasn't committed yet. */
export interface PickedSvg {
  name: string;
  svgText: string;
}

/** Names loaded from a CSV file, one tag per name. */
export interface NameList {
  /** The CSV's file name without its extension, for naming exports. */
  baseName: string;
  names: string[];
}
