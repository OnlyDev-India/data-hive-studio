import { literal, valueKind, type ValueKind } from "../literals";
import { markerName, maskedMarker } from "../markers";
import type { Dialect } from "../sql-text";
import { clauseOf, isColumn, keyword, parseFragment, type Node } from "./cst";

export type Op =
  | "="
  | "<>"
  | "<"
  | "<="
  | ">"
  | ">="
  | "LIKE"
  | "NOT LIKE"
  | "ILIKE"
  | "IN"
  | "NOT IN"
  | "BETWEEN"
  | "IS NULL"
  | "IS NOT NULL"
  | "EXISTS"
  | "NOT EXISTS";

export const OPS: Op[] = [
  "=",
  "<>",
  "<",
  "<=",
  ">",
  ">=",
  "LIKE",
  "NOT LIKE",
  "ILIKE",
  "IN",
  "NOT IN",
  "BETWEEN",
  "IS NULL",
  "IS NOT NULL",
  "EXISTS",
  "NOT EXISTS",
];

/** Operators with no value. */
export const NO_VALUE: ReadonlySet<Op> = new Set(["IS NULL", "IS NOT NULL"]);

/** Operators whose only value is a subquery, with no column. */
export const SUB_ONLY: ReadonlySet<Op> = new Set(["EXISTS", "NOT EXISTS"]);

/** Operators that take a subquery as their value. */
export const SUB_OK: ReadonlySet<Op> = new Set([
  "=",
  "<>",
  "<",
  "<=",
  ">",
  ">=",
  "IN",
  "NOT IN",
  "EXISTS",
  "NOT EXISTS",
]);

export interface Cond {
  kind: "cond";
  /** A column, or an aggregate in HAVING, as SQL text. */
  column: string;
  op: Op;
  /** The values as typed, unquoted: one, two for BETWEEN, any for IN. */
  values: string[];
  /** How each value was written when read from text; null once typed in,
   *  so the column's type decides. */
  kinds: (ValueKind | null)[];
  /** The value is the subquery with this marker, instead of `values`. */
  sub?: number;
}

export interface Group {
  kind: "group";
  join: "AND" | "OR";
  items: Cond[];
}

export interface Conditions {
  join: "AND" | "OR";
  items: (Cond | Group)[];
}

export const emptyCond = (column = ""): Cond => ({
  kind: "cond",
  column,
  op: "=",
  values: [""],
  kinds: [null],
});

type Read = { value: string; kind: ValueKind } | null;

/** A literal as its typed value and kind, else null. */
export function readValue(n: Node, text: (n: Node) => string): Read {
  switch (n.type) {
    case "string_literal":
      return { value: String(n.value), kind: "text" };
    case "number_literal":
      return { value: text(n), kind: "number" };
    case "boolean_literal":
      return { value: text(n).toUpperCase(), kind: "boolean" };
    case "prefix_op_expr": {
      const inner = n.expr as Node;
      if (keyword(n.operator) === "-" && inner.type === "number_literal")
        return { value: `-${text(inner)}`, kind: "number" };
      return null;
    }
    default:
      return null;
  }
}

/** Flatten a chain of one logical operator: `a AND b AND c`. */
function chain(n: Node, op: "AND" | "OR"): Node[] {
  if (n.type === "binary_expr" && keyword(n.operator).toUpperCase() === op)
    return [...chain(n.left as Node, op), ...chain(n.right as Node, op)];
  return [n];
}

function topJoin(n: Node): "AND" | "OR" {
  return n.type === "binary_expr" && keyword(n.operator).toUpperCase() === "OR"
    ? "OR"
    : "AND";
}

/** The marker a masked subquery stands for, if `n` is one. */
const subOf = (n: Node, text: (n: Node) => string) =>
  n.type === "paren_expr" ? maskedMarker(text(n)) : null;

