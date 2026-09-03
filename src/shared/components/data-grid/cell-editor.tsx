import { useEffect, useRef, useState } from "react";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Button } from "@/shared/components/ui/button";
import { DatePicker } from "./date-picker";
import { useGrid } from "./grid-context";
import type { CellKind } from "./types";

/** The in-place editor shown while a cell is being edited. The target cell is
 * read from the grid's `editing` state, so no props are needed. Auto-commits on
 * Enter/blur (or selection change for dropdowns) and cancels on Escape.
 *
 * Per-kind editors:
 *  - text: single-line input, but switches to an overlaying TEXTAREA when the
 *    value contains newlines or is long (multi-line / large text).
 *  - number: numeric input (integers reject decimals via step=1).
 *  - bool: tri-state checkbox (checked/unchecked/null when nullable).
 *  - enum: dropdown fed by the column's distinct values.
 *  - date/datetime: calendar popover (DatePicker).
 *  - json: textarea with monospace styling; commits raw JSON text. */
export function CellEditor() {
  const ctx = useGrid();
  const {
    editing,
    editAsText,
    rows,
    col_index_of,
    kinds,
    types,
    distinct,
    nullable,
    pending_count,
    on_pending_edit,
    on_edit_cell,
    close_editor,
  } = ctx;
  const [row, col] = editing!;
  const ci = col_index_of[col] ?? 0;
  const row_data = rows[row] ?? [];
  const value = row_data[ci] ?? null;
  const kind: CellKind = kinds[col] ?? "text";
  const sql_type = (types?.[col] ?? "").toLowerCase();
  const options = distinct[col] ?? [];
  const col_nullable = nullable?.[col] ?? true;

  // Multi-line / large-text detection: newlines anywhere or long content.
  const multiline =
    kind === "text" &&
    !editAsText &&
    ((value?.includes("\n") ?? false) || (value?.length ?? 0) > 60);
  const is_number =
    /^(smallint|integer|int|bigint|serial|bigserial|decimal|numeric|real|double precision|double|float)/i.test(
      sql_type.trim(),
    ) || /^(int2|int4|int8|float4|float8|numeric)$/i.test(sql_type.trim());
  const [val, setVal] = useState(value ?? "");

  const ref = useRef<HTMLInputElement>(null);
  const area_ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (multiline || is_json_kind(sql_type)) area_ref.current?.focus();
    else ref.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus once on mount only
  }, []);

  // Transform back when committing.
  const toDb = (v: string) =>
    kind === "datetime" ? v.replaceAll("T", " ") : v;
  // Debounced live publish: while the user types, push the value into the
  // grid's buffer after a short pause so it shows up in the grid and the JSON
  // viewer without waiting for Enter/blur. on_edit_cell is idempotent (it only
  // adds/removes a cell in the dirty set), so repeated pushes are safe.
  const live_ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  const push_live = (raw: string) => {
    if (live_ref.current !== null) clearTimeout(live_ref.current);
    live_ref.current = setTimeout(() => {
      live_ref.current = null;
      const db = toDb(raw);
      if (row < pending_count) on_pending_edit(row, col, db);
      else on_edit_cell(row, col, db);
    }, 400);
  };
  // Clicking outside can unmount the editor before blur fires — persist the
  // typed value on unmount unless it was already committed (Enter/blur).
  const committed = useRef(false);
  const val_ref = useRef(val);
  useEffect(() => {
    val_ref.current = val;
  });
  useEffect(
    () => () => {
      if (live_ref.current !== null) clearTimeout(live_ref.current);
      if (committed.current || cancelled.current) return;
      const cur = val_ref.current;
      if (cur === (value ?? "")) return;
      const db = toDb(cur);
      if (row < pending_count) on_pending_edit(row, col, db);
      else on_edit_cell(row, col, db);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount-only flush
    [],
  );

  const commit = (raw?: string | null) => {
    committed.current = true;
    const newVal = raw === null ? null : toDb(raw !== undefined ? raw : val);
    // Nothing is written to the DB from the editor: edits on a pending row go
    // into the draft, edits on a real row buffer until the user hits Apply.
    if (row < pending_count) {
      on_pending_edit(row, col, newVal);
    } else {
      on_edit_cell(row, col, newVal);
    }
    close_editor();
  };

  // Escape discards: flag it so the unmount flush doesn't write the draft.
  const cancelled = useRef(false);
  const cancel = () => {
    // eslint-disable-next-line react-hooks/immutability -- event handler, not render
    cancelled.current = true;
    close_editor();
  };

  /** Overlaying multi-line editor: anchored on top of the cell, grows with
   *  content, Ctrl+Enter or blur commits, Escape cancels. */
  // Multi-line / large-text editor: a Popover anchored to the cell (Base UI
  // handles positioning, flipping and portaling) containing the textarea.
  const multiline_editor = () => {
    const json = is_json_kind(sql_type);
    return (
      <div className="absolute -top-3 left-1 z-40! min-w-80">
        {json ? (
          // JSON: highlighted backdrop under a see-through textarea.
          <div className="relative">
            <pre
              aria-hidden
              className="wrap-break-words bg-background pointer-events-none min-h-32 w-full resize-none overflow-hidden rounded-md border p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap"
            >
              {highlight_json(val)}
            </pre>
            <Textarea
              ref={area_ref}
              autoFocus
              value={val}
              onChange={(e) => {
                setVal(e.target.value);
                push_live(e.target.value);
              }}
              onScroll={(e) => {
                const pre = e.currentTarget
                  .previousSibling as HTMLPreElement | null;
                if (pre) pre.scrollTop = e.currentTarget.scrollTop;
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  // eslint-disable-next-line react-hooks/refs -- event handler
                  cancel();
                } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  // eslint-disable-next-line react-hooks/refs -- event handler
                  commit();
                }
              }}
              className="wrap-break-words caret-foreground absolute inset-0 h-full resize-none overflow-auto bg-transparent p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-transparent"
            />
          </div>
        ) : (
          <Textarea
            ref={area_ref}
            autoFocus
            value={val}
            onChange={(e) => {
              setVal(e.target.value);
              push_live(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                commit();
              }
            }}
            className="min-h-32 resize-y font-mono text-xs"
          />
        )}
      </div>
    );
  };

  const text_input = () => (
    <Input
      ref={ref}
      value={val}
      onChange={(e) => {
        setVal(e.target.value);
        push_live(e.target.value);
      }}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") cancel();
      }}
      className="h-7 border-none outline-none"
    />
  );

  const number_input = () => (
    <Input
      ref={ref}
      type="number"
      step={sql_type.includes("int") ? 1 : "any"}
      value={val}
      onChange={(e) => {
        setVal(e.target.value);
        push_live(e.target.value);
      }}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") cancel();
      }}
      className="h-7"
    />
  );

  // Both dropdowns: clicking outside closes the popover and cancels the edit.
  const [dd_open, setDdOpen] = useState(true);
  const on_dd_open = (o: boolean) => {
    setDdOpen(o);
    if (!o) cancel();
  };

  const bool_editor = () => (
    <Select
      open={dd_open}
      onOpenChange={on_dd_open}
      value={
        value === null || value === ""
          ? "__null"
          : value === "1" || value === "true"
            ? "__true"
            : "__false"
      }
      onValueChange={(v) => {
        if (v === "__null") commit(null);
        else if (v === "__true") commit("1");
        else commit("0");
      }}
    >
      <SelectTrigger
        className="h-7 w-full"
        size="sm"
        aria-label="Boolean value"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {col_nullable && <SelectItem value="__null">NULL</SelectItem>}
        <SelectItem value="__true">true</SelectItem>
        <SelectItem value="__false">false</SelectItem>
      </SelectContent>
    </Select>
  );

  const enum_editor = () => (
    <Select
      open={dd_open}
      onOpenChange={on_dd_open}
      value={value === null ? "__dh_null" : value || undefined}
      onValueChange={(v) => commit(v === "__dh_null" ? null : v)}
    >
      <SelectTrigger className="h-7 w-full" size="sm" aria-label="Pick a value">
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent className={"bg-background border"}>
        {col_nullable && <SelectItem value="__dh_null">(set NULL)</SelectItem>}
        {options
          .filter((o) => o !== null)
          .map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );

  const date_editor = () => (
    <DatePicker
      value={value}
      withTime={kind === "datetime"}
      onChange={(v) => commit(v)}
      autoOpen
    />
  );

  let editor;
  if (kind === "array")
    editor = (
      <ArrayCellEditor
        value={value}
        options={options}
        onCommit={(text) => commit(text)}
        onCancel={cancel}
      />
    );
  else if (options.length > 0 && kind !== "datetime" && kind !== "bool")
    editor = enum_editor();
  else if (multiline || is_json_kind(sql_type)) editor = multiline_editor();
  else if (kind === "bool") editor = bool_editor();
  else if (kind === "date" || kind === "datetime") editor = date_editor();
  else if (is_number) editor = number_input();
  else editor = text_input();

  return <div className="relative flex min-w-0 items-center">{editor}</div>;
}

