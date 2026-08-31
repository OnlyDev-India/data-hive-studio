import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { quoteIdent } from "@/shared/api";
import type { CellClick, CellKind, DistinctMap } from "./types";
import { GUTTER_W_PX, ROW_ESTIMATE_PX } from "./types";
import { useGridKeyboard } from "./use-grid-keyboard";
import {
  cellKey,
  computeGridView,
  type CopyFormat,
  type GridContextValue,
  type CellId,
} from "./grid-context";
import type { JsonRow } from "@/shared/store";

/** Convert a raw cell string into the value shown in the JSON viewer. */
function toJsonValue(v: string | null, sqlType: string | undefined): unknown {
  if (v === null) return null;
  const t = (sqlType ?? "").toLowerCase();
  if (t.includes("bool")) return v === "1" || v.toLowerCase() === "true";
  // Mongo object / array columns arrive as embedded JSON strings (nested
  // documents are flattened into a single cell). Re-parse them so the JSON
  // drill-down shows the real nested structure instead of an escaped string.
  if (t.includes("object") || t.includes("array") || t.startsWith("bson")) {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  if (/(int|real|float|double|numeric|decimal)/.test(t)) {
    const n = Number(v);
    if (Number.isFinite(n) && String(n) === v.trim()) return n;
  }
  return v;
}

/** Render a cell value as a SQL literal for an INSERT statement. */
function toSqlLiteral(v: string | null, sqlType: string | undefined): string {
  if (v === null) return "NULL";
  const t = (sqlType ?? "").toLowerCase();
  if (t.includes("bool"))
    return v === "1" || v.toLowerCase() === "true" ? "1" : "0";
  if (/(int|real|float|double|numeric|decimal)/.test(t)) {
    const n = Number(v);
    if (Number.isFinite(n)) return v;
  }
  return `'${v.replaceAll("'", "''")}'`;
}

/** Build a `{ column: value }` object for one raw row. */
function rowToObject(
  raw: (string | null)[],
  columns: string[],
  col_index_of: Record<string, number>,
  types: Record<string, string> | undefined,
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const col of columns) {
    obj[col] = toJsonValue(raw[col_index_of[col] ?? 0] ?? null, types?.[col]);
  }
  return obj;
}

/** Host-provided config for a grid instance. */
export interface GridControllerConfig {
  rows: (string | null)[][];
  columns: string[];
  row_offset: number;
  editable: boolean;
  /** True while a page query is in flight — header sort/pin actions pause. */
  loading?: boolean;
  pk_columns: string[];
  conn_id: string;
  table: string;
  kinds: Record<string, CellKind>;
  types?: Record<string, string>;
  key_kinds?: Record<string, "primary" | "foreign" | "both">;
  /** Column name -> referenced table/column for foreign-key columns. */
  fk_targets?: Record<string, { table: string; column: string }>;
  nullable?: Record<string, boolean>;
  distinct: DistinctMap;
  on_modified: () => void;
  on_set_null: (row: number, col: string) => void;
  on_delete_row: (row: number) => void;
  /** Called when "Clone row" is picked — duplicates the row's values into a new one. */
  on_clone_row?: (row: number) => void;
  /** New (not yet inserted) rows pinned to the top of the grid — pending rows.
   * Entry 0 is the newest and occupies grid row 0; real rows follow. */
  pending_rows?: { values: (string | null)[]; dirty: boolean }[];
  /** Buffer an edit on a pending row instead of issuing an UPDATE. */
  on_pending_edit?: (row: number, col: string, value: string | null) => void;
  /** Discard the pending row at the given grid row (usually its gutter icon). */
  on_remove_pending?: (row: number) => void;
  /** Buffered cell edits awaiting Apply, keyed by `${col}\u0000${realRow}`. */
  dirty_cells?: Map<string, string | null>;
  /** Real row indices marked for deletion, awaiting Apply. */
  deleted_rows?: ReadonlySet<number>;
  /** Buffer a cell edit on a real row instead of issuing an UPDATE. */
  on_edit_cell?: (row: number, col: string, value: string | null) => void;
  /** Sort rows in-memory (SQL query results) instead of re-querying. */
  client_sort?: boolean;
  /** Called when the sort cursor changes so the host can reset its page. */
  on_navigation_change?: () => void;
  /** Called when the current (anchor) cell changes — keeps the JSON viewer in sync. */
  on_cell_changed?: (row: JsonRow) => void;
  /** Called when "View JSON" is picked on a cell — opens the JSON viewer. */
  on_open_json?: () => void;
  /** Called when "Open as grid (drill-down)" is picked on a JSON cell — opens a
   * breadcrumbed grid over that cell's value. */
  on_drill_json?: (col: string, value: string | null) => void;
  /** Called when an FK cell's jump icon is clicked — opens the referenced
   * table filtered to this value. */
  on_open_reference?: (
    table: string,
    column: string,
    value: string | null,
  ) => void;
}