function readCond(n: Node, text: (n: Node) => string): Cond | null {
  if (n.type === "prefix_op_expr") {
    let not = false;
    let e = n;
    if (keyword(e.operator).toUpperCase() === "NOT") {
      not = true;
      e = e.expr as Node;
    }
    if (
      e.type !== "prefix_op_expr" ||
      keyword(e.operator).toUpperCase() !== "EXISTS"
    )
      return null;
    const sub = subOf(e.expr as Node, text);
    if (sub === null) return null;
    return {
      kind: "cond",
      column: "",
      op: not ? "NOT EXISTS" : "EXISTS",
      values: [],
      kinds: [],
      sub,
    };
  }
  const column = (left: unknown) =>
    left && (isColumn(left as Node) || (left as Node).type === "func_call")
      ? text(left as Node)
      : null;
  if (n.type === "between_expr") {
    const col = column(n.left);
    const not = keyword(n.betweenKw).toUpperCase().startsWith("NOT");
    const a = readValue(n.begin as Node, text);
    const b = readValue(n.end as Node, text);
    if (!col || not || !a || !b) return null;
    return {
      kind: "cond",
      column: col,
      op: "BETWEEN",
      values: [a.value, b.value],
      kinds: [a.kind, b.kind],
    };
  }
  if (n.type !== "binary_expr") return null;
  const col = column(n.left);
  if (!col) return null;
  const op = keyword(n.operator).toUpperCase();
  const right = n.right as Node;
  if (op === "IS" || op === "IS NOT") {
    if (right.type !== "null_literal") return null;
    return {
      kind: "cond",
      column: col,
      op: op === "IS" ? "IS NULL" : "IS NOT NULL",
      values: [],
      kinds: [],
    };
  }
  const known = op === "!=" ? "<>" : op;
  const sub = subOf(right, text);
  if (sub !== null) {
    if (!SUB_OK.has(known as Op)) return null;
    return {
      kind: "cond",
      column: col,
      op: known as Op,
      values: [],
      kinds: [],
      sub,
    };
  }
  if (op === "IN" || op === "NOT IN") {
    if (right.type !== "paren_expr") return null;
    const list = right.expr as Node;
    const nodes = list.type === "list_expr" ? (list.items as Node[]) : [list];
    const read = nodes.map((x) => readValue(x, text));
    if (read.some((r) => !r)) return null;
    return {
      kind: "cond",
      column: col,
      op: op as Op,
      values: read.map((r) => r!.value),
      kinds: read.map((r) => r!.kind),
    };
  }
  if (!OPS.includes(known as Op) || SUB_ONLY.has(known as Op)) return null;
  const v = readValue(right, text);
  if (!v) return null;
  return {
    kind: "cond",
    column: col,
    op: known as Op,
    values: [v.value],
    kinds: [v.kind],
  };
}

/** WHERE or HAVING text as condition rows, one level of groups deep. Null
 *  when the form can't show it. */
export function parseConditions(
  body: string,
  dialect: Dialect,
): Conditions | null {
  if (!body.trim()) return { join: "AND", items: [] };
  const sql = `SELECT 1 FROM t WHERE ${body}`;
  const f = parseFragment(sql, dialect);
  const where = f && clauseOf(f, "where_clause");
  if (!f || !where) return null;
  const expr = where.expr as Node;
  const join = topJoin(expr);
  const out: Conditions = { join, items: [] };
  for (const part of chain(expr, join)) {
    if (part.type === "paren_expr") {
      const inner = part.expr as Node;
      const inner_join = topJoin(inner);
      if (inner_join === join && chain(inner, join).length > 1) return null;
      const conds = chain(inner, inner_join).map((p) => readCond(p, f.text));
      if (conds.some((c) => !c)) return null;
      out.items.push({
        kind: "group",
        join: inner_join,
        items: conds as Cond[],
      });
      continue;
    }
    const c = readCond(part, f.text);
    if (!c) return null;
    out.items.push(c);
  }
  return out;
}

function printCond(c: Cond, typeOf: (column: string) => string | null) {
  if (c.sub !== undefined) {
    const sub = markerName(c.sub);
    return SUB_ONLY.has(c.op) ? `${c.op} ${sub}` : `${c.column} ${c.op} ${sub}`;
  }
  const type = typeOf(c.column);
  const lit = (i: number) =>
    literal(
      c.values[i] ?? "",
      c.kinds[i] ?? valueKind(type, c.values[i] ?? ""),
    );
  switch (c.op) {
    case "IS NULL":
    case "IS NOT NULL":
      return `${c.column} ${c.op}`;
    case "BETWEEN":
      return `${c.column} BETWEEN ${lit(0)} AND ${lit(1)}`;
    case "IN":
    case "NOT IN":
      return `${c.column} ${c.op} (${c.values.map((_, i) => lit(i)).join(", ")})`;
    default:
      return `${c.column} ${c.op} ${lit(0)}`;
  }
}

/** Whether a row is filled in enough to print: a column, or an EXISTS
 *  with its subquery. */
const filled = (c: Cond) =>
  SUB_ONLY.has(c.op) ? c.sub !== undefined : !!c.column.trim();

/** Condition rows as WHERE or HAVING text. Rows with no column are left
 *  out. `typeOf` gives a column's catalog type for its literals. */
export function printConditions(
  c: Conditions,
  typeOf: (column: string) => string | null,
): string {
  const parts: string[] = [];
  for (const item of c.items) {
    if (item.kind === "cond") {
      if (filled(item)) parts.push(printCond(item, typeOf));
      continue;
    }
    const inner = item.items.filter(filled).map((x) => printCond(x, typeOf));
    if (inner.length === 1) parts.push(inner[0]);
    else if (inner.length > 1) parts.push(`(${inner.join(` ${item.join} `)})`);
  }
  return parts.join(` ${c.join} `);
}
