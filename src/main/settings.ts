import { app, BrowserWindow, dialog, ipcMain } from "electron";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import opentype from "opentype.js";
import type {
  AppSettings,
  ControlParams,
  PickedSvg,
  SettingsView,
  StoredAsset,
  TagColors,
} from "../shared/types";
import { findSystemFont } from "./nametag";

// User-chosen files are copied into the per-user app data directory, so the
// app keeps working if the originals are moved or deleted. Settings live
// alongside them as JSON.

const defaults: AppSettings = {
  image: { type: "default" },
  font: { type: "default" },
  params: {},
  colors: {},
};

const numericParams = [
  "depth",
  "thickness",
  "cornerRadius",
  "edgeFillet",
  "reliefHeight",
  "margin",
  "imageSize",
  "magnetDiameter",
  "magnetDepth",
] as const satisfies readonly (keyof ControlParams)[];

/**
 * Keep only well-formed sidebar values. Applied to anything coming from
 * the renderer or read back from disk (the file may have been hand-edited).
 */
function sanitizeParams(raw: unknown): Partial<ControlParams> {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out: Partial<ControlParams> = {};
  for (const key of numericParams) {
    const v = src[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  if (typeof src.text === "string") out.text = src.text.slice(0, 200);
  return out;
}

function sanitizeColors(raw: unknown): Partial<TagColors> {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out: Partial<TagColors> = {};
  for (const key of ["base", "relief"] as const) {
    const v = src[key];
    if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) out[key] = v;
  }
  return out;
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function assetsDir(): string {
  return path.join(app.getPath("userData"), "assets");
}

/**
 * Resolve a stored asset id to its absolute path. The id is reduced to its
 * base name so it can never point outside the assets directory.
 */
export function assetPath(file: string): string {
  return path.join(assetsDir(), path.basename(file));
}

let cached: AppSettings | null = null;

async function loadSettings(): Promise<AppSettings> {
  if (cached) return cached;
  try {
    const raw = JSON.parse(await fs.readFile(settingsPath(), "utf8"));
    cached = {
      ...defaults,
      ...raw,
      params: sanitizeParams(raw.params),
      colors: sanitizeColors(raw.colors),
    };
  } catch {
    // Missing or unreadable: start from defaults.
    cached = { ...defaults };
  }
  return cached!;
}

// Saves run one at a time, so two in flight can't interleave their writes
// to the temp file.
let saveQueue: Promise<void> = Promise.resolve();

function saveSettings(next: AppSettings): Promise<void> {
  cached = next;
  const write = async () => {
    // Write to a temp file and rename, so a crash mid-write can't leave a
    // truncated settings file behind.
    const file = settingsPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, JSON.stringify(next, null, 2));
    await fs.rename(`${file}.tmp`, file);
  };
  saveQueue = saveQueue.then(write, write);
  return saveQueue;
}

/** Copy a file into the assets directory under a fresh, unique name. */
async function storeAsset(sourcePath: string): Promise<StoredAsset> {
  await fs.mkdir(assetsDir(), { recursive: true });
  const ext = path.extname(sourcePath).toLowerCase();
  const file = `${crypto.randomUUID()}${ext}`;
  await fs.copyFile(sourcePath, assetPath(file));
  return { name: path.basename(sourcePath), file };
}

async function removeAsset(setting: { type: string; file?: string }) {
  if (setting.type !== "custom" || !setting.file) return;
  await fs.rm(assetPath(setting.file), { force: true });
}

async function toView(settings: AppSettings): Promise<SettingsView> {
  let svgText: string | null = null;
  if (settings.image.type === "custom") {
    try {
      svgText = await fs.readFile(assetPath(settings.image.file), "utf8");
    } catch {
      // The stored copy has gone missing; fall back to the default image.
      settings = { ...settings, image: { type: "default" } };
    }
  }
  let defaultFontName = "(none found)";
  try {
    defaultFontName = path.basename(findSystemFont());
  } catch {
    // Reported properly when a build is attempted.
  }
  return { ...settings, svgText, defaultFontName };
}

async function update(patch: Partial<AppSettings>): Promise<SettingsView> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await saveSettings(next);
  // Clean up a custom file that's no longer referenced.
  if (patch.image) await removeAsset(current.image);
  if (patch.font) await removeAsset(current.font);
  return toView(next);
}

/** Resolve the font file to build with: a stored font, or null for default. */
export function resolveFont(fontFile: string | null): string | null {
  return fontFile ? assetPath(fontFile) : null;
}

export function registerSettingsHandlers(): void {
  // The SVG picked in the dialog but not yet committed. Kept here rather
  // than round-tripped through the renderer, so the renderer can never ask
  // the main process to copy an arbitrary path.
  let pendingSvgPath: string | null = null;

  ipcMain.handle("settings:get", async () => toView(await loadSettings()));

  // Step 1 of choosing an SVG: let the user pick one and return its contents.
  // The renderer validates it (SVG parsing needs a DOM) before committing.
  ipcMain.handle(
    "settings:pick-svg",
    async (event): Promise<PickedSvg | null> => {
      const win = BrowserWindow.fromWebContents(event.sender)!;
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: "Choose an SVG image",
        properties: ["openFile"],
        filters: [{ name: "SVG images", extensions: ["svg"] }],
      });
      if (canceled || filePaths.length === 0) return null;
      pendingSvgPath = filePaths[0];
      return {
        name: path.basename(pendingSvgPath),
        svgText: await fs.readFile(pendingSvgPath, "utf8"),
      };
    },
  );

  // Step 2: copy the picked SVG into app storage and make it the image.
  ipcMain.handle("settings:commit-svg", async () => {
    if (!pendingSvgPath) throw new Error("No SVG has been picked.");
    const stored = await storeAsset(pendingSvgPath);
    pendingSvgPath = null;
    return update({ image: { type: "custom", ...stored } });
  });

  ipcMain.handle(
    "settings:set-image",
    async (_event, type: "default" | "none") => update({ image: { type } }),
  );

  ipcMain.handle(
    "settings:pick-font",
    async (event): Promise<SettingsView | null> => {
      const win = BrowserWindow.fromWebContents(event.sender)!;
      const { canceled, filePaths } = await dialog.showOpenDialog(win, {
        title: "Choose a font",
        properties: ["openFile"],
        filters: [{ name: "Fonts", extensions: ["ttf", "otf"] }],
      });
      if (canceled || filePaths.length === 0) return null;

      // Make sure the font is usable before keeping it.
      try {
        const font = opentype.loadSync(filePaths[0]);
        font.getPath("Aa", 0, 0, 12);
      } catch {
        throw new Error(
          `${path.basename(filePaths[0])} couldn't be read as a font.`,
        );
      }
      const stored = await storeAsset(filePaths[0]);
      return update({ font: { type: "custom", ...stored } });
    },
  );

  ipcMain.handle("settings:reset-font", async () =>
    update({ font: { type: "default" } }),
  );

  ipcMain.handle(
    "settings:save-controls",
    async (_event, params: unknown, colors: unknown) => {
      const current = await loadSettings();
      await saveSettings({
        ...current,
        params: sanitizeParams(params),
        colors: sanitizeColors(colors),
      });
    },
  );
}
