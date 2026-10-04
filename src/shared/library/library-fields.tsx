import { Input, Label } from "@/shared/components/ui";
import { cn } from "@/shared/lib/utils";
import { NAME_MAX } from "./rules";
import type { LibraryDraft, LibraryField } from "./types";

export interface FieldError {
  field: LibraryField | null;
  message: string;
}

export function ChoiceChips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-control text-small border px-2.5 py-1 transition-colors",
            value === o.id
              ? "border-primary bg-primary/10 text-foreground"
              : "text-muted-foreground hover:border-foreground/20 hover:bg-muted/40",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const KIND_OPTIONS: { id: LibraryDraft["kind"]; label: string }[] = [
  { id: "query", label: "Query" },
  { id: "snippet", label: "Snippet" },
];

export const LANGUAGE_OPTIONS: {
  id: LibraryDraft["language"];
  label: string;
}[] = [
  { id: "sql", label: "SQL" },
  { id: "mongo", label: "Mongo" },
];

export function FieldMessage({
  id,
  error,
  field,
}: {
  id: string;
  error: FieldError | null;
  field: LibraryField;
}) {
  if (error?.field !== field) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-small">
      {error.message}
    </p>
  );
}

/** Name, kind, optional language, and (for snippets) trigger. Text is edited
 *  by the caller. */
export function LibraryFields({
  idPrefix,
  draft,
  onChange,
  error,
  showLanguage = false,
  autoFocusName = false,
}: {
  idPrefix: string;
  draft: LibraryDraft;
  onChange: (draft: LibraryDraft) => void;
  error: FieldError | null;
  showLanguage?: boolean;
  autoFocusName?: boolean;
}) {
  const nameId = `${idPrefix}-name`;
  const triggerId = `${idPrefix}-trigger`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          autoFocus={autoFocusName}
          value={draft.name}
          maxLength={NAME_MAX + 20}
          aria-invalid={error?.field === "name"}
          aria-describedby={
            error?.field === "name" ? `${nameId}-error` : undefined
          }
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="Active users by signup month"
        />
        <FieldMessage id={`${nameId}-error`} error={error} field="name" />
      </div>
      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col gap-1">
          <Label>Kind</Label>
          <ChoiceChips
            label="Kind"
            value={draft.kind}
            options={KIND_OPTIONS}
            onChange={(kind) =>
              onChange({
                ...draft,
                kind,
                trigger: kind === "query" ? null : draft.trigger,
              })
            }
          />
        </div>
        {showLanguage && (
          <div className="flex flex-col gap-1">
            <Label>Language</Label>
            <ChoiceChips
              label="Language"
              value={draft.language}
              options={LANGUAGE_OPTIONS}
              onChange={(language) => onChange({ ...draft, language })}
            />
          </div>
        )}
      </div>
      {draft.kind === "snippet" && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={triggerId}>
            Trigger <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id={triggerId}
            className="font-mono"
            value={draft.trigger ?? ""}
            aria-invalid={error?.field === "trigger"}
            aria-describedby={
              error?.field === "trigger"
                ? `${triggerId}-error`
                : `${triggerId}-hint`
            }
            onChange={(e) => onChange({ ...draft, trigger: e.target.value })}
            placeholder="sel"
          />
          {error?.field === "trigger" ? (
            <FieldMessage
              id={`${triggerId}-error`}
              error={error}
              field="trigger"
            />
          ) : (
            <p
              id={`${triggerId}-hint`}
              className="text-muted-foreground text-small"
            >
              Type it in the editor to insert the snippet. Letters, digits and _
              only.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
