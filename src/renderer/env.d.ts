/// <reference types="vite/client" />
import type {
  BackingResult,
  BuildResult,
  BedSettings,
  ControlParams,
  NameList,
  NametagParams,
  PickedSvg,
  SettingsView,
  TagColors,
} from "../shared/types";

declare global {
  interface Window {
    electronAPI: {
      platform: string;
      buildNametag: (params: NametagParams) => Promise<BuildResult>;
      buildBacking: (params: NametagParams) => Promise<BackingResult>;
      onExportSTL: (callback: () => void) => () => void;
      onShowAbout: (callback: () => void) => () => void;
      onShowSettings: (callback: () => void) => () => void;
      getSettings: () => Promise<SettingsView>;
      pickSvg: () => Promise<PickedSvg | null>;
      commitSvg: () => Promise<SettingsView>;
      setImage: (type: "default" | "none") => Promise<SettingsView>;
      pickFont: () => Promise<SettingsView | null>;
      resetFont: () => Promise<SettingsView>;
      saveControls: (params: ControlParams, colors: TagColors) => Promise<void>;
      setBed: (bed: BedSettings) => Promise<SettingsView>;
      onCsvLoaded: (callback: (list: NameList) => void) => () => void;
      saveSTLBatch: (buffers: ArrayBuffer[], baseName: string) => Promise<boolean>;
      triggerExportSTL: (fileName?: string) => void;
      saveSTL: (buffer: ArrayBuffer, fileName?: string) => Promise<boolean>;
    };
  }
}
