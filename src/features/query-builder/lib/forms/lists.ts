import type { Dialect } from "../sql-text";
import {
  clauseOf,
  isColumn,
  items,
  keyword,
  parseFragment,
  type Node,
} from "./cst";

export const AGGREGATES = [
  "COUNT",
  "COUNT DISTINCT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
] as const;
export type AggregateFn = (typeof AGGREGATES)[number];

export interface Aggregate {
  fn: AggregateFn;
  /** A column, or `*` for COUNT. */
  arg: string;
  alias: string;
}

export interface GroupForm {
  keys: string[];
  aggregates: Aggregate[];
}

export interface Picked {
  /** A column as SQL text. */
  expr: string;
  alias: string;
}

export interface Sort {
  expr: string;
  dir: "ASC" | "DESC";
}

/** Each item of `text` as a list (SELECT columns, GROUP BY keys), read
 *  through `SELECT <text> FROM t` or `... GROUP BY <text>`. */
function list(
  sql: string,
  clause: string,
  field: string,
  dialect: Dialect,
): { nodes: Node[]; text: (n: Node) => string; clause: Node } | null {
  const f = parseFragment(sql, dialect);
  const c = f && clauseOf(f, clause);
  if (!f || !c) return null;
  return { nodes: items(c[field] as Node), text: f.text, clause: c };
}

function aliased(n: Node, text: (n: Node) => string) {
  if (n.type === "alias")
    return { expr: n.expr as Node, alias: text(n.alias as Node) };
  return { expr: n, alias: "" };
}

/** `COUNT(*)`, `COUNT(DISTINCT x)`, `SUM(x)` and the rest, else null. */
function readAggregate(
  expr: Node,
  text: (n: Node) => string,
): Omit<Aggregate, "alias"> | null {
  if (expr.type !== "func_call") return null;
  const name = text(expr.name as Node).toUpperCase();
  const args = (expr.args as Node | undefined)?.expr as Node | undefined;
  if (!args || args.type !== "func_args") return null;
  const arg = items(args.args as Node);
  if (arg.length !== 1) return null;
  const star = arg[0].type === "all_columns";
  if (!star && !isColumn(arg[0])) return null;
  const fn = args.distinctKw ? `${name} DISTINCT` : name;
  if (!(AGGREGATES as readonly string[]).includes(fn)) return null;
  if (star && fn !== "COUNT") return null;
  return { fn: fn as AggregateFn, arg: star ? "*" : text(arg[0]) };
}

export function parseGroup(
  keys: string,
  aggregates: string,
  dialect: Dialect,
): GroupForm | null {
  const out: GroupForm = { keys: [], aggregates: [] };
  if (keys.trim()) {
    const l = list(
      `SELECT 1 FROM t GROUP BY ${keys}`,
      "group_by_clause",
      "columns",
      dialect,
    );
    if (!l || l.nodes.some((n) => !isColumn(n))) return null;
    out.keys = l.nodes.map(l.text);
  }
  if (aggregates.trim()) {
    const l = list(
      `SELECT ${aggregates} FROM t`,
      "select_clause",
      "columns",
      dialect,
    );
    if (!l || (l.clause.modifiers as Node[]).length > 0) return null;
    for (const n of l.nodes) {
      const { expr, alias } = aliased(n, l.text);
      const a = readAggregate(expr, l.text);
      if (!a) return null;
      out.aggregates.push({ ...a, alias });
    }
  }
  return out;
}

export function printAggregate(a: Aggregate): string {
  const call =
    a.fn === "COUNT DISTINCT"
      ? `COUNT(DISTINCT ${a.arg})`
      : `${a.fn}(${a.arg || "*"})`;
  return a.alias.trim() ? `${call} AS ${a.alias.trim()}` : call;
}

export function printGroup(g: GroupForm): { keys: string; aggregates: string } {
  return {
    keys: g.keys.filter((k) => k.trim()).join(", "),
    aggregates: g.aggregates
      .filter((a) => a.fn === "COUNT" || a.arg.trim())
      .map(printAggregate)
      .join(", "),
  };
}

/** SELECT text as picked columns (and aggregates, after a GROUP BY) with
 *  aliases. Null for DISTINCT, `*` and computed expressions, which stay in
 *  the SQL view. */
export function parseSelect(body: string, dialect: Dialect): Picked[] | null {
  if (!body.trim()) return [];
  const l = list(`SELECT ${body} FROM t`, "select_clause", "columns", dialect);
  if (!l || (l.clause.modifiers as Node[]).length > 0) return null;
  const out: Picked[] = [];
  for (const n of l.nodes) {
    const { expr, alias } = aliased(n, l.text);
    if (!isColumn(expr) && !readAggregate(expr, l.text)) return null;
    out.push({ expr: l.text(expr), alias });
  }
  return out;
}

export function printSelect(items: Picked[]): string {
  return items
    .filter((p) => p.expr.trim())
    .map((p) => (p.alias.trim() ? `${p.expr} AS ${p.alias.trim()}` : p.expr))
    .join(", ");
}

/** ORDER BY text as column and direction rows. */
export function parseOrder(body: string, dialect: Dialect): Sort[] | null {
  if (!body.trim()) return [];
  const l = list(
    `SELECT 1 FROM t ORDER BY ${body}`,
    "order_by_clause",
    "specifications",
    dialect,
  );
  if (!l) return null;
  const out: Sort[] = [];
  for (const n of l.nodes) {
    if (n.type === "sort_specification") {
      if (n.nullHandlingKw) return null;
      const expr = n.expr as Node;
      if (!isColumn(expr)) return null;
      const dir = n.direction
        ? keyword((n.direction as Node).descKw ?? (n.direction as Node).ascKw)
        : "ASC";
      out.push({
        expr: l.text(expr),
        dir: dir.toUpperCase() === "DESC" ? "DESC" : "ASC",
      });
      continue;
    }
    if (!isColumn(n)) return null;
    out.push({ expr: l.text(n), dir: "ASC" });
  }
  return out;
}

export function printOrder(items: Sort[]): string {
  return items
    .filter((s) => s.expr.trim())
    .map((s) => (s.dir === "DESC" ? `${s.expr} DESC` : s.expr))
    .join(", ");
}