/** Array-of-enum (e.g. `permission[]`) tag multi-select editor. The value is a
 *  Postgres array literal like `{read,write,admin}`; each element is a removable
 *  chip, and the add control is restricted to the enum's allowed values. Done
 *  (or Enter) commits; Escape cancels. */
function ArrayCellEditor({
  value,
  options,
  onCommit,
  onCancel,
}: {
  value: string | null;
  options: (string | null)[];
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const initial = value == null ? [] : parsePgArray(value);
  const [sel, setSel] = useState<string[]>(initial);
  const available = (options.filter((o) => o !== null) as string[]).filter(
    (o) => !sel.includes(o),
  );
  const commitNow = () => onCommit(toPgArray(sel));
  return (
    <div
      className="bg-background z-40! absolute -top-3 left-1 flex w-72 flex-col gap-2 rounded-md border p-2 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.stopPropagation();
          e.preventDefault();
          commitNow();
        }
      }}
    >
      {value === null && (
        <div className="text-muted-foreground text-[11px]">(set NULL)</div>
      )}
      <div className="flex min-h-6 flex-wrap items-center gap-1">
        {sel.map((v) => (
          <span
            key={v}
            className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs"
          >
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => setSel((s) => s.filter((x) => x !== v))}
              className="text-primary/50 hover:text-primary cursor-pointer"
            >
              ×
            </button>
          </span>
        ))}
        {sel.length === 0 && (
          <span className="text-muted-foreground px-1 text-xs italic">
            empty
          </span>
        )}
      </div>
      <Select
        value=""
        onValueChange={(o) => {
          if (o && !sel.includes(o)) setSel((s) => [...s, o]);
        }}
      >
        <SelectTrigger className="h-7 w-full" size="sm" aria-label="Add value">
          <SelectValue placeholder="+ Add value…" />
        </SelectTrigger>
        <SelectContent className="bg-background max-h-40 overflow-y-auto border">
          {available.length === 0 ? (
            <div className="text-muted-foreground px-2 py-1 text-xs">
              All values added
            </div>
          ) : (
            available.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      <div className="flex items-center justify-end gap-1">
        <Button
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => commitNow()}
        >
          Done
        </Button>
      </div>
    </div>
  );
}

