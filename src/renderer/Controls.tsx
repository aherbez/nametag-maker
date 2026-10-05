import { useState, type KeyboardEvent } from "react";
import {
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  MAGNET_CLEARANCE,
  MAGNET_POCKET_SHORTFALL,
  type ControlParams,
  type NameList,
  type TagColors,
} from "../shared/types";
import type { BuildProgress, BuildSummary } from "./ThreeCanvas";

interface ControlsProps {
  /**
   * Called with the full set of values when Enter is pressed in a field or
   * a field loses focus.
   */
  onCommit: (params: ControlParams) => void;
  colors: TagColors;
  onColorsChange: (colors: TagColors) => void;
  defaults: ControlParams;
  progress: BuildProgress;
  /** Width of the most recent build, which is set by its content. */
  calculatedWidth?: number;
  /** The loaded CSV, if any; its names replace the Name field. */
  nameList: NameList | null;
  batch?: BuildSummary["batch"];
  onClearList: () => void;
}

type NumericKey = {
  [K in keyof ControlParams]: ControlParams[K] extends number ? K : never;
}[keyof ControlParams];

export default function Controls({
  onCommit,
  colors,
  onColorsChange,
  defaults,
  progress,
  nameList,
  batch,
  onClearList,
}: ControlsProps) {
  const loading = progress !== null;
  const [params, setParams] = useState(defaults);

  const set = <K extends keyof ControlParams>(key: K, v: ControlParams[K]) =>
    setParams((p) => ({ ...p, [key]: v }));

  // Edits are drafts until Enter is pressed or the field loses focus, so
  // the (slow) rebuild doesn't run on every keystroke.
  const commitOnEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter") onCommit(params);
  };
  const commit = () => onCommit(params);

  const numberField = (
    key: NumericKey,
    label: string,
    min: number,
    helperText?: string,
  ) => (
    <TextField
      label={label}
      type="number"
      size="small"
      helperText={helperText}
      defaultValue={defaults[key]}
      onKeyDown={commitOnEnter}
      onBlur={commit}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (v >= min) set(key, v);
      }}
    />
  );

  return (
    <Stack direction="column" spacing={2}>
      <Typography variant="subtitle2">Preview colors</Typography>
      <Stack direction="row" spacing={2}>
        <TextField
          label="Base"
          type="color"
          size="small"
          fullWidth
          value={colors.base}
          onChange={(e) => onColorsChange({ ...colors, base: e.target.value })}
        />
        <TextField
          label="Image & text"
          type="color"
          size="small"
          fullWidth
          value={colors.relief}
          onChange={(e) =>
            onColorsChange({ ...colors, relief: e.target.value })
          }
        />
      </Stack>

      <Button
        variant="contained"
        disabled={loading}
        startIcon={loading ? <CircularProgress size={16} /> : undefined}
        onClick={() => window.electronAPI.triggerExportSTL()}
      >
        {progress
          ? progress.total > 1
            ? `Building ${progress.done + 1} of ${progress.total}…`
            : "Building…"
          : nameList && batch
            ? `Save ${batch.beds} STL file${batch.beds === 1 ? "" : "s"}`
            : "Save STL"}
      </Button>
      <Typography variant="subtitle2">Raised image &amp; text</Typography>
      {nameList ? (
        <Stack spacing={1}>
          <Typography variant="body2">
            Names from <b>{nameList.baseName}</b>: {nameList.names.length}
            {batch &&
              !loading &&
              ` → ${batch.tags} tag${batch.tags === 1 ? "" : "s"} on ${batch.beds} bed${batch.beds === 1 ? "" : "s"}`}
          </Typography>
          <Button size="small" variant="outlined" onClick={onClearList}>
            Clear list (back to one tag)
          </Button>
        </Stack>
      ) : (
        <TextField
          label="Name"
          size="small"
          defaultValue={params.text}
          onKeyDown={commitOnEnter}
          onBlur={commit}
          onChange={(e) => set("text", e.target.value)}
        />
      )}
      {numberField("reliefHeight", "Raise height", 0.1)}
      {numberField("margin", "Margin", 0)}
      {numberField("imageSize", "Image size", 1)}
      
      <Typography variant="subtitle2">Base plate</Typography>
      {numberField("depth", "Depth", 5)}
      {numberField("thickness", "Thickness", 0.5)}
      {numberField("cornerRadius", "Corner radius", 0)}
      {numberField("edgeFillet", "Edge fillet", 0)}

      

      <Typography variant="subtitle2">Magnets</Typography>
      <Typography variant="body2" color="text.secondary">
        Two pockets in the bottom, {MAGNET_CLEARANCE} mm wider and{" "}
        {MAGNET_POCKET_SHORTFALL} mm shallower than the magnet. Set diameter
        or height to 0 to leave them out.
      </Typography>
      {numberField("magnetDiameter", "Magnet diameter", 0)}
      {numberField("magnetHeight", "Magnet height", 0)}
      {numberField("magnetSpacing", "Magnet spacing (center to center)", 0)}

      <Typography variant="subtitle2">Magnet backing</Typography>
      <Typography variant="body2" color="text.secondary">
        A separate plate, one per tag, with cups that hold the matching
        magnets. Its width fits both cups with the margin to either side.
      </Typography>
      {numberField(
        "backingDepth",
        "Backing depth",
        0,
        "0 for twice the magnet diameter",
      )}
      {numberField("backingHeight", "Backing height", 0.1)}

    </Stack>
  );
}
