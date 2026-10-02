import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ThemeProvider,
  createTheme,
  Stack,
  Typography,
  Box,
  Alert,
} from "@mui/material";
import ThreeCanvas, {
  type BuildJob,
  type BuildProgress,
  type BuildSummary,
} from "./ThreeCanvas";
import Controls from "./Controls";
import SettingsDialog from "./SettingsDialog";
import {
  DEFAULT_BED,
  type ControlParams,
  type NameList,
  type NametagParams,
  type Polygon,
  type SettingsView,
  type TagColors,
} from "../shared/types";
import { svgToPolygons } from "./svg";
import defaultIconSvg from "./assets/default-icon.svg?raw";

const darkTheme = createTheme({
  palette: {
    mode: "dark",
  },
});

const defaultParams: ControlParams = {
  depth: 30,
  thickness: 4,
  cornerRadius: 4,
  edgeFillet: 1,
  reliefHeight: 1.6,
  margin: 5,
  text: "Name",
  imageSize: 20,
  magnetDiameter: 10,
  magnetHeight: 2,
  magnetSpacing: 40,
  backingDepth: 0,
  backingHeight: 1.6,
};

const defaultImage = svgToPolygons(defaultIconSvg);

function imageFromSettings(settings: SettingsView): Polygon[] {
  switch (settings.image.type) {
    case "none":
      return [];
    case "custom":
      return settings.svgText ? svgToPolygons(settings.svgText) : defaultImage;
    default:
      return defaultImage;
  }
}

const defaultColors: TagColors = {
  base: "#2e9e4f",
  relief: "#ffffff",
};

// How long the color pickers must be still before their values are saved
// (dragging a picker fires a stream of changes).
const COLOR_SAVE_DELAY_MS = 500;

export default function App() {
  // Sidebar values as of the last commit (Enter in a field). Null until the
  // saved values have loaded.
  const [controlParams, setControlParams] = useState<ControlParams | null>(
    null,
  );
  // Settings from the Settings dialog; changes there rebuild right away.
  const [settings, setSettings] = useState<SettingsView>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [colors, setColors] = useState(defaultColors);
  // Names from a loaded CSV; while set, one tag is built per name.
  const [nameList, setNameList] = useState<NameList | null>(null);
  const [progress, setProgress] = useState<BuildProgress>(null);
  const [build, setBuild] = useState<BuildSummary>({ warnings: [] });
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    return window.electronAPI.onShowAbout(() => setAboutOpen(true));
  }, []);

  useEffect(() => {
    window.electronAPI.getSettings().then((loaded) => {
      // Saved values override the defaults field by field, so fields added
      // in later versions still get a value.
      setControlParams({ ...defaultParams, ...loaded.params });
      setColors({ ...defaultColors, ...loaded.colors });
      setSettings(loaded);
    });
    return window.electronAPI.onShowSettings(() => setSettingsOpen(true));
  }, []);

  useEffect(() => window.electronAPI.onCsvLoaded(setNameList), []);

  const commitParams = (next: ControlParams) => {
    // Pressing Enter without changing anything shouldn't rebuild.
    if (JSON.stringify(next) === JSON.stringify(controlParams)) return;
    setControlParams(next);
    window.electronAPI.saveControls(next, colors);
  };

  // Save colors once the pickers settle. Skips the initial load, which
  // would just write back what was read.
  const colorsLoaded = useRef(false);
  useEffect(() => {
    if (!controlParams) return;
    if (!colorsLoaded.current) {
      colorsLoaded.current = true;
      return;
    }
    const timer = setTimeout(
      () => window.electronAPI.saveControls(controlParams, colors),
      COLOR_SAVE_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [colors]);

  // Settings arrive as a fresh object after every change (even to the bed),
  // so key the image and font on their stored file ids. That keeps params
  // stable when only unrelated settings change, which lets the canvas reuse
  // tags it has already built.
  const imageKey = settings
    ? settings.image.type === "custom"
      ? `custom:${settings.image.file}`
      : settings.image.type
    : null;
  const image = useMemo(
    () => (settings ? imageFromSettings(settings) : null),
    [imageKey],
  );
  const fontFile =
    settings?.font.type === "custom" ? settings.font.file : null;

  // Hold off building until settings have loaded, so the first build
  // already uses the saved image and font.
  const params = useMemo<NametagParams | null>(
    () =>
      settings && image && controlParams
        ? {
            ...controlParams,
            image,
            fontFile,
          }
        : null,
    [controlParams, settings !== undefined, image, fontFile],
  );

  const bed = settings?.bed ?? DEFAULT_BED;
  const bedKey = `${bed.width}x${bed.height}+${bed.spacing}`;
  const job = useMemo<BuildJob | null>(
    () => (params ? { params, names: nameList, bed } : null),
    // The bed only matters when there's a list to lay out.
    [params, nameList, nameList ? bedKey : null],
  );

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <Stack direction="row" sx={{ flex: 1, minHeight: 0 }}>
          <Box sx={{ flex: 1, overflow: "hidden", position: "relative" }}>
            {job && (
              <ThreeCanvas
                job={job}
                colors={colors}
                onProgress={setProgress}
                onBuildResult={setBuild}
              />
            )}
          </Box>
          <Stack
            direction="column"
            sx={{ width: 300, p: 2, gap: 2, overflowY: "auto" }}
          >
            <Typography variant="h6">Controls</Typography>
            <Typography variant="body2">
              All dimensions are in millimeters.
            </Typography>
            {controlParams && (
              <Controls
                onCommit={commitParams}
                colors={colors}
                onColorsChange={setColors}
                defaults={controlParams}
                progress={progress}
                calculatedWidth={build.width}
                nameList={nameList}
                batch={build.batch}
                onClearList={() => setNameList(null)}
              />
            )}
            {build.error && (
              <Alert severity="error">Build failed: {build.error}</Alert>
            )}
            {build.warnings.map((w) => (
              <Alert key={w} severity="warning">
                {w}
              </Alert>
            ))}
          </Stack>
        </Stack>
      </Box>
      {settings && (
        <SettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={settings}
          onChange={setSettings}
        />
      )}
      <Dialog open={aboutOpen} onClose={() => setAboutOpen(false)}>
        <DialogTitle>About</DialogTitle>
        <DialogContent>
          <Typography>Nametag Maker v0.1.0</Typography>
          <Typography variant="body2" color="text.secondary">
            A simple tool for creating 3D-printable name tags.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Created by Adrian Herbez.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAboutOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}
