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
  type ControlParams,
  type TagColors,
} from "../shared/types";

interface ControlsProps {
  /**
   * Called with the full set of values when Enter is pressed in a field or
   * a field loses focus.
   */
  onCommit: (params: ControlParams) => void;
  colors: TagColors;
  onColorsChange: (colors: TagColors) => void;
  defaults: ControlParams;
  loading?: boolean;
  /** Width of the most recent build, which is set by its content. */
  calculatedWidth?: number;
}

type NumericKey = {
  [K in keyof ControlParams]: ControlParams[K] extends number ? K : never;
}[keyof ControlParams];

export default function Controls({
  onCommit,
  colors,
  onColorsChange,
  defaults,
  loading,
  calculatedWidth,
}: ControlsProps) {
  const [params, setParams] = useState(defaults);

  const set = <K extends keyof ControlParams>(key: K, v: ControlParams[K]) =>
    setParams((p) => ({ ...p, [key]: v }));

  // Edits are drafts until Enter is pressed or the field loses focus, so
  // the (slow) rebuild doesn't run on every keystroke.
  const commitOnEnter = (e: KeyboardEvent) => {
    if (e.key === "Enter") onCommit(params);
  };
  const commit = () => onCommit(params);

  const numberField = (key: NumericKey, label: string, min: number) => (
    <TextField
      label={label}
      type="number"
      size="small"
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
      <Typography variant="body2" color="text.secondary">
        Changes apply when you press Enter or leave a field.
      </Typography>
      <Typography variant="subtitle2">Base plate</Typography>
      <TextField
        label="Width (from content)"
        size="small"
        value={
          calculatedWidth === undefined ? "—" : calculatedWidth.toFixed(1)
        }
        disabled
        helperText="Margins + image + text"
      />
      {numberField("depth", "Depth", 5)}
      {numberField("thickness", "Thickness", 0.5)}
      {numberField("cornerRadius", "Corner radius", 0)}
      {numberField("edgeFillet", "Edge fillet", 0)}

      <Typography variant="subtitle2">Raised image &amp; text</Typography>
      {numberField("reliefHeight", "Raise height", 0.1)}
      {numberField("margin", "Margin", 0)}

      {numberField("imageSize", "Image size", 1)}

      <TextField
        label="Name"
        size="small"
        defaultValue={defaults.text}
        onKeyDown={commitOnEnter}
        onBlur={commit}
        onChange={(e) => set("text", e.target.value)}
      />

      <Typography variant="subtitle2">Magnets</Typography>
      <Typography variant="body2" color="text.secondary">
        Two pockets in the bottom, {MAGNET_CLEARANCE} mm wider than the
        magnet. Set either value to 0 to leave them out.
      </Typography>
      {numberField("magnetDiameter", "Magnet diameter", 0)}
      {numberField("magnetDepth", "Magnet inset depth", 0)}

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
        {loading ? "Building…" : "Save STL"}
      </Button>
    </Stack>
  );
}
