import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { namesFromCsv } from "../shared/csv";
import type { NameList } from "../shared/types";

// The list as last typed (saved on every edit, even if the dialog is then
// cancelled), so the dialog can offer it again next time. It's never
// loaded as a batch on its own.
const DRAFT_KEY = "nameListDraft";

// Stands in for a CSV file's name when exporting and in the sidebar.
const BASE_NAME = "name-list";

function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveDraft(text: string) {
  try {
    localStorage.setItem(DRAFT_KEY, text);
  } catch {
    // Storage unavailable; the draft just won't persist.
  }
}

interface NameListDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the names when "Generate Models" is pressed. */
  onGenerate: (list: NameList) => void;
}

/** Type or paste names, one per line (or comma-separated, like a CSV). */
export default function NameListDialog({
  open,
  onClose,
  onGenerate,
}: NameListDialogProps) {
  const [text, setText] = useState(loadDraft);

  // Pick up the saved draft each time the dialog opens.
  useEffect(() => {
    if (open) setText(loadDraft());
  }, [open]);

  const names = namesFromCsv(text);

  const generate = () => {
    onGenerate({ baseName: BASE_NAME, names });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Enter a list of names</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          multiline
          fullWidth
          minRows={8}
          maxRows={16}
          margin="dense"
          placeholder={"One name per line"}
          helperText={`${names.length} name${names.length === 1 ? "" : "s"}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            saveDraft(e.target.value);
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={names.length === 0}
          onClick={generate}
        >
          Generate Models
        </Button>
      </DialogActions>
    </Dialog>
  );
}