function is_json_kind(sql_type: string): boolean {
  return sql_type.includes("json");
}

/** Parse a Postgres array literal like `{a,b,c}` or `{"a, b","c"}` into its
 *  elements. Quoted elements and doubled quotes/backslashes are honored. */
export function parsePgArray(src: string): string[] {
  const s = src.trim();
  if (s.length < 2 || s[0] !== "{" || s[s.length - 1] !== "}") {
    // Not an array literal — treat the raw text as a single element so nothing
    // is silently dropped when round-tripping.
    return src === "" ? [] : [src];
  }
  const out: string[] = [];
  let cur = "";
  let quote = false;
  let started = false;
  for (let i = 1; i < s.length - 1; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quote = false;
        }
      } else if (ch === "\\") {
        cur += s[i + 1] ?? "";
        i++;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quote = true;
      started = true;
    } else if (ch === "\\") {
      cur += s[i + 1] ?? "";
      i++;
      started = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started) out.push(cur);
  return out;
}

/** Serialize an element array back to a Postgres array literal `{a,b,c}`. */
function toPgArray(vals: string[]): string {
  const quoted = (v: string) =>
    /[",\\{}]|\s/.test(v) ? `"${v.replaceAll("\\", "\\\\").replaceAll('"', '""')}"` : v;
  return `{${vals.map(quoted).join(",")}}`;
}

/** Minimal JSON syntax highlighter for the editor backdrop: keys, strings,
 *  numbers and literals each get a color; everything else inherits. Input is
 *  HTML-escaped first, tokens are wrapped in colored spans. */
const JSON_TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;

function highlight_json(src: string): string {
  const escaped = src.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return escaped.replace(JSON_TOKEN, (match, str, colon) => {
    if (str !== undefined) {
      const cls = colon !== undefined ? "text-sky-300" : "text-emerald-300";
      return `<span class="${cls}">${str}</span>${colon ?? ""}`;
    }
    if (match === "true" || match === "false" || match === "null") {
      return `<span class="text-fuchsia-400">${match}</span>`;
    }
    return `<span class="text-amber-300">${match}</span>`;
  });
}
