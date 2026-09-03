import {
  createContext,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useContext,
} from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
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
  row_virtualizer: Virtualizer<HTMLDivElement, Element>;
  on_root_mouse_down: (e: ReactMouseEvent<HTMLDivElement>) => void;
}

export const GridContext = createContext<GridContextValue | null>(null);

export const GridProvider = GridContext.Provider;

export function useGrid(): GridContextValue {
  const ctx = useContext(GridContext);
  if (!ctx) throw new Error("useGrid must be used inside a GridProvider");
  return ctx;
}
