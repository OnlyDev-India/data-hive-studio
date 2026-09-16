import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useRowWindow } from "./use-row-window";
import { quoteIdent } from "@/shared/api";
import type { CellClick, CellKind, DistinctMap } from "./types";
import { GUTTER_W_PX, ROW_HEIGHT_PX } from "./types";
import { useGridKeyboard } from "./use-grid-keyboard";
import {
  cellKey,
  computeGridView,
  computeFillBox,
  isNewFillCell,
  fillSourceCell,
  type CopyFormat,
  type GridContextValue,
  type CellId,
  type SelBounds,
} from "./grid-context";
import type { JsonRow } from "@/shared/store";
import { rowToObject, sortRows, toJsonValue, toSqlLiteral } from "./grid-utils";
import { loadColumnLayout, saveColumnLayout } from "./column-layout-storage";

/** `cellKey`'s own separator, derived rather than duplicated as a literal —
 *  `cellKey(0, "")` is `"0" + SEP`, so stripping the leading "0" leaves just
 *  the separator. Used below to parse a selection key back into (row, col). */
const CELL_KEY_SEP = cellKey(0, "").slice(1);

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
  /** Column layout (order/widths/pin/hidden/sort) persists to localStorage
   *  under this key — omit for a grid with no stable table identity (e.g. a
   *  one-off query result) to skip persistence entirely. The host builds
   *  it (typically `${conn_id}::${database}::${schema}::${table}`) since
   *  the controller itself doesn't know about database/schema. */
  layout_key?: string | null;
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
  /** Called when "Clone row" is picked, with every row touched by the
   *  current selection (or just the clicked row, selecting nothing) —
   *  duplicates each into a new pending row, all in one batch so cloning N
   *  rows doesn't need N separate index-shifting inserts. */
  on_clone_row?: (rows: number[]) => void;
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

