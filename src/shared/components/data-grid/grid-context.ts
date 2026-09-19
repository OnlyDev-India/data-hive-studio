import {
  createContext,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useContext,
} from "react";
import type { RowWindow } from "./use-row-window";
import type { RowDiffChange } from "@/shared/components/apply-changes-dialog";
import type {
  CellClick,
  CellKind,
  DistinctMap,
  GridFilter,
  SortKey,
} from "./types";
import { COL_W_PX, GUTTER_W_PX } from "./types";

/** Identity of a cell: (row index in the page, column name). */
export type CellId = [number, string];

/** Formats a row can be copied as (right-click menu). */
export type CopyFormat = "json" | "sql" | "markdown";

/** One buffered, not-yet-applied change staged in the grid. Used by the apply
 *  diff dialog so the user can review (and deselect) individual changes before
 *  committing. `id` is stable and used to filter what gets applied. */
export interface PendingChange {
  id: string;
  kind: "insert" | "update" | "delete";
  /** Global display row number (1-based, includes the page offset). */
  row: number;
  /** update: the column being changed. */
  column?: string;
  /** update: original stored value. */
  before?: string | null;
  /** update: buffered new value. */
  after?: string | null;
  /** insert: the drafted row's values in column order. */
  values?: (string | null)[];
  /** insert: the drafted row's column names in the same order as `values`. */
  value_columns?: string[];
}

/** Stored value formatted for a diff line; NULL is shown as an explicit
 *  "NULL" rather than an empty string. */
function fmt_cell(v: string | null | undefined): string {
  return v === null || v === undefined ? "NULL" : v;
}

/** Maps the grid's own `PendingChange` shape onto the shared `RowDiffChange`
 *  shape the review dialog's grid renderer expects — kept as a pure
 *  function next to `PendingChange` so the two can never silently drift
 *  apart. Insert/delete stay one entry per change; every `update` touching
 *  the SAME row is merged into a single entry (`ids` collects every
 *  underlying `PendingChange.id` involved, so (de)selecting the merged row
 *  in the dialog still maps back to each individual change when applying —
 *  see `ApplyChangesDialog`'s own doc comment on `rows`). Preserves the
 *  original first-appearance order of rows. */
export function pending_changes_to_row_diff(
  changes: PendingChange[],
): RowDiffChange[] {
  const result: RowDiffChange[] = [];
  const update_index = new Map<number, number>(); // row -> index in result

  for (const c of changes) {
    if (c.kind === "insert") {
      const cols = c.value_columns ?? [];
      const columns = cols.filter((_, i) => {
        const v = c.values?.[i];
        return v !== null && v !== "";
      });
      const after: Record<string, string> = {};
      for (const col of columns)
        after[col] = fmt_cell(c.values?.[cols.indexOf(col)]);
      result.push({
        ids: [c.id],
        kind: "insert",
        row: c.row,
        columns,
        before: {},
        after,
      });
      continue;
    }
    if (c.kind === "delete") {
      const columns = c.value_columns ?? [];
      const before: Record<string, string> = {};
      columns.forEach((col, i) => {
        before[col] = fmt_cell(c.values?.[i]);
      });
      result.push({
        ids: [c.id],
        kind: "delete",
        row: c.row,
        columns,
        before,
        after: {},
      });
      continue;
    }
    // update — merge with any earlier change already staged for this row.
    const col = c.column ?? "";
    const existing_i = update_index.get(c.row);
    if (existing_i === undefined) {
      update_index.set(c.row, result.length);
      result.push({
        ids: [c.id],
        kind: "update",
        row: c.row,
        columns: [col],
        before: { [col]: fmt_cell(c.before) },
        after: { [col]: fmt_cell(c.after) },
      });
    } else {
      const entry = result[existing_i];
      entry.ids.push(c.id);
      entry.columns.push(col);
      entry.before[col] = fmt_cell(c.before);
      entry.after[col] = fmt_cell(c.after);
    }
  }
  return result;
}

