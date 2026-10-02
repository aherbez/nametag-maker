import { useState, type KeyboardEvent } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { BedSettings, SettingsView } from "../shared/types";
import { svgToPolygons } from "./svg";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  settings: SettingsView;
  onChange: (settings: SettingsView) => void;
}

// ipcRenderer.invoke wraps errors as "Error invoking remote method '…':
// Error: <message>"; keep just the message.
function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']*': (Error: )?/, "");
}

export default function SettingsDialog({
  open,
  onClose,
  settings,
  onChange,
}: SettingsDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Bed fields are drafts until Enter is pressed or a field loses focus,
  // matching the sidebar.
  const [bedDraft, setBedDraft] = useState<BedSettings>(settings.bed);
  const commitBed = () => {
    const b = settings.bed;
    if (
      bedDraft.width === b.width &&
      bedDraft.height === b.height &&
      bedDraft.spacing === b.spacing
    ) {
      return;
    }
    run(() => window.electronAPI.setBed(bedDraft));
  };
  const bedField = (key: keyof BedSettings, label: string, min: number) => (
    <TextField
      label={label}
      type="number"
      size="small"
      defaultValue={settings.bed[key]}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter") commitBed();
      }}
      onBlur={commitBed}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (v >= min) setBedDraft((d) => ({ ...d, [key]: v }));
      }}
    />
  );

  const run = async (action: () => Promise<SettingsView | null>) => {
    setBusy(true);
    setError(undefined);
    try {
      const next = await action();
      if (next) onChange(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseSvg = () =>
    run(async () => {
      const picked = await window.electronAPI.pickSvg();
      if (!picked) return null;
      // Check it before committing, so a bad file never replaces a good one.
      let shapes = 0;
      try {
        shapes = svgToPolygons(picked.svgText).length;
      } catch {
        throw new Error(`${picked.name} couldn't be read as an SVG.`);
      }
      if (shapes === 0) {
        throw new Error(
          `${picked.name} has no filled shapes to raise (stroke-only paths aren't supported).`,
        );
      }
      return window.electronAPI.commitSvg();
    });

  const { image, font } = settings;
  const imageLabel =
    image.type === "custom"
      ? image.name
      : image.type === "none"
        ? "No image"
        : "Default (star)";
  const fontLabel =
    font.type === "custom"
      ? font.name
      : `System default (${settings.defaultFontName})`;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Settings</DialogTitle>
      <DialogContent>
        <Stack spacing={3}>
          <Typography variant="body2" color="text.secondary">
            Chosen files are copied into the app's own storage, so they keep
            working if you move or delete the originals.
          </Typography>

          <Stack spacing={1}>
            <Typography variant="subtitle2">Image</Typography>
            <Typography variant="body2" noWrap title={imageLabel}>
              {imageLabel}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button variant="outlined" disabled={busy} onClick={chooseSvg}>
                Choose SVG…
              </Button>
              <Button
                disabled={busy || image.type === "default"}
                onClick={() => run(() => window.electronAPI.setImage("default"))}
              >
                Use default
              </Button>
              <Button
                disabled={busy || image.type === "none"}
                onClick={() => run(() => window.electronAPI.setImage("none"))}
              >
                No image
              </Button>
            </Stack>
          </Stack>

          <Stack spacing={1}>
            <Typography variant="subtitle2">Font</Typography>
            <Typography variant="body2" noWrap title={fontLabel}>
              {fontLabel}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() => run(() => window.electronAPI.pickFont())}
              >
                Choose font…
              </Button>
              <Button
                disabled={busy || font.type === "default"}
                onClick={() => run(() => window.electronAPI.resetFont())}
              >
                Use default
              </Button>
            </Stack>
          </Stack>

          <Stack spacing={1}>
            <Typography variant="subtitle2">Print bed</Typography>
            <Typography variant="body2" color="text.secondary">
              Used when loading names from a CSV (File → Load CSV…): tags are
              packed onto beds of this size, one STL file per bed.
            </Typography>
            <Stack direction="row" spacing={1}>
              {bedField("width", "Bed width", 1)}
              {bedField("height", "Bed height", 1)}
              {bedField("spacing", "Separation", 0)}
            </Stack>
          </Stack>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
