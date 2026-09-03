import { useState } from "react";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

/** Click-to-edit text cell: renders as a quiet button until clicked, then an
 *  inline input. Enter or blur commits, Escape cancels. While `disabled`
 *  (e.g. an Apply is in flight) it renders as inert plain text and any open
 *  editor closes without committing. */
export function EditableText({
  value,
  on_commit,
  className,
  placeholder,
  ariaLabel,
  disabled = false,
}: {
  value: string;
  on_commit: (v: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  // An Apply can start while a cell editor is open (the Apply button lives in
  // the status bar) — close the editor so nothing commits mid-flight. State
  // adjustment during render (not an effect) keeps react-hooks happy.
  const [was_disabled, setWas_disabled] = useState(disabled);
  if (disabled !== was_disabled) {
    setWas_disabled(disabled);
    if (disabled) setEditing(false);
  }

  if (disabled && !editing) {
    return (
      <span
        aria-label={ariaLabel}
        className={cn(
          "w-full truncate px-1 py-0.5 text-left opacity-60",
          className,
        )}
      >
        {value || (
          <span className="text-muted-foreground/60">{placeholder ?? "–"}</span>
        )}
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        title={ariaLabel}
        className={cn(
          "hover:bg-muted focus-visible:ring-ring/50 w-full truncate rounded px-1 py-0.5 text-left focus-visible:ring-2",
          className,
        )}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {value || (
          <span className="text-muted-foreground/60">{placeholder ?? "–"}</span>
        )}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    if (draft !== value) on_commit(draft);
  };
  return (
    <Input
      autoFocus
      value={draft}
      placeholder={placeholder}
      aria-label={ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setEditing(false);
      }}
      onBlur={commit}
      className={cn("h-7", className)}
    />
  );
}
