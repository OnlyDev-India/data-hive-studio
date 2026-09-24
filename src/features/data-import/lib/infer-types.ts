import type { Cell } from "./types";

/** What a column of the file looks like, before a dialect names it. */
export type InferredKind =
  | "integer"
  | "bigint"
  | "decimal"
  | "boolean"
  | "date"
  | "timestamp"
  | "json"
  | "text";

export const KIND_LABELS: Record<InferredKind, string> = {
  integer: "Whole number",
  bigint: "Big whole number",
  decimal: "Decimal",
  boolean: "True or false",
  date: "Date",
  timestamp: "Date and time",
  json: "JSON",
  text: "Text",
};

const INTEGER = /^[+-]?(0|[1-9]\d*)$/;
const DECIMAL = /^[+-]?((0|[1-9]\d*)(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const INT_MAX = 2_147_483_647;

/** The narrowest kind that fits every non empty cell. An empty column, or one
 *  that mixes kinds, is text. Leading zeros ("007") keep a column as text so
 *  no digits are lost. */
export function inferKind(cells: Cell[]): InferredKind {
  let kind: InferredKind | null = null;
  const seen = (k: InferredKind) => {
    if (kind === null || kind === k) return (kind = k);
    if (
      (kind === "integer" || kind === "bigint") &&
      (k === "integer" || k === "bigint")
    ) {
      return (kind = "bigint");
    }
    const numeric = new Set<InferredKind>(["integer", "bigint", "decimal"]);
    if (numeric.has(kind) && numeric.has(k)) return (kind = "decimal");
    if (
      (kind === "date" && k === "timestamp") ||
      (kind === "timestamp" && k === "date")
    ) {
      return (kind = "timestamp");
    }
    return (kind = "text");
  };
  for (const cell of cells) {
    if (cell === null || cell === "") continue;
    seen(kindOf(cell));
    if (kind === "text") return "text";
  }
  return kind ?? "text";
}

function kindOf(cell: Cell): InferredKind {
  if (typeof cell === "boolean") return "boolean";
  if (typeof cell === "number") {
    if (!Number.isInteger(cell)) return "decimal";
    return Math.abs(cell) > INT_MAX ? "bigint" : "integer";
  }
  if (typeof cell === "object") return "json";
  const t = cell.trim();
  const lower = t.toLowerCase();
  if (lower === "true" || lower === "false") return "boolean";
  if (INTEGER.test(t))
    return Math.abs(Number(t)) > INT_MAX ? "bigint" : "integer";
  if (DECIMAL.test(t)) return "decimal";
  if (DATE.test(t)) return "date";
  if (TIMESTAMP.test(t)) return "timestamp";
  return "text";
}
