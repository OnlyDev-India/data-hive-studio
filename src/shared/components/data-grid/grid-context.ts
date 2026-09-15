import {
  createContext,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useContext,
} from "react";
import type { RowWindow } from "./use-row-window";
import type { DiffChange } from "@/shared/components/apply-changes-dialog";
import type { CellClick, CellKind, DistinctMap } from "./types";
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

/** Renders a row's columns as `col: value` lines, one per line, for an
 *  insert/delete diff block. Blank/absent values are dropped for an insert
 *  (skip-empty is the default there — see `QueryOp::Insert`), always kept
 *  for a delete (the row's full stored contents matter for review). */
function row_lines(
  columns: string[] | undefined,
  values: (string | null)[] | undefined,
  kind: "insert" | "delete",
): string {
  return (columns ?? [])
    .map((col, i) => [col, values?.[i]] as const)
    .filter(([, v]) => kind === "delete" || (v !== null && v !== ""))
    .map(([col, v]) => `${col}: ${fmt_cell(v)}`)
    .join("\n");
}

/** Maps the grid's own `PendingChange` shape onto the shared `DiffChange`
 *  shape the review dialog renders — kept as a pure function next to
 *  `PendingChange` so the two can never silently drift apart. */
export function pending_changes_to_diff(
  changes: PendingChange[],
): DiffChange[] {
  return changes.map((c): DiffChange => {
    if (c.kind === "insert") {
      return {
        id: c.id,
        kind: "add",
        entity: "row",
        title: "New row",
        after:
          row_lines(c.value_columns, c.values, "insert") || "(defaults only)",
      };
    }
    if (c.kind === "delete") {
      return {
        id: c.id,
        kind: "drop",
        entity: "row",
        title: `Row ${c.row}`,
        before: row_lines(c.value_columns, c.values, "delete"),
      };
    }
    return {
      id: c.id,
      kind: "alter",
      entity: "cell",
      title: `Row ${c.row} · ${c.column}`,
      before: fmt_cell(c.before),
      after: fmt_cell(c.after),
    };
  });
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
): GridViewData {
  const all_columns: string[] = [];
  const seen = new Set<string>();
  for (const name of columns) {
    if (!seen.has(name)) {
      seen.add(name);
      all_columns.push(name);
    }
  }

  const pinned_list = pinned.filter((p) => all_columns.includes(p));
  const column_order = [
    ...pinned_list,
    ...all_columns.filter((c) => !pinned_list.includes(c)),
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
  sort_col: string | null;
  sort_asc: boolean;
  pinned: string[];
  selected: Set<string>;
  sel_anchor: CellId | null;
  active_cell: CellId | null;
  editing: CellId | null;
  editAsText: boolean;
  col_widths: Record<string, number>;
  // Actions.
  on_sort: (col: string, asc: boolean) => void;
  on_clear_sort: (col: string) => void;
  on_toggle_pin: (col: string) => void;
  on_resize_col: (col: string, px: number) => void;
  auto_fit_col: (col: string) => void;
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
