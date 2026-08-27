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
  }, []);

  // Transform back when committing.
  const toDb = (v: string) =>
    kind === "datetime" ? v.replaceAll("T", " ") : v;
  // Clicking outside can unmount the editor before blur fires — persist the
  // typed value on unmount unless it was already committed (Enter/blur).
  const committed = useRef(false);
  const val_ref = useRef(val);
  useEffect(() => {
    val_ref.current = val;
  });
  useEffect(
    () => () => {
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
              onChange={(e) => setVal(e.target.value)}
              onScroll={(e) => {
                const pre = e.currentTarget
                  .previousSibling as HTMLPreElement | null;
                if (pre) pre.scrollTop = e.currentTarget.scrollTop;
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
              className="wrap-break-words caret-foreground absolute inset-0 h-full resize-none overflow-auto bg-transparent p-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-transparent"
            />
          </div>
        ) : (
          <Textarea
            ref={area_ref}
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
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
      onChange={(e) => setVal(e.target.value)}
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
      onChange={(e) => setVal(e.target.value)}
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
  if (options.length > 0 && kind !== "datetime" && kind !== "bool")
    editor = enum_editor();
  else if (multiline || is_json_kind(sql_type)) editor = multiline_editor();
  else if (kind === "bool") editor = bool_editor();
  else if (kind === "date" || kind === "datetime") editor = date_editor();
  else if (is_number) editor = number_input();
  else editor = text_input();

  return <div className="relative flex min-w-0 items-center">{editor}</div>;
}

function is_json_kind(sql_type: string): boolean {
  return sql_type.includes("json");
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