/** Bounding box of the selection net, in row index / display-column index. */
export interface SelBounds {
  min_r: number;
  max_r: number;
  min_ci: number;
  max_ci: number;
}

/** All geometry/order derived from the columns, pinning and current widths. */
export interface GridViewData {
  all_columns: string[];
  column_order: string[];
  /** Same pin-partitioned, drag-reordered sequence as `column_order`, but
   *  including hidden columns too (in their last-known position) — the
   *  column-visibility menu's list, so toggling one back on doesn't jump it
   *  to the end. */
  full_column_order: string[];
  /** (column name, index into the result row). */
  col_meta: [string, number][];
  /** Column name -> display (column-order) index. */
  col_index_of: Record<string, number>;
  /** Column name -> sticky left offset when pinned. */
  pin_px: Record<string, number>;
  width_of: (name: string) => number;
  sel_bounds: SelBounds | null;
}

export const cellKey = (r: number, c: string) => `${r}\u0000${c}`;

export function computeGridView(
  columns: string[],
  pinned: string[],
  col_widths: Record<string, number>,
  selected: Set<string>,
  /** User drag-reorder, as a full permutation of column names — `null`/
   *  columns it doesn't mention (e.g. a query whose result added a column
   *  since this was saved) fall back to/append in the natural DB order. */
  column_order_override?: string[] | null,
  /** Hidden columns — excluded from `column_order`/`col_meta` (so headers,
   *  cells, and row-copy/export all skip them) but kept in `all_columns` so
   *  `col_index_of` can still resolve them if something needs to (e.g. a
   *  drill-down that re-hides then un-hides the same column later). */
  hidden?: ReadonlySet<string>,
): GridViewData {
  const all_columns: string[] = [];
  const seen = new Set<string>();
  for (const name of columns) {
    if (!seen.has(name)) {
      seen.add(name);
      all_columns.push(name);
    }
  }

  let base_order = all_columns;
  if (column_order_override && column_order_override.length > 0) {
    const known = new Set(all_columns);
    const kept = column_order_override.filter((c) => known.has(c));
    const keptSet = new Set(kept);
    base_order = [...kept, ...all_columns.filter((c) => !keptSet.has(c))];
  }

  const pinned_list = pinned.filter((p) => all_columns.includes(p));
  const pinned_set = new Set(pinned_list);
  const visible = hidden
    ? base_order.filter((c) => !hidden.has(c))
    : base_order;
  const column_order = [
    ...visible.filter((c) => pinned_set.has(c)),
    ...visible.filter((c) => !pinned_set.has(c)),
  ];
  const full_column_order = [
    ...base_order.filter((c) => pinned_set.has(c)),
    ...base_order.filter((c) => !pinned_set.has(c)),
  ];
  const col_meta: [string, number][] = column_order.map((name) => [
    name,
    all_columns.indexOf(name),
  ]);
  const col_index_of: Record<string, number> = Object.fromEntries(
    col_meta.map(([n, i]) => [n, i]),
  );
  const width_of = (name: string) => col_widths[name] ?? COL_W_PX;

  const pin_px: Record<string, number> = {};
  {
    let acc = GUTTER_W_PX;
    for (const name of pinned_list) {
      pin_px[name] = acc;
      acc += width_of(name);
    }
  }

  let min_r = Infinity;
  let max_r = -Infinity;
  let min_ci = Infinity;
  let max_ci = -Infinity;
  for (const key of selected) {
    const sep = key.indexOf("\u0000");
    const r = Number(key.slice(0, sep));
    const ci = col_index_of[key.slice(sep + 1)];
    if (ci === undefined) continue;
    min_r = Math.min(min_r, r);
    max_r = Math.max(max_r, r);
    min_ci = Math.min(min_ci, ci);
    max_ci = Math.max(max_ci, ci);
  }

  return {
    all_columns,
    column_order,
    full_column_order,
    col_meta,
    col_index_of,
    pin_px,
    width_of,
    sel_bounds: min_r === Infinity ? null : { min_r, max_r, min_ci, max_ci },
  };
}