/**
 * Owns all the state and interaction of one data grid and exposes it through
 * {@link GridContext}. GridBody / Cell / HeaderCell / CellEditor are dumb
 * presentational consumers; the host just provides data + a few callbacks.
 *
 * Kept as ONE hook rather than split into separate selection/editing hooks:
 * nearly every callback here closes over `selected`/`sel_anchor`/`editing`/
 * `col_index_of`/`rows_to_render` together (e.g. `menu_edit` touches editing
 * state, `do_click_cell` touches selection AND clears editing, the JSON-sync
 * effect reads both to publish the anchor row). Splitting would mean either
 * two hooks independently tracking overlapping state (desync risk) or one
 * hook calling the other and re-merging the result — still one hook, just
 * with an extra indirection layer. The pure, hook-free helpers this used to
 * define inline (`toJsonValue`, `toSqlLiteral`, `rowToObject`, `sortRows`)
 * are the part that was genuinely separable — see `grid-utils.ts`.
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
    layout_key,
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

  // Lazy-initialized ONCE from localStorage (see column-layout-storage.ts) —
  // assumes a fresh `useGridController` mount per table, same as
  // `pending_id_ref`'s own reset-per-mount elsewhere in this file; a single
  // long-lived instance silently switched to a different `layout_key`
  // wouldn't re-hydrate.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally read once, at mount, not on every `layout_key` change (see the comment above)
  const initial_layout = useMemo(() => loadColumnLayout(layout_key), []);
  const [sort_col, setSortCol] = useState<string | null>(
    initial_layout?.sort_col ?? null,
  );
  const [sort_asc, setSortAsc] = useState(initial_layout?.sort_asc ?? true);
  const [pinned, setPinned] = useState<string[]>(initial_layout?.pinned ?? []);
  const [column_order_override, setColumnOrderOverride] = useState<
    string[] | null
  >(initial_layout?.column_order ?? null);
  const [hidden_columns, setHiddenColumns] = useState<Set<string>>(
    () => new Set(initial_layout?.hidden ?? []),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sel_anchor, setSelAnchor] = useState<CellId | null>(null);
  const [active_cell, setActiveCell] = useState<CellId | null>(null);
  const [editing, setEditing] = useState<CellId | null>(null);
  const [editAsText, setEditAsText] = useState<boolean>(false);
  const [col_widths, setColWidths] = useState<Record<string, number>>(
    initial_layout?.col_widths ?? {},
  );

  // ---- Fill handle (Excel-style, vertical-only — see start_fill_drag) ----
  const fill_active = useRef(false);
  const [fill_source, setFillSource] = useState<SelBounds | null>(null);
  const [fill_target, setFillTarget] = useState<{
    row: number;
    ci: number;
  } | null>(null);

  // ---- In-grid find (Ctrl/Cmd+F) ----
  const [search_open, setSearchOpen] = useState(false);
  const [search_query, setSearchQuery] = useState("");
  const [search_active_index, setSearchActiveIndex] = useState(0);

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
    () =>
      computeGridView(
        columns,
        pinned,
        col_widths,
        selected,
        column_order_override,
        hidden_columns,
      ),
    [
      columns,
      pinned,
      col_widths,
      selected,
      column_order_override,
      hidden_columns,
    ],
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
  // windower first observes it. Fixed row height (see use-row-window.ts for
  // why) means a hidden (display:none) tab needs no special handling: its
  // scrollTop is preserved by the browser across the toggle, and revealing
  // it just recomputes the range from that already-correct value.
  const row_virtualizer = useRowWindow(
    root_ref,
    rows_to_render.length,
    ROW_HEIGHT_PX,
    12,
  );

  // A fresh page/query invalidates the old scroll position; snap back to
  // the top. Deferred to the next animation frame so the spacer (a plain
  // `count * rowHeight` style, not a measured value) has already
  // re-rendered at its new size.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      root_ref.current?.scrollTo({ top: 0 });
    });
    return () => cancelAnimationFrame(raf);
  }, [rows, row_offset]);

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

  // Drag `dragged` next to `target`'s CURRENT position — using
  // `view.column_order` (already pin-partitioned) as the base means the
  // stored override is always a full, self-consistent permutation, not a
  // diff against whatever the previous override happened to be. Lands
  // AFTER `target` when dragging rightward, BEFORE it when dragging
  // leftward — not always "before": removing `dragged` shifts everything
  // after it one slot left, so when `target` is the very next column over,
  // "insert before" would put `dragged` right back where it started (a
  // no-op you'd have to drag two columns past to see any movement at all).
  const reorder_column = useCallback(
    (dragged: string, target: string) => {
      if (dragged === target) return;
      const current = column_order;
      const from = current.indexOf(dragged);
      const to = current.indexOf(target);
      if (from === -1 || to === -1) return;
      const without = current.filter((c) => c !== dragged);
      const target_idx = without.indexOf(target);
      const insert_at = to > from ? target_idx + 1 : target_idx;
      const next = [
        ...without.slice(0, insert_at),
        dragged,
        ...without.slice(insert_at),
      ];
      setColumnOrderOverride(next);
    },
    [column_order],
  );

  const toggle_column_visibility = useCallback((col: string) => {
    setHiddenColumns((cur) => {
      const next = new Set(cur);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  }, []);

  // Column drag-reorder — pointer-based (mousedown/mouseenter/mouseup), not
  // HTML5 DnD: this app's own tab-bar drag already found native DnD flaky
  // inside a Tauri WebView (see `use-tab-drag.ts`) and moved off it. Header
  // cells are separate sibling components, so "which column is the pointer
  // over right now" has to live here (shared context), not per-cell state.
  // Reorders LIVE as the pointer crosses into each new column (not just on
  // drop) — `reorder_column` is idempotent for a given (dragged, target)
  // pair, so re-entering the same cell after the layout shifts under the
  // cursor is a no-op, not a flicker. `col_drag` also carries the live
  // pointer position for the floating "ghost" badge that follows the drag.
  const [col_drag, setColDrag] = useState<{
    col: string;
    x: number;
    y: number;
  } | null>(null);
  const [col_drag_over, setColDragOver] = useState<string | null>(null);
  // Mirrors `col_drag`'s own column name for synchronous reads inside
  // `column_drag_over` (a mouseenter handler) without needing `col_drag`
  // itself in that callback's deps — keeps its identity stable across the
  // x/y updates `col_drag` gets on every mousemove.
  const col_drag_name = useRef<string | null>(null);

  const start_column_drag = useCallback((col: string, x: number, y: number) => {
    col_drag_name.current = col;
    setColDrag({ col, x, y });
    setColDragOver(col);
  }, []);

  const column_drag_over = useCallback(
    (col: string) => {
      setColDragOver((cur) => {
        if (cur === col) return cur;
        const dragged = col_drag_name.current;
        if (dragged && dragged !== col) reorder_column(dragged, col);
        return col;
      });
    },
    [reorder_column],
  );

  const stop_column_drag = useCallback(() => {
    col_drag_name.current = null;
    setColDrag(null);
    setColDragOver(null);
  }, []);

  useEffect(() => {
    if (!col_drag) return;
    const on_move = (e: MouseEvent) => {
      setColDrag((cur) =>
        cur ? { ...cur, x: e.clientX, y: e.clientY } : cur,
      );
      // Hit-test by cursor position instead of relying on each header
      // cell's own `onMouseEnter` (same technique `use-tab-drag.ts` uses
      // for its own drag) — a live reorder moves the dragged column's DOM
      // node to sit right under a STATIONARY cursor, and browsers don't
      // fire a fresh mouseenter just because the element underneath
      // changed without the pointer itself moving; without this, the drag
      // would only ever re-trigger once the pointer physically crossed
      // into a neighboring cell's bounds "at the corner."
      const el = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-col]");
      const over = el?.dataset.col;
      if (over) column_drag_over(over);
    };
    window.addEventListener("mousemove", on_move);
    window.addEventListener("mouseup", stop_column_drag);
    return () => {
      window.removeEventListener("mousemove", on_move);
      window.removeEventListener("mouseup", stop_column_drag);
    };
    // Only re-subscribe on start/stop, not on every mousemove-driven x/y
    // update — `col_drag !== null` is a stable boolean, unlike `col_drag`
    // itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [col_drag !== null, stop_column_drag, column_drag_over]);

  // Persist column layout on every change — cheap (one small JSON blob),
  // so no debouncing. Skips entirely when `layout_key` is absent (see
  // column-layout-storage.ts).
  useEffect(() => {
    saveColumnLayout(layout_key, {
      version: 1,
      column_order: column_order_override,
      col_widths,
      pinned,
      hidden: [...hidden_columns],
      sort_col,
      sort_asc,
    });
  }, [
    layout_key,
    column_order_override,
    col_widths,
    pinned,
    hidden_columns,
    sort_col,
    sort_asc,
  ]);

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

  // Header-cell click — selects the whole column, mirroring the row-gutter
  // click above (whole-row select) but along the other axis. Shift extends
  // a range of columns from the last anchor; Ctrl/Cmd toggles this column
  // within the existing selection.
  const select_column = useCallback(
    (col: string, opts: { add?: boolean; range?: boolean } = {}) => {
      setEditing(null);
      const total_rows = rows_to_render.length;
      if (opts.range && sel_anchor) {
        const [, ac] = sel_anchor;
        const a = col_index_of[ac];
        const t = col_index_of[col];
        if (a !== undefined && t !== undefined) {
          const [clo, chi] = [Math.min(a, t), Math.max(a, t)];
          const new_sel = new Set<string>();
          for (let r = 0; r < total_rows; r++)
            for (let ci = clo; ci <= chi; ci++)
              new_sel.add(cellKey(r, col_meta[ci][0]));
          setSelected(new_sel);
          setActiveCell([0, col]);
          return;
        }
      }
      if (opts.add) {
        let fully = true;
        for (let r = 0; r < total_rows && fully; r++) {
          if (!selected.has(cellKey(r, col))) fully = false;
        }
        const cur = new Set(selected);
        for (let r = 0; r < total_rows; r++) {
          const key = cellKey(r, col);
          if (fully) cur.delete(key);
          else cur.add(key);
        }
        setSelected(cur);
      } else {
        const new_sel = new Set<string>();
        for (let r = 0; r < total_rows; r++) new_sel.add(cellKey(r, col));
        setSelected(new_sel);
      }
      setSelAnchor([0, col]);
      setActiveCell([0, col]);
    },
    [rows_to_render.length, sel_anchor, col_index_of, col_meta, selected],
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

  // ---- Paste ----
  // Writes go straight to the raw props (not the guarded `on_pending_edit`/
  // `on_edit_cell` below, which just re-derive the same pending/real split
  // from a row index) — this already knows which one each write needs.
  const write_cell = useCallback(
    (row: number, col: string, value: string) => {
      if (row < pending_count) on_pending_edit_prop?.(row, col, value);
      else on_edit_cell_prop?.(row, col, value);
    },
    [pending_count, on_pending_edit_prop, on_edit_cell_prop],
  );

  const paste_text = useCallback(async () => {
    if (!editable) return;
    let raw: string;
    try {
      raw = await navigator.clipboard.readText();
    } catch {
      return; // permission denied/unavailable — same silent no-op as copy's own lack of error surfacing
    }
    if (!raw) return;
    const lines = raw.replace(/\r/g, "").split("\n");
    // A copied block's clipboard text ends with a trailing newline; that's
    // not a real extra (empty) row to paste.
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    const grid = lines.map((line) => line.split("\t"));

    // A single copied value pasted over an active multi-cell selection
    // fills every selected cell with it (Excel/Sheets convention) instead
    // of only overwriting the anchor.
    if (grid.length === 1 && grid[0].length === 1 && selected.size > 1) {
      const value = grid[0][0];
      for (const key of selected) {
        const sep = key.indexOf(CELL_KEY_SEP);
        const row = Number(key.slice(0, sep));
        const col = key.slice(sep + 1);
        if (row < rows_to_render.length) write_cell(row, col, value);
      }
      return;
    }

    const start = active_cell ?? sel_anchor;
    if (!start) return;
    const [start_row, start_col] = start;
    const start_ci = col_index_of[start_col];
    if (start_ci === undefined) return;
    for (let i = 0; i < grid.length; i++) {
      const row = start_row + i;
      // Fills into already-loaded rows/columns only — a paste block that
      // overflows the page's current row/column count is silently clamped
      // rather than growing the grid (see DATAGRID_PARITY_PLAN.md's Phase 1
      // note on this).
      if (row >= rows_to_render.length) break;
      const line = grid[i];
      for (let j = 0; j < line.length; j++) {
        const col = column_order[start_ci + j];
        if (col === undefined) break;
        write_cell(row, col, line[j]);
      }
    }
  }, [
    editable,
    selected,
    rows_to_render.length,
    active_cell,
    sel_anchor,
    col_index_of,
    column_order,
    write_cell,
  ]);

  // ---- Clear selection (Delete/Backspace) ----
  const clear_selection = useCallback(() => {
    if (!editable || selected.size === 0) return;
    for (const key of selected) {
      const sep = key.indexOf(CELL_KEY_SEP);
      const row = Number(key.slice(0, sep));
      const col = key.slice(sep + 1);
      if (row < rows_to_render.length) write_cell(row, col, "");
    }
  }, [editable, selected, rows_to_render.length, write_cell]);

  // Routes a generated/bulk value to whichever write path actually produces
  // it: `write_cell` (used everywhere else in this file) always writes a
  // literal string, so a real NULL — distinct from an empty string, which
  // `on_edit_cell`'s own before/after comparison treats as "no edit" when
  // the original was already empty — has to go through the same dedicated
  // path the single-cell "Set NULL" context-menu action already uses
  // (`on_set_null` for real rows, `on_pending_edit` directly with a `null`
  // for pending ones).
  const write_selected_cell = useCallback(
    (row: number, col: string, value: string | null) => {
      if (value === null) {
        if (row < pending_count) on_pending_edit_prop?.(row, col, null);
        else on_set_null(row, col);
        return;
      }
      write_cell(row, col, value);
    },
    [pending_count, on_pending_edit_prop, on_set_null, write_cell],
  );

  // ---- Bulk-edit dialog's "Selection" mode ----
  const bulk_edit_selection = useCallback(
    (value: string | null) => {
      if (!editable || selected.size === 0) return;
      for (const key of selected) {
        const sep = key.indexOf(CELL_KEY_SEP);
        const row = Number(key.slice(0, sep));
        const col = key.slice(sep + 1);
        if (row < rows_to_render.length) write_selected_cell(row, col, value);
      }
    },
    [editable, selected, rows_to_render.length, write_selected_cell],
  );

  // ---- Value-generation (right-click "Fill with…") ----
  // Cells are processed in row-major order (not `selected`'s own insertion/
  // click order) so "increment" counts up top-to-bottom, left-to-right —
  // the order a human reads the selection in, regardless of click order.
  const generate_values = useCallback(
    (kind: "null" | "now" | "increment" | "uuid") => {
      if (!editable || selected.size === 0) return;
      const targets = Array.from(selected)
        .map((key) => {
          const sep = key.indexOf(CELL_KEY_SEP);
          return { row: Number(key.slice(0, sep)), col: key.slice(sep + 1) };
        })
        .filter((t) => t.row < rows_to_render.length)
        .sort(
          (a, b) =>
            a.row - b.row ||
            (col_index_of[a.col] ?? 0) - (col_index_of[b.col] ?? 0),
        );
      if (targets.length === 0) return;
      if (kind === "null") {
        for (const { row, col } of targets) write_selected_cell(row, col, null);
        return;
      }
      if (kind === "now") {
        const now = new Date().toISOString();
        for (const { row, col } of targets) write_selected_cell(row, col, now);
        return;
      }
      if (kind === "uuid") {
        for (const { row, col } of targets) {
          write_selected_cell(row, col, crypto.randomUUID());
        }
        return;
      }
      // "increment" continues from the first target's own current value (so
      // a column already at 5 continues 6, 7, 8…) rather than always
      // restarting at 1.
      const first = targets[0];
      const first_ci = col_index_of[first.col];
      const current =
        first_ci === undefined
          ? null
          : (rows_to_render[first.row]?.[first_ci] ?? null);
      const parsed = current === null ? NaN : Number(current);
      let n = Number.isFinite(parsed) ? parsed : 1;
      for (const { row, col } of targets) {
        write_selected_cell(row, col, String(n));
        n += 1;
      }
    },
    [editable, selected, rows_to_render, col_index_of, write_selected_cell],
  );

  // ---- Fill handle drag ----
  // Excel-style, all four directions PLUS diagonal: dragging the selection
  // net's handle extends the net's bounds out to the drag target
  // (`computeFillBox`); every new cell copies from the source cell nearest
  // to it — its own row/column clamped back into the net (`fillSourceCell`)
  // — so a pure vertical/horizontal drag copies the bordering row/column,
  // and a diagonal drag's corner block copies the net's corner cell.
  const start_fill_drag = useCallback(() => {
    const bounds = view.sel_bounds;
    if (!bounds) return;
    fill_active.current = true;
    setFillSource(bounds);
    setFillTarget({ row: bounds.max_r, ci: bounds.max_ci });
  }, [view.sel_bounds]);

  const fill_drag_to = useCallback(
    (row: number, ci: number) => {
      if (!fill_active.current || !fill_source) return;
      setFillTarget({
        row: Math.max(0, Math.min(row, rows_to_render.length - 1)),
        ci: Math.max(0, Math.min(ci, column_order.length - 1)),
      });
    },
    [fill_source, rows_to_render.length, column_order.length],
  );

  const stop_fill_drag = useCallback(() => {
    fill_active.current = false;
    const source = fill_source;
    const target = fill_target;
    setFillSource(null);
    setFillTarget(null);
    if (!source || !target || !editable) return;
    const box = computeFillBox(source, target);
    if (!box) return;
    const new_sel = new Set(selected);
    // Cache each source column's resolved value at every source row so a
    // diagonal drag's O(rows*cols) cell writes don't each redo a col_meta/
    // col_index_of lookup — the source region is at most the net's own
    // (already-on-screen) size, so this cache is cheap to build.
    const value_at = new Map<string, string | null>();
    const src_value = (row: number, ci: number): string | null => {
      const k = `${row}:${ci}`;
      if (value_at.has(k)) return value_at.get(k) ?? null;
      const col = col_meta[ci]?.[0];
      const col_idx = col === undefined ? undefined : col_index_of[col];
      const v =
        col === undefined || col_idx === undefined
          ? null
          : (rows_to_render[row]?.[col_idx] ?? null);
      value_at.set(k, v);
      return v;
    };
    for (let r = box.min_r; r <= box.max_r; r++) {
      for (let ci = box.min_ci; ci <= box.max_ci; ci++) {
        if (!isNewFillCell(source, r, ci)) continue;
        const col = col_meta[ci]?.[0];
        if (col === undefined) continue;
        const src = fillSourceCell(source, r, ci);
        const value = src_value(src.row, src.ci);
        write_cell(r, col, value ?? "");
        new_sel.add(cellKey(r, col));
      }
    }
    setSelected(new_sel);
  }, [
    fill_source,
    fill_target,
    editable,
    rows_to_render,
    col_meta,
    col_index_of,
    selected,
    write_cell,
  ]);

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

  // Every matching cell across the currently-loaded rows, row-major order —
  // cheap enough to recompute on every keystroke at this grid's typical
  // page sizes (hundreds, not millions, of loaded cells); no debouncing.
  const search_matches = useMemo<CellId[]>(() => {
    const q = search_query.trim().toLowerCase();
    if (!q) return [];
    const matches: CellId[] = [];
    for (let r = 0; r < rows_to_render.length; r++) {
      for (const col of column_order) {
        const ci = col_index_of[col];
        if (ci === undefined) continue;
        const v = rows_to_render[r][ci];
        if (v != null && v.toLowerCase().includes(q)) matches.push([r, col]);
      }
    }
    return matches;
  }, [search_query, rows_to_render, column_order, col_index_of]);

  const search_active_index_clamped =
    search_matches.length === 0
      ? -1
      : Math.min(search_active_index, search_matches.length - 1);
  const search_match_set = useMemo(
    () => new Set(search_matches.map(([r, c]) => cellKey(r, c))),
    [search_matches],
  );
  const search_active_key =
    search_active_index_clamped >= 0
      ? cellKey(...search_matches[search_active_index_clamped])
      : null;

  // Keep the current match scrolled into view as it changes (new query,
  // next/prev) — mirrors keyboard navigation's own scroll-into-view.
  useEffect(() => {
    if (search_active_index_clamped < 0) return;
    const [r, col] = search_matches[search_active_index_clamped];
    const dci = column_order.indexOf(col);
    if (dci >= 0) scroll_to_cell(r, dci);
  }, [
    search_active_index_clamped,
    search_matches,
    column_order,
    scroll_to_cell,
  ]);

  const on_search_open = useCallback(() => setSearchOpen(true), []);
  const on_search_close = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    root_ref.current?.focus({ preventScroll: true });
  }, []);
  const on_search_query = useCallback((q: string) => {
    setSearchQuery(q);
    setSearchActiveIndex(0);
  }, []);
  const on_search_next = useCallback(() => {
    setSearchActiveIndex((i) =>
      search_matches.length === 0 ? 0 : (i + 1) % search_matches.length,
    );
  }, [search_matches.length]);
  const on_search_prev = useCallback(() => {
    setSearchActiveIndex((i) =>
      search_matches.length === 0
        ? 0
        : (i - 1 + search_matches.length) % search_matches.length,
    );
  }, [search_matches.length]);

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
    on_paste: editable ? paste_text : undefined,
    on_clear_selection: editable ? clear_selection : undefined,
    on_search_open,
    search_open,
    on_search_close,
    on_navigate: scroll_to_cell,
    page_size: Math.max(1, row_virtualizer.getVirtualItems().length),
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
      // Right-clicking a cell already inside a wider selection keeps that
      // selection intact (bulk actions like copy/delete still apply to the
      // whole thing) — but the anchor/active cell always moves to the
      // clicked cell regardless. Single-cell actions like "View JSON" must
      // target what was actually clicked, not a stale prior anchor; without
      // this, right-clicking a different row that happened to already be
      // selected left the JSON panel showing the old anchor's row.
      setSelAnchor([row, col]);
      setActiveCell([row, col]);
      if (selected.has(cellKey(row, col))) return;
      setSelected(new Set([cellKey(row, col)]));
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

  // Every distinct row touched by the current selection (any one of its
  // cells, not necessarily the whole row) — "Delete row"/"Clone row" from
  // the context menu act on all of these, not just the row that was
  // right-clicked, mirroring `menu_select`'s own "right-clicking inside an
  // existing selection keeps it intact" rule.
  const rows_in_selection = useCallback((): number[] => {
    const rows = new Set<number>();
    for (const key of selected) {
      const sep = key.indexOf(CELL_KEY_SEP);
      rows.add(Number(key.slice(0, sep)));
    }
    return [...rows].sort((a, b) => a - b);
  }, [selected]);

  // Same count, memoized for the context menu's "Delete N rows"/"Clone N
  // rows" labels — those render on every cell, so this avoids re-deriving
  // it (and re-allocating a Set) once per rendered cell.
  const touched_row_count = useMemo(() => {
    const rows = new Set<number>();
    for (const key of selected)
      rows.add(Number(key.slice(0, key.indexOf(CELL_KEY_SEP))));
    return rows.size;
  }, [selected]);

  const menu_delete = useCallback(
    (row: number) => {
      setEditing(null);
      const rows = rows_in_selection();
      for (const r of rows.length > 0 ? rows : [row]) {
        if (r < pending_count) on_remove_pending_prop?.(r);
        else on_delete_row(r);
      }
    },
    [on_delete_row, on_remove_pending_prop, pending_count, rows_in_selection],
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
      const rows = rows_in_selection();
      on_clone_row?.(rows.length > 0 ? rows : [row]);
    },
    [on_clone_row, rows_in_selection],
  );

  // Keep the JSON viewer showing the row where the selection starts (the
  // anchor cell), just like the highlighted anchor cell in the grid. Buffered
  // (not-yet-applied) cell edits are overlaid so the right-side editor shows
  // exactly what the grid shows. Publishing is idempotent: the row is re-sent
  // only when its content really changes, so the six+ effect deps below can
  // never drive a publish→store-update→re-render loop on their own.
  const last_published = useRef<string | null>(null);
  const anchor_row = sel_anchor?.[0];
  useEffect(() => {
    if (!on_cell_changed) return;
    if (anchor_row === undefined) return;
    const is_pending = anchor_row < pending_count;
    const row = rows_to_render[anchor_row];
    if (!row) return;
    // A pending row's own values (already typed into it via on_pending_edit)
    // live directly in `row` — no dirty-cells overlay to check, that map
    // only tracks edits to already-inserted rows.
    const real = is_pending ? null : row_offset + (anchor_row - pending_count);
    const data: Record<string, unknown> = {};
    for (const col of column_order) {
      const ci = col_index_of[col];
      if (ci === undefined) continue;
      let cell = row[ci] ?? null;
      if (!is_pending) {
        const key = `${col}\u0000${real}`;
        if (dirty_cells?.has(key)) cell = dirty_cells.get(key) ?? null;
      }
      data[col] = toJsonValue(cell, types?.[col]);
    }
    // Pending row_number is its 0-based index in the draft batch (there's
    // no real row position yet) — see JsonRow's doc comment for why the
    // JSON viewer must fold `is_pending` into row identity rather than
    // trusting this number alone.
    const row_number = is_pending ? anchor_row : real! + 1;
    const sig = `${is_pending ? "p" : "r"}${row_number}\u0000${JSON.stringify(data)}`;
    if (last_published.current === sig) return;
    last_published.current = sig;
    on_cell_changed({
      conn_id,
      table,
      row_number,
      is_pending,
      data,
    });
  }, [
    anchor_row,
    on_cell_changed,
    pending_count,
    rows_to_render,
    column_order,
    col_index_of,
    types,
    dirty_cells,
    conn_id,
    table,
    row_offset,
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
    reorder_column,
    hidden_columns,
    toggle_column_visibility,
    col_drag,
    col_drag_over,
    start_column_drag,
    column_drag_over,
    select_column,
    on_select: setSelected,
    on_sel_anchor: setSelAnchor,
    on_active_cell: setActiveCell,
    on_editing: setEditing,
    start_drag,
    drag_to,
    stop_drag,
    fill_source,
    fill_target,
    start_fill_drag,
    fill_drag_to,
    stop_fill_drag,
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
    touched_row_count,
    menu_drill_json: on_drill_json ? menu_drill_json : undefined,
    on_open_reference,
    pending_count,
    pending_dirty: (row: number) => pending[row]?.dirty ?? false,
    on_pending_edit,
    on_remove_pending,
    bulk_edit_selection,
    generate_values,
    cell_dirty,
    row_deleted,
    on_edit_cell,
    root_ref,
    on_root_ready,
    row_virtualizer,
    on_root_mouse_down,
    search_open,
    search_query,
    search_matches,
    search_active_index: search_active_index_clamped,
    search_match_set,
    search_active_key,
    on_search_open,
    on_search_close,
    on_search_query,
    on_search_next,
    on_search_prev,
  };
}
