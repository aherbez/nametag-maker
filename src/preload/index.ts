import { contextBridge, ipcRenderer } from "electron";
import type {
  BuildResult,
  ControlParams,
  NametagParams,
  PickedSvg,
  SettingsView,
  TagColors,
} from "../shared/types";

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  buildNametag: (params: NametagParams): Promise<BuildResult> =>
    ipcRenderer.invoke("cad:build-nametag", params),
  onExportSTL: (callback: () => void): (() => void) => {
    ipcRenderer.removeAllListeners("export-stl");
    ipcRenderer.on("export-stl", callback);
    return () => ipcRenderer.removeAllListeners("export-stl");
  },
  onShowAbout: (callback: () => void): (() => void) => {
    ipcRenderer.removeAllListeners("show-about");
    ipcRenderer.on("show-about", callback);
    return () => ipcRenderer.removeAllListeners("show-about");
  },
  onShowSettings: (callback: () => void): (() => void) => {
    ipcRenderer.removeAllListeners("show-settings");
    ipcRenderer.on("show-settings", callback);
    return () => ipcRenderer.removeAllListeners("show-settings");
  },
  getSettings: (): Promise<SettingsView> => ipcRenderer.invoke("settings:get"),
  pickSvg: (): Promise<PickedSvg | null> =>
    ipcRenderer.invoke("settings:pick-svg"),
  commitSvg: (): Promise<SettingsView> =>
    ipcRenderer.invoke("settings:commit-svg"),
  setImage: (type: "default" | "none"): Promise<SettingsView> =>
    ipcRenderer.invoke("settings:set-image", type),
  pickFont: (): Promise<SettingsView | null> =>
    ipcRenderer.invoke("settings:pick-font"),
  resetFont: (): Promise<SettingsView> =>
    ipcRenderer.invoke("settings:reset-font"),
  saveControls: (params: ControlParams, colors: TagColors): Promise<void> =>
    ipcRenderer.invoke("settings:save-controls", params, colors),
  triggerExportSTL: (fileName?: string): void => {
    ipcRenderer.emit("export-stl", fileName);
  },
  saveSTL: (buffer: ArrayBuffer, fileName?: string): Promise<boolean> =>
    ipcRenderer.invoke("cad:save-stl", buffer, fileName),
});