/** The full region a fill drag covers once the net is extended out to the
 *  drag target — a superset of the original net's own bounds. */
export type FillBox = SelBounds;

/** Extends the net's bounds out to the drag target in whichever directions
 *  the target lies past the net (down/up/right/left, or both axes at once
 *  for a diagonal drag) — `null` means the target is still inside the net:
 *  nothing to fill yet. Every NEW cell (inside the returned box but outside
 *  `source`) fills from the source cell nearest to it — its own row/column
 *  CLAMPED back into the net's bounds — so a pure vertical/horizontal drag
 *  copies the bordering row/column, and a diagonal drag's corner block
 *  copies the net's corner cell, the same clamp-to-nearest-edge rule in
 *  both cases (see `fill_source_cell`). */
export function computeFillBox(
  source: SelBounds,
  target: { row: number; ci: number },
): FillBox | null {
  const min_r = Math.min(source.min_r, target.row);
  const max_r = Math.max(source.max_r, target.row);
  const min_ci = Math.min(source.min_ci, target.ci);
  const max_ci = Math.max(source.max_ci, target.ci);
  if (
    min_r === source.min_r &&
    max_r === source.max_r &&
    min_ci === source.min_ci &&
    max_ci === source.max_ci
  ) {
    return null;
  }
  return { min_r, max_r, min_ci, max_ci };
}

/** True for a cell inside `box` but outside `source` — the cells a fill
 *  drag actually writes to / highlights as a preview. */
export function isNewFillCell(
  source: SelBounds,
  row: number,
  ci: number,
): boolean {
  return (
    row < source.min_r ||
    row > source.max_r ||
    ci < source.min_ci ||
    ci > source.max_ci
  );
}

/** The source cell a new fill cell copies from: its own row/column, clamped
 *  back into the net's bounds — the net's bordering row for a vertical
 *  drag, bordering column for a horizontal one, or corner cell for a
 *  diagonal one. */
export function fillSourceCell(
  source: SelBounds,
  row: number,
  ci: number,
): { row: number; ci: number } {
  return {
    row: Math.min(Math.max(row, source.min_r), source.max_r),
    ci: Math.min(Math.max(ci, source.min_ci), source.max_ci),
  };
}

