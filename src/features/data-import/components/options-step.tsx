import { RefreshCw } from "lucide-react";
import { Button, Checkbox, Input, Label, Switch } from "@/shared/components/ui";
import { cn } from "@/shared/lib/utils";
import type { Encoding, ParseOptions, ParsedFile } from "../lib/types";

const SELECT = "bg-input/30 h-9 w-full rounded-md border px-2 text-sm";
const FORMATS = {
  csv: "CSV",
  json: "JSON",
  jsonl: "JSON Lines",
  xlsx: "Excel",
};

interface Props {
  fileName: string;
  parsed: ParsedFile;
  draft: ParseOptions;
  onDraft: (o: ParseOptions) => void;
  /** The draft differs from what the preview was read with. */
  stale: boolean;
  onReload: () => void;
  isNew: boolean;
  onMode: (mode: "existing" | "new") => void;
  existingTable?: string;
  noun: string;
  name: string;
  onName: (name: string) => void;
  emptyAsText: boolean;
  onEmptyAsText: (v: boolean) => void;
  documents: boolean;
}

/** Step 2: how the file is read, and where it goes. */
export function OptionsStep(p: Props) {
  const text = p.parsed.format !== "xlsx";
  const table = p.parsed.format === "csv" || p.parsed.format === "xlsx";
  const choices = [
    {
      mode: "existing" as const,
      title: `Existing ${p.noun}`,
      hint: p.existingTable ?? "Open one from the sidebar",
      disabled: !p.existingTable,
    },
    {
      mode: "new" as const,
      title: `Create ${p.noun}`,
      hint: "Infer columns from the file",
      disabled: false,
    },
  ];
  return (
    <div className="min-w-0 space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Source format">
          <Input
            className="bg-input/30 h-9"
            readOnly
            value={FORMATS[p.parsed.format]}
            aria-label="Source format"
          />
        </Field>
        {p.parsed.sheets && p.parsed.sheets.length > 1 ? (
          <Field label="Sheet">
            <select
              className={SELECT}
              value={p.draft.sheet ?? p.parsed.sheet}
              onChange={(e) => p.onDraft({ ...p.draft, sheet: e.target.value })}
            >
              {p.parsed.sheets.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Rows found">
            <Input
              className="bg-input/30 h-9"
              readOnly
              value={p.parsed.rows.length.toLocaleString()}
              aria-label="Rows found"
            />
          </Field>
        )}
        <Field label="Source file">
          <Input
            className="bg-input/30 h-9"
            readOnly
            value={p.fileName}
            aria-label="Source file"
          />
        </Field>
      </div>

      <section className="bg-accent/40 space-y-2 rounded-lg border p-3">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr]">
          <Field label="Target">
            <div className="grid grid-cols-2 gap-2">
              {choices.map((c) => {
                const on = p.isNew === (c.mode === "new");
                return (
                  <button
                    key={c.mode}
                    type="button"
                    disabled={c.disabled}
                    aria-pressed={on}
                    onClick={() => p.onMode(c.mode)}
                    className={cn(
                      "bg-input/30 rounded-md border px-3 py-2 text-left disabled:opacity-50",
                      on && "border-foreground",
                    )}
                  >
                    <span className="block text-sm font-medium">{c.title}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {c.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label={p.documents ? "Collection name" : "Table name"}>
            <Input
              className="bg-input/30 h-9"
              value={p.isNew ? p.name : (p.existingTable ?? "")}
              readOnly={!p.isNew}
              aria-label={`${p.isNew ? "New" : "Target"} ${p.noun} name`}
              onChange={(e) => p.onName(e.target.value)}
            />
          </Field>
        </div>
      </section>

      <section className="bg-accent/40 space-y-3 rounded-lg border p-3">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {text && (
            <Field label="Encoding">
              <select
                className={SELECT}
                value={p.draft.encoding}
                onChange={(e) =>
                  p.onDraft({
                    ...p.draft,
                    encoding: e.target.value as Encoding,
                  })
                }
              >
                <option value="utf-8">UTF-8</option>
                <option value="utf-16">UTF-16</option>
                <option value="windows-1252">Windows-1252</option>
              </select>
            </Field>
          )}
          {table && (
            <div className="flex items-end gap-2 pb-2">
              <Switch
                id="import-header"
                checked={p.draft.hasHeader}
                onCheckedChange={(v) => p.onDraft({ ...p.draft, hasHeader: v })}
              />
              <Label htmlFor="import-header">First row is the header</Label>
            </div>
          )}
        </div>
        {table && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="import-empty"
              checked={!p.emptyAsText}
              onCheckedChange={(v) => p.onEmptyAsText(v !== true)}
            />
            <Label htmlFor="import-empty">
              {p.documents
                ? "Leave out a field when its cell is empty"
                : "Empty string as NULL"}
            </Label>
          </div>
        )}
      </section>

      <div className="flex items-center gap-3 text-sm">
        <Button
          variant={p.stale ? "default" : "secondary"}
          onClick={p.onReload}
        >
          <RefreshCw className="size-4" />
          Reload Preview
        </Button>
        <span className="text-muted-foreground">
          {p.stale
            ? "Options changed. Reload to read the file with them."
            : `Read ${p.parsed.rows.length.toLocaleString()} rows, ${p.parsed.header.length} columns.`}
        </span>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="text-sm font-medium">{label}</div>
      {children}
    </div>
  );
}