/** Sort rows client-side, mirroring SQL defaults (NULLs last, numeric-aware). */
function sortRows(
  rows: (string | null)[][],
  columns: string[],
  sort_col: string | null,
  sort_asc: boolean,
): (string | null)[][] {
  if (!sort_col) return rows;
  const ci = columns.indexOf(sort_col);
  if (ci < 0) return rows;
  return [...rows].sort((a, b) => {
    const av = a[ci];
    const bv = b[ci];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const na = Number(av);
    const nb = Number(bv);
    if (
      !Number.isNaN(na) &&
      !Number.isNaN(nb) &&
      String(na) === av.trim() &&
      String(nb) === bv.trim()
    ) {
      return sort_asc ? na - nb : nb - na;
    }
    return sort_asc ? av.localeCompare(bv) : bv.localeCompare(av);
  });
}

/**
 * Owns all the state and interaction of one data grid and exposes it through
 * {@link GridContext}. GridBody / Cell / HeaderCell / CellEditor are dumb
 * presentational consumers; the host just provides data + a few callbacks.
 */
export function useGridController(cfg: GridControllerConfig): GridContextValue {
  const {
    rows,
    columns,
    row_offset,
    editable,
    loading = false,
    pk_columns,
    conn_id,
    table,
    kinds,
    types,
    key_kinds,
    fk_targets,
    nullable,
    distinct,
    on_modified,
    on_set_null,
    on_delete_row,
    on_clone_row,
    pending_rows,
    on_pending_edit: on_pending_edit_prop,
    on_remove_pending: on_remove_pending_prop,
    dirty_cells,
    deleted_rows,
    on_edit_cell: on_edit_cell_prop,
    client_sort = false,
    on_navigation_change,
    on_cell_changed,
    on_open_json,
    on_drill_json,
    on_open_reference,
  } = cfg;

  const [sort_col, setSortCol] = useState<string | null>(null);
  const [sort_asc, setSortAsc] = useState(true);
  const [pinned, setPinned] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sel_anchor, setSelAnchor] = useState<CellId | null>(null);
  const [active_cell, setActiveCell] = useState<CellId | null>(null);
  const [editing, setEditing] = useState<CellId | null>(null);
  const [editAsText, setEditAsText] = useState<boolean>(false);
  const [col_widths, setColWidths] = useState<Record<string, number>>({});

  const pending = pending_rows ?? [];
  const pending_count = pending_rows?.length ?? 0;

  const rows_to_render = useMemo(() => {
    // Overlay buffered edits onto the real rows so the grid reflects values
    // that haven't been written to the DB yet.
    let real = rows;
    if (dirty_cells && dirty_cells.size > 0) {
      const by_row = new Map<number, Map<string, string | null>>();
      for (const [k, v] of dirty_cells) {
        const sep = k.indexOf("\u0000");
        if (sep < 0) continue;
        const col = k.slice(0, sep);
        const r = Number(k.slice(sep + 1));
        let m = by_row.get(r);
        if (!m) {
          m = new Map();
          by_row.set(r, m);
        }
        m.set(col, v);
      }
      if (by_row.size > 0) {
        real = rows.map((data, realIdx) => {
          // dirty_cells are keyed by GLOBAL row index (row_offset-inclusive),
          // so a page change never lets one row's edit bleed onto another.
          const m = by_row.get(row_offset + realIdx);
          if (!m) return data;
          const out = data.slice();
          for (const [col, v] of m) {
            const ci = columns.indexOf(col);
            if (ci >= 0) out[ci] = v;
          }
          return out;
        });
      }
    }
    const base = client_sort
      ? sortRows(real, columns, sort_col, sort_asc)
      : real;
    return pending_rows && pending_rows.length > 0
      ? [...pending_rows.map((p) => p.values), ...base]
      : base;
  }, [
    client_sort,
    rows,
    columns,
    sort_col,
    sort_asc,
    pending_rows,
    dirty_cells,
    row_offset,
  ]);

  const view = useMemo(
    () => computeGridView(columns, pinned, col_widths, selected),
    [columns, pinned, col_widths, selected],
  );
  const { col_index_of, col_meta, column_order } = view;

  const root_ref = useRef<HTMLDivElement | null>(null);
  const drag_active = useRef(false);

  const on_root_ready = useCallback((el: HTMLDivElement | null) => {
    root_ref.current = el;
  }, []);

  // Row windowing: only the visible slice of rows is mounted. The root div
  // (attached by GridBody via on_root_ready) doubles as the scroll element;
  // ref callbacks run before layout effects, so it is set by the time the
  // virtualizer first observes it.
  //
  // `enabled: on_screen` keeps virtualization honest: tabs stay mounted but
  // hidden (display:none), and a hidden scroller measures as zero — which
  // used to corrupt the window (rows invisible until scroll, offsets landing
  // at the bottom, phantom spacer height). Disabled means nothing renders and
  // nothing is measured; on reveal we remeasure and jump back.
  const [on_screen, setOnScreen] = useState(true);
  const saved_scroll = useRef(0);
  const was_shown = useRef(true);
  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer instance is stable; the rule can't see that
  const row_virtualizer = useVirtualizer({
    count: rows_to_render.length,
    getScrollElement: () => root_ref.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 12,
    enabled: on_screen,
  });

  // Track whether this grid is actually on screen, remember the scroll
  // position while it is, and put the user back exactly there on reveal.
  useEffect(() => {
    const el = root_ref.current;
    if (!el) return;

    const remember = () => {
      saved_scroll.current = el.scrollTop;
    };
    el.addEventListener("scroll", remember, { passive: true });

    const io = new IntersectionObserver(([entry]) => {
      const showing = entry?.isIntersecting ?? true;
      if (showing && !was_shown.current) {
        // Back into view: remeasure (the DOM was rebuilt while hidden),
        // then restore the saved offset clamped to the content height —
        // one frame later, so the spacer has its final size first.
        row_virtualizer.measure();
        requestAnimationFrame(() => {
          const max = Math.max(
            0,
            row_virtualizer.getTotalSize() - el.clientHeight,
          );
          el.scrollTo({ top: Math.min(saved_scroll.current, max) });
        });
      }
      was_shown.current = showing;
      setOnScreen(showing);
    });
    io.observe(el);

    return () => {
      io.disconnect();
      el.removeEventListener("scroll", remember);
    };
  }, [row_virtualizer]);

  // A fresh page/query invalidates the old scroll position; snap back to the
  // top and remeasure so the spacer always matches the real content height.
  useEffect(() => {
    if (!on_screen) return;
    root_ref.current?.scrollTo({ top: 0 });
    row_virtualizer.measure();
  }, [rows_to_render, on_screen, row_virtualizer]);

  const on_sort = useCallback(
    (col: string, asc: boolean) => {
      if (loading) return;
      setSortCol(col);
      setSortAsc(asc);
      on_navigation_change?.();
    },
    [on_navigation_change, loading],
  );

  const on_clear_sort = useCallback(
    (col: string) => {
      if (sort_col === col) {
        setSortCol(null);
        on_navigation_change?.();
      }
    },
    [sort_col, on_navigation_change],
  );

  const on_toggle_pin = useCallback((col: string) => {
    setPinned((list) =>
      list.includes(col) ? list.filter((c) => c !== col) : [...list, col],
    );
  }, []);

  const on_resize_col = useCallback((col: string, px: number) => {
    setColWidths((prev) => (prev[col] === px ? prev : { ...prev, [col]: px }));
  }, []);

  // Double-click a column's resize handle to size it to its widest content.
  const auto_fit_col = useCallback(
    (col: string) => {
      const ci = col_index_of[col];
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx || ci === undefined) return;
      const body = getComputedStyle(document.body);
      ctx.font = `${body.fontSize} ${body.fontFamily}`;
      let max = 0;
      for (const row of rows_to_render) {
        const v = row[ci];
        if (v !== null && v !== undefined) {
          max = Math.max(max, ctx.measureText(String(v)).width);
        }
      }
      const label = types?.[col];
      const header_w =
        ctx.measureText(col).width +
        (label ? ctx.measureText(`  ${label}`).width * 0.7 : 0) +
        40;
      const fit = Math.max(
        64,
        Math.min(600, Math.round(Math.max(max, header_w) + 24)),
      );
      on_resize_col(col, fit);
    },
    [col_index_of, rows_to_render, types, on_resize_col],
  );

  // ---- Selection / drag ----
  const do_click_cell = useCallback(
    (ev: CellClick) => {
      setEditing(null);
      if (ev.gutter) {
        const all_cols = column_order;
        if (ev.range && sel_anchor) {
          const [ar] = sel_anchor;
          const [lo, hi] = [Math.min(ar, ev.row), Math.max(ar, ev.row)];
          const new_sel = new Set<string>();
          for (let r = lo; r <= hi; r++)
            for (const c of all_cols) new_sel.add(cellKey(r, c));
          setSelected(new_sel);
          return;
        }
        if (ev.add) {
          const fully = all_cols.every((c) => selected.has(cellKey(ev.row, c)));
          const cur = new Set(selected);
          for (const c of all_cols) {
            if (fully) cur.delete(cellKey(ev.row, c));
            else cur.add(cellKey(ev.row, c));
          }
          setSelected(cur);
        } else {
          const new_sel = new Set<string>();
          for (const c of all_cols) new_sel.add(cellKey(ev.row, c));
          setSelected(new_sel);
        }
        const first = all_cols[0];
        if (first !== undefined) {
          setSelAnchor([ev.row, first]);
          setActiveCell([ev.row, first]);
        }
        return;
      }
      if (ev.range && sel_anchor) {
        const [ar, ac] = sel_anchor;
        const a = col_index_of[ac];
        const t = col_index_of[ev.col];
        if (a !== undefined && t !== undefined) {
          const [rlo, rhi] = [Math.min(ar, ev.row), Math.max(ar, ev.row)];
          const [clo, chi] = [Math.min(a, t), Math.max(a, t)];
          const new_sel = new Set<string>();
          for (let r = rlo; r <= rhi; r++)
            for (let ci = clo; ci <= chi; ci++)
              new_sel.add(cellKey(r, col_meta[ci][0]));
          setSelected(new_sel);
          return;
        }
      }
      const cur = new Set(selected);
      const id = cellKey(ev.row, ev.col);
      if (ev.add) {
        if (cur.has(id)) cur.delete(id);
        else cur.add(id);
        setSelAnchor([ev.row, ev.col]);
      } else {
        cur.clear();
        cur.add(id);
        setSelAnchor([ev.row, ev.col]);
      }
      setActiveCell([ev.row, ev.col]);
      setSelected(cur);
    },
    [column_order, sel_anchor, selected, col_index_of, col_meta],
  );

  const start_drag = useCallback(
    (ev: CellClick) => {
      drag_active.current = true;
      do_click_cell(ev);
    },
    [do_click_cell],
  );

  const drag_to = useCallback(
    (ev: CellClick) => {
      if (!drag_active.current) return;
      if (ev.gutter && sel_anchor) {
        const [ar] = sel_anchor;
        const [lo, hi] = [Math.min(ar, ev.row), Math.max(ar, ev.row)];
        const new_sel = new Set<string>();
        for (let r = lo; r <= hi; r++)
          for (const c of column_order) new_sel.add(cellKey(r, c));
        setSelected(new_sel);
        return;
      }
      if (sel_anchor) {
        const [ar, ac] = sel_anchor;
        const a = col_index_of[ac];
        const t = col_index_of[ev.col];
        if (a !== undefined && t !== undefined) {
          const [rlo, rhi] = [Math.min(ar, ev.row), Math.max(ar, ev.row)];
          const [clo, chi] = [Math.min(a, t), Math.max(a, t)];
          const new_sel = new Set<string>();
          for (let r = rlo; r <= rhi; r++)
            for (let ci = clo; ci <= chi; ci++)
              new_sel.add(cellKey(r, col_meta[ci][0]));
          setSelected(new_sel);
        }
      }
    },
    [sel_anchor, column_order, col_index_of, col_meta],
  );

  const stop_drag = useCallback(() => {
    drag_active.current = false;
  }, []);

  // ---- Editor ----
  const open_editor = useCallback((ev: CellClick) => {
    if (!ev.range && !ev.gutter) setEditing([ev.row, ev.col]);
  }, []);

  const close_editor = useCallback(() => {
    setEditing(null);
    setEditAsText(false);
    on_modified();
    root_ref.current?.focus({ preventScroll: true });
  }, [on_modified]);

  // ---- Copy ----
  const copy_text = useCallback(() => {
    if (selected.size === 0) return;
    const lines: string[] = [];
    for (let row = 0; row < rows_to_render.length; row++) {
      const line = column_order
        .map((col) => {
          if (selected.has(cellKey(row, col))) {
            const ci = col_index_of[col] ?? 0;
            return rows_to_render[row][ci] ?? "";
          }
          return "";
        })
        .join("\t");
      if (line.trim().length === 0) continue;
      lines.push(line);
    }
    const text = lines.join("\n");
    void navigator.clipboard.writeText(text);
  }, [selected, rows_to_render, column_order, col_index_of]);

  // Scroll the active cell fully into view after keyboard navigation. The
  // root div is itself the scroll container (and the virtualizer's element).
  const scroll_to_cell = useCallback(
    (r: number, dci: number) => {
      const container = root_ref.current;
      if (!container) return;
      const el = container.querySelector(`[data-cell="${r}:${dci}"]`);
      if (!el) {
        // Row is virtualized out of the DOM – window it in first; horizontal
        // alignment settles on the next keystroke once the cell exists.
        row_virtualizer.scrollToIndex(r, { align: "auto" });
        return;
      }
      const box = (el as HTMLElement).getBoundingClientRect();
      const area = container.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (box.left < area.left + GUTTER_W_PX)
        dx = box.left - (area.left + GUTTER_W_PX);
      else if (box.right > area.right) dx = box.right - area.right;
      if (box.top < area.top) dy = box.top - area.top;
      else if (box.bottom > area.bottom) dy = box.bottom - area.bottom;
      if (dx !== 0 || dy !== 0) container.scrollBy({ left: dx, top: dy });
    },
    [row_virtualizer],
  );

  const handle_keydown = useGridKeyboard({
    rows: rows_to_render.length,
    col_meta,
    col_index_of,
    active_cell,
    sel_anchor,
    editable,
    on_select: setSelected,
    on_sel_anchor: setSelAnchor,
    on_active_cell: setActiveCell,
    on_editing: setEditing,
    on_copy: copy_text,
    on_navigate: scroll_to_cell,
  });

  // While editing, the editor input owns the keys; ignore bubbling events so
  // arrows don't move the selection mid-edit.
  const on_root_keydown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (editing) return;
      handle_keydown(e);
    },
    [editing, handle_keydown],
  );

  const on_root_mouse_down = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (document.activeElement !== e.currentTarget) {
        e.currentTarget.focus({ preventScroll: true });
      }
    },
    [],
  );

  // ---- Right-click context menu ----
  const menu_select = useCallback(
    (row: number, col: string) => {
      if (selected.has(cellKey(row, col))) return;
      setSelected(new Set([cellKey(row, col)]));
      setSelAnchor([row, col]);
      setActiveCell([row, col]);
    },
    [selected],
  );

  const menu_copy = useCallback(() => {
    if (selected.size > 0) copy_text();
  }, [selected, copy_text]);

  const menu_edit = useCallback(
    (row: number, col: string, asText?: boolean) => {
      setEditing([row, col]);
      setEditAsText(asText || false);
    },
    [],
  );

  const menu_set_null = useCallback(
    (row: number, col: string) => {
      setEditing(null);
      on_set_null(row, col);
    },
    [on_set_null],
  );

  const menu_delete = useCallback(
    (row: number) => {
      setEditing(null);
      on_delete_row(row);
    },
    [on_delete_row],
  );

  const menu_show_json = useCallback(() => {
    on_open_json?.();
  }, [on_open_json]);

  // Drill into a JSON cell: resynthesize the raw text from the rendered row
  // and hand it (plus the column) to the host so it can open a drill grid.
  const menu_drill_json = useCallback(
    (rowIdx: number, col: string) => {
      if (!on_drill_json) return;
      const row = rows_to_render[rowIdx];
      if (!row) return;
      const ci = col_index_of[col] ?? 0;
      on_drill_json(col, row[ci] ?? null);
    },
    [on_drill_json, rows_to_render, col_index_of],
  );

  // Copy the clicked row — or every fully-selected row — as JSON, an INSERT
  // statement, or a Markdown table.
  const menu_copy_as = useCallback(
    (rowIdx: number, format: CopyFormat) => {
      const row = rows_to_render[rowIdx];
      if (!row) return;
      const total_cols = column_order.length;
      const fully_selected: number[] = [];
      for (let r = 0; r < rows_to_render.length; r++) {
        let n = 0;
        for (const col of column_order) if (selected.has(cellKey(r, col))) n++;
        if (n === total_cols) fully_selected.push(r);
      }
      const idxs = fully_selected.length > 0 ? fully_selected : [rowIdx];

      let text: string;
      if (format === "json") {
        const objs = idxs.map((r) =>
          rowToObject(rows_to_render[r], column_order, col_index_of, types),
        );
        text =
          objs.length === 1
            ? JSON.stringify(objs[0], null, 2)
            : JSON.stringify(objs, null, 2);
      } else if (format === "sql") {
        text = idxs
          .map((r) => {
            const src = rows_to_render[r];
            const cols = column_order.map((c) => quoteIdent(c)).join(", ");
            const vals = column_order
              .map((c) =>
                toSqlLiteral(src[col_index_of[c] ?? 0] ?? null, types?.[c]),
              )
              .join(", ");
            return `INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${vals});`;
          })
          .join("\n");
      } else {
        const header = `| ${column_order.join(" | ")} |`;
        const sep = `| ${column_order.map(() => "---").join(" | ")} |`;
        const body = idxs
          .map((r) => {
            const src = rows_to_render[r];
            return `| ${column_order
              .map((c) =>
                (src[col_index_of[c] ?? 0] ?? "")
                  .replaceAll("|", "\\|")
                  .replaceAll("\n", " "),
              )
              .join(" | ")} |`;
          })
          .join("\n");
        text = [header, sep, body].join("\n");
      }
      void navigator.clipboard.writeText(text);
    },
    [rows_to_render, column_order, col_index_of, selected, types, table],
  );

  const menu_clone_row = useCallback(
    (row: number) => {
      setEditing(null);
      on_clone_row?.(row);
    },
    [on_clone_row],
  );

  // Keep the JSON viewer showing the row where the selection starts (the
  // anchor cell), just like the highlighted anchor cell in the grid.
  const anchor_row = sel_anchor?.[0];
  useEffect(() => {
    if (!on_cell_changed) return;
    if (anchor_row === undefined) return;
    if (anchor_row < pending_count) return;
    const row = rows_to_render[anchor_row];
    if (!row) return;
    const data: Record<string, unknown> = {};
    for (const col of column_order) {
      const ci = col_index_of[col];
      if (ci !== undefined)
        data[col] = toJsonValue(row[ci] ?? null, types?.[col]);
    }
    on_cell_changed({
      conn_id,
      table,
      row_number: row_offset + (anchor_row - pending_count) + 1,
      data,
    });
  }, [
    anchor_row,
    on_cell_changed,
    rows_to_render,
    column_order,
    col_index_of,
    types,
    conn_id,
    table,
    row_offset,
    pending_count,
  ]);

  // A freshly-added pending row (at the top of the grid) drops the user straight
  // into its first cell so they can start typing; only fires when the batch
  // grows (not when a pending row gets removed/edited), and skips rows that
  // have already been edited.
  const prev_pending_count = useRef(pending_count);
  useEffect(() => {
    const grew = pending_count > prev_pending_count.current;
    prev_pending_count.current = pending_count;
    if (pending_count === 0 || !grew) return;
    if (pending_rows?.[0]?.dirty) return;
    const r = 0;
    const c = column_order[0];
    if (c === undefined) return;
    const id = setTimeout(() => {
      setEditing([r, c]);
      setSelAnchor([r, c]);
      setActiveCell([r, c]);
      requestAnimationFrame(() => scroll_to_cell(r, 0));
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending_count, pending_rows]);

  const on_pending_edit = useCallback(
    (row: number, col: string, value: string | null) => {
      if (row >= pending_count) return;
      on_pending_edit_prop?.(row, col, value);
    },
    [pending_count, on_pending_edit_prop],
  );

  const on_edit_cell = useCallback(
    (row: number, col: string, value: string | null) => {
      if (row < pending_count) return;
      on_edit_cell_prop?.(row, col, value);
    },
    [pending_count, on_edit_cell_prop],
  );

  const on_remove_pending = useCallback(
    (row: number) => {
      if (row >= pending_count) return;
      on_remove_pending_prop?.(row);
    },
    [pending_count, on_remove_pending_prop],
  );

  const cell_dirty = useCallback(
    (row: number, col: string) => {
      const real = row - pending_count;
      return (
        real >= 0 &&
        (dirty_cells?.has(`${col}\u0000${row_offset + real}`) ?? false)
      );
    },
    [pending_count, dirty_cells, row_offset],
  );

  const row_deleted = useCallback(
    (row: number) => {
      const real = row - pending_count;
      return real >= 0 && (deleted_rows?.has(row_offset + real) ?? false);
    },
    [pending_count, deleted_rows, row_offset],
  );

  return {
    rows: rows_to_render,
    columns,
    row_offset,
    conn_id,
    table,
    editable,
    loading,
    pk_columns,
    kinds,
    types,
    key_kinds,
    fk_targets,
    nullable,
    distinct,
    view,
    col_index_of,
    sort_col,
    sort_asc,
    pinned,
    selected,
    sel_anchor,
    active_cell,
    editing,
    editAsText,
    col_widths,
    on_sort,
    on_clear_sort,
    on_toggle_pin,
    on_resize_col,
    auto_fit_col,
    on_select: setSelected,
    on_sel_anchor: setSelAnchor,
    on_active_cell: setActiveCell,
    on_editing: setEditing,
    start_drag,
    drag_to,
    stop_drag,
    open_editor,
    close_editor,
    handle_keydown,
    on_root_keydown,
    menu_select,
    menu_copy,
    menu_edit,
    menu_set_null,
    menu_delete,
    menu_show_json: on_open_json ? menu_show_json : undefined,
    menu_copy_as,
    menu_clone_row: on_clone_row ? menu_clone_row : undefined,
    menu_drill_json: on_drill_json ? menu_drill_json : undefined,
    on_open_reference,
    pending_count,
    pending_dirty: (row: number) => pending[row]?.dirty ?? false,
    on_pending_edit,
    on_remove_pending,
    cell_dirty,
    row_deleted,
    on_edit_cell,
    root_ref,
    on_root_ready,
    row_virtualizer,
    on_root_mouse_down,
  };
}