/** Everything a data grid needs to render and interact, shared via context. */
export interface GridContextValue {
  // Data + schema-derived config.
  rows: (string | null)[][];
  columns: string[];
  row_offset: number;
  conn_id: string;
  table: string;
  editable: boolean;
  /** True while the page query is in flight — header actions pause. */
  loading?: boolean;
  pk_columns: string[];
  kinds: Record<string, CellKind>;
  types?: Record<string, string>;
  key_kinds?: Record<string, "primary" | "foreign" | "both">;
  /** Column name -> referenced table/column for foreign-key columns. */
  fk_targets?: Record<string, { table: string; column: string }>;
  nullable?: Record<string, boolean>;
  distinct: DistinctMap;
  view: GridViewData;
  /** Column name -> display (column-order) index. */
  col_index_of: Record<string, number>;
  // Visual state.
  /** Sort keys in priority order; index 0 = primary. Empty = unsorted. */
  sort_keys: SortKey[];
  pinned: string[];
  selected: Set<string>;
  sel_anchor: CellId | null;
  active_cell: CellId | null;
  editing: CellId | null;
  editAsText: boolean;
  col_widths: Record<string, number>;
  // Actions.
  /** Adds `col` to the sort (or updates its direction in place if it's
   *  already sorted) without clearing any other active sort key. */
  on_sort: (col: string, asc: boolean) => void;
  /** Removes just `col` from the sort, leaving any other active keys. */
  on_clear_sort: (col: string) => void;
  on_clear_all_sort: () => void;
  on_toggle_pin: (col: string) => void;
  on_resize_col: (col: string, px: number) => void;
  auto_fit_col: (col: string) => void;
  /** Drag `dragged` to just before/after `target`'s current position. */
  reorder_column: (dragged: string, target: string) => void;
  hidden_columns: ReadonlySet<string>;
  toggle_column_visibility: (col: string) => void;
  /** Column currently being pointer-dragged (from anywhere in the header,
   *  not a dedicated handle), plus the live pointer position for the
   *  floating ghost badge; `null` when no column drag is in progress. */
  col_drag: { col: string; x: number; y: number } | null;
  /** Column the drag is currently hovering over — reordering happens live
   *  as this changes, not just on drop, so it's also the current position
   *  of the dragged column. */
  col_drag_over: string | null;
  start_column_drag: (col: string, x: number, y: number) => void;
  column_drag_over: (col: string) => void;
  /** Selects every cell in `col` (the header's own click) — Ctrl/Cmd toggles
   *  it within the existing selection, Shift extends from the last anchor
   *  column across a range. */
  select_column: (
    col: string,
    opts?: { add?: boolean; range?: boolean },
  ) => void;
  /** Currently applied WHERE filters (the same list the filter bar shows) —
   *  header cells read this to know whether their own quick-filter is
   *  active and pre-check the right boxes. Absent for grids with no filter
   *  bar at all (e.g. `query-results-grid.tsx`). */
  filters?: GridFilter[];
  /** Sets (or clears, when `values` is null) an Excel-style "column IN
   *  (...)" quick filter — the header's own per-column filter popover.
   *  Absent for grids with no filter bar. */
  on_column_filter?: (col: string, values: string[] | null) => void;
  /** Live `SelectDistinct` query for one column, unbounded — the quick
   *  filter's escalation path when the loaded page doesn't hold every
   *  distinct value. Absent for grids with no live backend (e.g. read-only
   *  query results), which fall back to the loaded page's own values. */
  fetch_distinct_values?: (col: string) => Promise<(string | null)[]>;
  /** FK column -> raw value -> looked-up display label from the referenced
   *  row (`"<value> (<label>)"` in the cell) — only covers values on the
   *  currently loaded page. Absent/missing entries just render the raw
   *  value, same as before this existed. */
  fk_labels?: Record<string, Record<string, string>>;
  on_select: (sel: Set<string>) => void;
  on_sel_anchor: (a: CellId | null) => void;
  on_active_cell: (a: CellId | null) => void;
  on_editing: (a: CellId | null) => void;
  // Cell interaction glue.
  start_drag: (ev: CellClick) => void;
  drag_to: (ev: CellClick) => void;
  stop_drag: () => void;
  // Fill handle (Excel-style, vertical-only) drag — separate from the
  // selection drag above so the two gestures never fight over what a
  // mouseenter/mouseup means mid-drag.
  /** Snapshot of the selection net's bounds when the fill drag started;
   *  `null` when no fill drag is in progress. */
  fill_source: SelBounds | null;
  /** Cell the fill drag currently covers to; `null` when no fill drag is in
   *  progress. */
  fill_target: { row: number; ci: number } | null;
  start_fill_drag: () => void;
  fill_drag_to: (row: number, ci: number) => void;
  stop_fill_drag: () => void;
  open_editor: (ev: CellClick) => void;
  close_editor: () => void;
  handle_keydown: (e: KeyboardEvent<HTMLDivElement>) => void;
  on_root_keydown: (e: KeyboardEvent<HTMLDivElement>) => void;
  // Right-click context menu actions.
  menu_select: (row: number, col: string) => void;
  menu_copy: () => void;
  menu_edit: (row: number, col: string, asText?: boolean) => void;
  menu_set_null: (row: number, col: string) => void;
  menu_delete: (row: number) => void;
  /** Present only when the host supports it; opens the right-side JSON viewer. */
  menu_show_json?: () => void;
  /** Present only when the host supports it; opens a breadcrumbed drill-down
   * grid over the JSON value of the clicked cell. */
  menu_drill_json?: (row: number, col: string) => void;
  /** Copy the clicked row (or all fully-selected rows) as a formatted blob. */
  menu_copy_as?: (row: number, format: CopyFormat) => void;
  /** Present only when the host table supports it; duplicates the clicked row. */
  menu_clone_row?: (row: number) => void;
  /** Number of distinct rows touched by the current selection (any one of
   *  its cells, not necessarily the whole row) — labels the context menu's
   *  "Delete row(s)"/"Clone row(s)" entries, and is always >= 1 for a right-
   *  clicked cell (`menu_select` guarantees at least that cell is selected). */
  touched_row_count: number;
  /** Present only when the host supports it; opens the referenced table in a
   * new tab filtered to this cell's value. */
  on_open_reference?: (
    table: string,
    column: string,
    value: string | null,
  ) => void;
  // Pending (new, not-yet-inserted) rows live at the top of `rows`.
  /** Number of pending rows currently pinned to the top of the grid. */
  pending_count: number;
  /** True once the user has edited any cell of the pending row at `row`. */
  pending_dirty: (row: number) => boolean;
  /** Buffer a cell edit on a pending row instead of writing to the DB. */
  on_pending_edit: (row: number, col: string, value: string | null) => void;
  /** Discard the pending row at the given grid row without applying it. */
  on_remove_pending: (row: number) => void;
  /** Buffer `value` (or NULL) into every currently-selected cell — the bulk-
   *  edit dialog's "Selection" mode. */
  bulk_edit_selection: (value: string | null) => void;
  /** Generate a value into every currently-selected cell — the right-click
   *  "Fill with…" menu. `increment` continues from the first (row-major)
   *  selected cell's own current value. */
  generate_values: (kind: "null" | "now" | "increment" | "uuid") => void;
  // Buffered edits/deletes awaiting Apply.
  /** True when the cell has a buffered edit (already reflected in `rows`). */
  cell_dirty: (row: number, col: string) => boolean;
  /** True when the row is marked for deletion (still shown, awaiting Apply). */
  row_deleted: (row: number) => boolean;
  /** Buffer a cell edit on a real row instead of issuing an UPDATE. */
  on_edit_cell: (row: number, col: string, value: string | null) => void;
  // DOM plumbing.
  root_ref: RefObject<HTMLDivElement | null>;
  /** Callback ref that stores the root div — never hand the ref object itself to JSX. */
  on_root_ready: (el: HTMLDivElement | null) => void;
  /** Row windowing state; the root div doubles as the virtualizer's scroll element. */
  row_virtualizer: RowWindow;
  on_root_mouse_down: (e: ReactMouseEvent<HTMLDivElement>) => void;
  // ---- In-grid find (Ctrl/Cmd+F) ----
  search_open: boolean;
  search_query: string;
  /** Every matching cell, in row-major order — `search_active_index` points
   *  into this; used for the "N of M" count and next/prev wraparound. */
  search_matches: CellId[];
  search_active_index: number;
  /** Same cells as `search_matches`, as `cellKey`s — O(1) membership check
   *  for `Cell`'s own per-render highlight instead of scanning the array. */
  search_match_set: Set<string>;
  /** `cellKey` of the current match (`search_matches[search_active_index]`),
   *  or `null` when there are no matches — the one rendered with the
   *  stronger "active match" highlight. */
  search_active_key: string | null;
  on_search_open: () => void;
  on_search_close: () => void;
  on_search_query: (q: string) => void;
  on_search_next: () => void;
  on_search_prev: () => void;
}

export const GridContext = createContext<GridContextValue | null>(null);

export const GridProvider = GridContext.Provider;

export function useGrid(): GridContextValue {
  const ctx = useContext(GridContext);
  if (!ctx) throw new Error("useGrid must be used inside a GridProvider");
  return ctx;
}
