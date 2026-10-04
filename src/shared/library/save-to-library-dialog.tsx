import { useState } from "react";
import { BookmarkPlus } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui";
import { useStudioStore } from "@/shared/store";
import { FieldMessage, LibraryFields, type FieldError } from "./library-fields";
import type { LibraryDraft } from "./types";

/** Saves editor text to the library. `seed` opens it; null closes it. */
export function SaveToLibraryDialog({
  seed,
  onClose,
}: {
  seed: LibraryDraft | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={seed !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {seed && <SaveForm key={seed.text} seed={seed} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function SaveForm({
  seed,
  onClose,
}: {
  seed: LibraryDraft;
  onClose: () => void;
}) {
  const addItem = useStudioStore((s) => s.addLibraryItem);
  const [draft, setDraft] = useState(seed);
  const [error, setError] = useState<FieldError | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await addItem(draft);
    setBusy(false);
    if (result.ok) onClose();
    else setError(result);
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <BookmarkPlus className="size-4" />
          Save to library
        </DialogTitle>
        <DialogDescription>
          Available on every {seed.language === "sql" ? "SQL" : "Mongo"}{" "}
          connection, in suggestions and in Settings, Library.
        </DialogDescription>
      </DialogHeader>
      <LibraryFields
        idPrefix="save-library"
        draft={draft}
        onChange={(d) => {
          setDraft(d);
          setError(null);
        }}
        error={error}
        autoFocusName
      />
      <div className="flex flex-col gap-1">
        <span className="text-small text-muted-foreground">Text</span>
        <pre className="bg-muted/40 rounded-control text-small max-h-40 overflow-auto border p-2 font-mono whitespace-pre-wrap">
          {draft.text}
        </pre>
        <FieldMessage id="save-library-text-error" error={error} field="text" />
      </div>
      {error && error.field === null && (
        <p role="alert" className="text-destructive text-small">
          {error.message}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
