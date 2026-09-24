import { Checkbox, Label, Switch } from "@/shared/components/ui";
import type { ImportOnError } from "@/shared/api";
import type { Encoding, ParseOptions, ParsedFile } from "../lib/types";

const SELECT = "bg-background h-7 rounded-md border px-2 text-sm";

interface Props {
  parsed: ParsedFile;
  opts: ParseOptions;
  onOpts: (o: ParseOptions) => void;
  emptyAsText: boolean;
  onEmptyAsText: (v: boolean) => void;
  onError: ImportOnError;
  onOnError: (v: ImportOnError) => void;
  /** A document store: wording for the empty cell rule changes. */
  documents?: boolean;
}

/** The choices that shape how the file is read and how bad rows are handled. */
export function FileOptions(p: Props) {
  const text = p.parsed.format !== "xlsx";
  const table = p.parsed.format === "csv" || p.parsed.format === "xlsx";
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
      {text && (
        <label className="flex items-center justify-between gap-2">
          Encoding
          <select
            className={SELECT}
            value={p.opts.encoding}
            onChange={(e) =>
              p.onOpts({ ...p.opts, encoding: e.target.value as Encoding })
            }
          >
            <option value="utf-8">UTF-8</option>
            <option value="utf-16">UTF-16</option>
            <option value="windows-1252">Windows-1252</option>
          </select>
        </label>
      )}
      {p.parsed.sheets && p.parsed.sheets.length > 1 && (
        <label className="flex items-center justify-between gap-2">
          Sheet
          <select
            className={SELECT}
            value={p.parsed.sheet}
            onChange={(e) => p.onOpts({ ...p.opts, sheet: e.target.value })}
          >
            {p.parsed.sheets.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      )}
      {table && (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="import-header">First row is the header</Label>
          <Switch
            id="import-header"
            checked={p.opts.hasHeader}
            onCheckedChange={(v) => p.onOpts({ ...p.opts, hasHeader: v })}
          />
        </div>
      )}
      <label className="flex items-center justify-between gap-2">
        Bad rows
        <select
          className={SELECT}
          value={p.onError}
          onChange={(e) => p.onOnError(e.target.value as ImportOnError)}
        >
          <option value="rollback">Roll back everything</option>
          <option value="skip">Skip them, load the rest</option>
        </select>
      </label>
      {table && (
        <div className="col-span-2 flex items-center gap-2">
          <Checkbox
            id="import-empty"
            checked={p.emptyAsText}
            onCheckedChange={(v) => p.onEmptyAsText(v === true)}
          />
          <Label htmlFor="import-empty">
            {p.documents
              ? "Load an empty cell as an empty string in text fields (default is to leave the field out)"
              : "Load an empty cell as an empty string in text columns (default is NULL)"}
          </Label>
        </div>
      )}
    </div>
  );
}
