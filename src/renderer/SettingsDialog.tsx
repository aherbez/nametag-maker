import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import type { SettingsView } from "../shared/types";
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

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
