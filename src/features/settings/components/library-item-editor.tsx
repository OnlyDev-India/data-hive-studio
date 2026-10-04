import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/shared/components/ui";
import { QueryEditor } from "@/shared/components/query-editor";
import {
  FieldMessage,
  LibraryFields,
  type FieldError,
} from "@/shared/library/library-fields";
import type { LibraryDraft, LibraryItem } from "@/shared/library/types";
import { useStudioStore } from "@/shared/store";

const noop = () => {};

export const NEW_DRAFT: LibraryDraft = {
  kind: "query",
  language: "sql",
  name: "",
  text: "",
  trigger: null,
};

/** Create (no `item`) or edit one library item. */
export function LibraryItemEditor({
  item,
  onDone,
}: {
  item: LibraryItem | null;
  onDone: () => void;
}) {
  const addItem = useStudioStore((s) => s.addLibraryItem);
  const updateItem = useStudioStore((s) => s.updateLibraryItem);
  const [draft, setDraft] = useState<LibraryDraft>(item ?? NEW_DRAFT);
  const [error, setError] = useState<FieldError | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (d: LibraryDraft) => {
    setDraft(d);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = item
      ? await updateItem(item.id, draft)
      : await addItem(draft);
    setBusy(false);
    if (result.ok) onDone();
    else setError(result);
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          aria-label="Back to the library"
          onClick={onDone}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <h2 className="text-heading font-semibold">
          {item ? "Edit item" : "New item"}
        </h2>
      </header>

      <LibraryFields
        idPrefix="library-item"
        draft={draft}
        onChange={change}
        error={error}
        showLanguage
        autoFocusName
      />

      <div className="flex flex-col gap-1">
        <span className="text-body font-medium">Text</span>
        {draft.kind === "snippet" && (
          <p className="text-muted-foreground text-small">
            Write <code className="font-mono">{"${1:name}"}</code> for a tab
            stop and <code className="font-mono">{"\\{"}</code> for a literal
            brace.
          </p>
        )}
        <div
          className="rounded-surface h-72 overflow-hidden border"
          aria-invalid={error?.field === "text"}
        >
          <QueryEditor
            key={draft.language}
            value={draft.text}
            onChange={(text) => change({ ...draft, text })}
            onRun={noop}
            onRunTarget={noop}
            language={draft.language === "mongo" ? "js" : "sql"}
            showLineNumber={false}
            frameLayer={false}
            lintEnabled={false}
            showInsertLabels={false}
            placeholder={
              draft.language === "mongo"
                ? "db.users.find({ status: 'active' })"
                : "SELECT * FROM users WHERE active;"
            }
            height="100%"
          />
        </div>
        <FieldMessage id="library-item-text-error" error={error} field="text" />
      </div>

      {error && error.field === null && (
        <p role="alert" className="text-destructive text-small">
          {error.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {item ? "Save changes" : "Add to library"}
        </Button>
      </div>
    </form>
  );
}
