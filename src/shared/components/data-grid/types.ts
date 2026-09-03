/** Layout constants and shared helper types for the data grid. */

/** Fixed data-column width so pinned sticky offsets are predictable. */
export const COL_W_PX = 144;
/** Width of the row-number gutter at the far-left of the grid. */
export const GUTTER_W_PX = 48;
/**
 * Estimated row height for virtualization (text-sm line + py-1.5 + border).
 * Rows are measured after mount, so this only shapes the first paint.
 */
export const ROW_ESTIMATE_PX = 33;
/** Page-size choices offered in the toolbar selector. */
export const PAGE_SIZES = [50, 100, 200];
/** Number of distinct values fetched per column (fetch 51 to detect "many"). */
export const DISTINCT_LIMIT = 51;

/** A cell identity: (row index in the page, column name). */
export type CellId = [number, string];

/** Distinct (non-null) values per column, used to drive dropdown editors. */
export type DistinctMap = Record<string, (string | null)[]>;

/** The editor widget a cell gets, based on its declared type and distinct values. */
export type CellKind =
  | "text"
  | "bool"
  | "date"
  | "datetime"
  | "dropdown"
  | "array";

/** A filter row built from the UI: column + operator + optional value. */
export interface GridFilter {
  id: number;
  column: string;
  op: FilterOp;
  value: string;
  /** How this filter joins the previous one; undefined for the first filter. */
  conjunction?: "AND" | "OR";
}

export type FilterOp =
  | "eq"
  | "neq"
  | "contains"
  | "starts_with"
  | "ends_with"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_null"
  | "is_not_null";

export const FILTER_OPS: { value: FilterOp; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "contains", label: "contains" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "is_null", label: "is null" },
  { value: "is_not_null", label: "is not null" },
];

/** How the filter value input should look, based on the column type. */
export type FilterValueKind =
  "text" | "number" | "bool" | "date" | "datetime" | "dropdown";

function isNumericType(t: string): boolean {
  return (
    t.includes("int") ||
    t.includes("real") ||
    t.includes("float") ||
    t.includes("double") ||
    t.includes("numeric") ||
    t.includes("decimal")
  );
}

/** The operators + value input kind allowed for a column of this type. */
export function filterConfigFor(typeLower: string): {
  ops: FilterOp[];
  valueKind: FilterValueKind;
} {
  if (typeLower.includes("bool")) {
    return { ops: ["eq", "neq", "is_null", "is_not_null"], valueKind: "bool" };
  }
  if (
    typeLower.includes("time") ||
    typeLower.includes("timestamp") ||
    typeLower.includes("datetime")
  ) {
    return {
      ops: ["eq", "neq", "gt", "gte", "lt", "lte", "is_null", "is_not_null"],
      valueKind: "datetime",
    };
  }
  if (typeLower.includes("date")) {
    return {
      ops: ["eq", "neq", "gt", "gte", "lt", "lte", "is_null", "is_not_null"],
      valueKind: "date",
    };
  }
  if (typeLower.includes("enum")) {
    return {
      ops: ["eq", "neq", "is_null", "is_not_null"],
      valueKind: "dropdown",
    };
  }
  if (isNumericType(typeLower)) {
    return {
      ops: ["eq", "neq", "gt", "gte", "lt", "lte", "is_null", "is_not_null"],
      valueKind: "number",
    };
  }
  return {
    ops: [
      "eq",
      "neq",
      "contains",
      "starts_with",
      "ends_with",
      "is_null",
      "is_not_null",
    ],
    valueKind: "text",
  };
}

/** Decide what editor a column should get. */
export function classify(typeLower: string): CellKind {
  if (typeLower.includes("bool")) return "bool";
  if (
    typeLower.includes("time") ||
    typeLower.includes("timestamp") ||
    typeLower.includes("datetime")
  ) {
    return "datetime";
  }
  if (typeLower.includes("date")) return "date";
  if (typeLower.includes("enum")) return "dropdown";
  return "text";
}

/** A click that happened on a grid cell (row, column, modifier flags, and
 * whether it was on the row-number gutter). */
export interface CellClick {
  row: number;
  col: string;
  add: boolean;
  range: boolean;
  gutter: boolean;
}

/** Precomputed info for one cell. */
export interface CellSpec {
  row: number;
  col: string;
  ci: number;
  /** Position of this column in the display order (after pinning). */
  dci: number;
  value: string | null;
  kind: CellKind;
  is_selected: boolean;
  is_active: boolean;
  is_editing: boolean;
  pinned: boolean;
  px: number;
  /** Bitmask of selection-rectangle edges this cell sits on (see EDGE_*). */
  sel_edges: number;
  /** Whether this cell is the selection's start/anchor cell (full highlight). */
  is_anchor: boolean;
  /** Whether this cell is the last (bottom-right) cell of the selection net. */
  is_handle: boolean;
  /** Current pixel width for this column (after user resizing). */
  width: number;
}

/** Bit flags for which outer edges of the selection rectangle a cell sits on. */
export const EDGE_TOP = 1;
export const EDGE_RIGHT = 2;
export const EDGE_BOTTOM = 4;
export const EDGE_LEFT = 8;

/** Precomputed info for one row plus its cells and its gutter state. */
export interface RowSpec {
  row_data: (string | null)[];
  gutter_sel: boolean;
  cells: CellSpec[];
}
