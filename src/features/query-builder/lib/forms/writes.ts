import { literal, valueKind, type ValueKind } from "../literals";
import { isMarker, markerName, maskedMarker } from "../markers";
import { parseTableRef, type Dialect, type TableRef } from "../sql-text";
import { readValue } from "./conditions";
import { clauseOf, isColumn, items, parseFragment, type Node } from "./cst";
import { parseSelect, printSelect, type Picked } from "./lists";

/** Whether `n` sets nothing beyond `allowed`: an `OR REPLACE`, a partial
 *  index target and the like fail it. Unset keys and empty lists pass. */
export function only(n: Node, allowed: string[]): boolean {
  return Object.entries(n).every(
    ([k, v]) =>
      v === undefined ||
      (Array.isArray(v) && v.length === 0) ||
      k === "type" ||
      k === "range" ||
      allowed.includes(k),
  );
}

/** An UPDATE or DELETE target: one table and an optional alias. */
export function parseTarget(body: string): TableRef | null {
  if (!body.trim()) return null;
  return parseTableRef(body);
}

/** A target with its alias after AS, which SQLite needs. */
export function printTarget(t: TableRef): string {
  const name = t.schema ? `${t.schema}.${t.name}` : t.name;
  return t.alias ? `${name} AS ${t.alias}` : name;
}

/** One `column = value` row of a SET: a typed literal, an expression as
 *  written, DEFAULT, or a subquery (`value` holds its marker). */
export interface SetRow {
  column: string;
  mode: "value" | "expr" | "default" | "sub";
  value: string;
  /** How a literal was written when read from text; null once typed in,
   *  so the column's type decides. */
  kind: ValueKind | null;
}

export const emptySet = (column = ""): SetRow => ({
  column,
  mode: "value",
  value: "",
  kind: null,
});

function readAssignments(
  list: Node,
  text: (n: Node) => string,
): SetRow[] | null {
  const out: SetRow[] = [];
  for (const a of items(list)) {
    if (a.type !== "column_assignment" || !isColumn(a.column as Node))
      return null;
    const column = text(a.column as Node);
    const expr = a.expr as Node;
    if (expr.type === "default") {
      out.push({ column, mode: "default", value: "", kind: null });
      continue;
    }
    const sub = expr.type === "paren_expr" ? maskedMarker(text(expr)) : null;
    if (sub !== null) {
      out.push({ column, mode: "sub", value: String(sub), kind: null });
      continue;
    }
    const v = readValue(expr, text);
    out.push(
      v
        ? { column, mode: "value", value: v.value, kind: v.kind }
        : { column, mode: "expr", value: text(expr), kind: null },
    );
  }
  return out;
}

export function parseSet(body: string, dialect: Dialect): SetRow[] | null {
  if (!body.trim()) return [];
  const f = parseFragment(`UPDATE t SET ${body}`, dialect, "update_stmt");
  const set = f && clauseOf(f, "set_clause");
  if (!f || !set) return null;
  return readAssignments(set.assignments as Node, f.text);
}

function setValue(r: SetRow, type: string | null): string {
  if (r.mode === "default") return "DEFAULT";
  if (r.mode === "sub") return markerName(Number(r.value));
  if (r.mode === "expr") return r.value.trim() || "NULL";
  return literal(r.value, r.kind ?? valueKind(type, r.value));
}

/** SET rows as text; rows with no column are left out. */
export function printSet(
  rows: SetRow[],
  typeOf: (column: string) => string | null,
): string {
  return rows
    .filter((r) => r.column.trim())
    .map((r) => `${r.column} = ${setValue(r, typeOf(r.column))}`)
    .join(", ");
}

/** The INSERT card: the table, and the columns written (none for every
 *  column, in table order). */
export interface InsertForm {
  table: TableRef | null;
  columns: string[];
}

export function parseInsert(body: string, dialect: Dialect): InsertForm | null {
  if (!body.trim()) return { table: null, columns: [] };
  const f = parseFragment(
    `INSERT INTO ${body} VALUES (1)`,
    dialect,
    "insert_stmt",
  );
  const c = f && clauseOf(f, "insert_clause");
  if (!f || !c || !only(c, ["insertKw", "intoKw", "table", "columns"]))
    return null;
  let table = c.table as Node;
  let cols = c.columns as Node | undefined;
  let alias: string | null = null;
  if (table.type === "alias") {
    alias = f.text(table.alias as Node);
    cols ??= table.columnAliases as Node | undefined;
    table = table.expr as Node;
  }
  const ref = isColumn(table) ? parseTableRef(f.text(table)) : null;
  if (!ref) return null;
  const names = cols ? items(cols.expr as Node) : [];
  if (names.some((n) => n.type !== "identifier")) return null;
  return { table: { ...ref, alias }, columns: names.map(f.text) };
}

export function printInsert(f: InsertForm): string {
  if (!f.table) return "";
  const cols = f.columns.filter((c) => c.trim());
  const list = cols.length > 0 ? ` (${cols.join(", ")})` : "";
  return `${printTarget(f.table)}${list}`;
}

/** One VALUES cell: a typed literal, or the DEFAULT keyword. An empty cell
 *  is NULL. */
export interface Cell {
  value: string;
  kind: ValueKind | "keyword" | null;
}

export interface ValuesForm {
  rows: Cell[][];
  /** The rows come from the subquery with this marker instead. */
  source?: number;
}

/** Whether a VALUES card holds a query as its source rather than rows. */
export const isQuerySource = (body: string) =>
  /^\s*(select|with)\b/i.test(body);

function readCell(n: Node, text: (n: Node) => string): Cell | null {
  if (n.type === "null_literal") return { value: "", kind: null };
  if (n.type === "default") return { value: "DEFAULT", kind: "keyword" };
  const v = readValue(n, text);
  return v && { value: v.value, kind: v.kind };
}

/** VALUES text, `(1, 'a'), (2, NULL)`, as rows of cells. Null for a query
 *  source or a cell that is not a literal, which stay in SQL. */
export function parseValues(body: string, dialect: Dialect): ValuesForm | null {
  if (!body.trim()) return { rows: [] };
  if (isMarker(body.trim()))
    return { rows: [], source: Number(body.trim().slice("__dh_sub_".length)) };
  if (!/^\s*\(/.test(body)) return null;
  const f = parseFragment(
    `INSERT INTO t VALUES ${body}`,
    dialect,
    "insert_stmt",
  );
  const v = f && clauseOf(f, "values_clause");
  if (!f || !v) return null;
  const rows: Cell[][] = [];
  for (const row of items(v.values as Node)) {
    if (row.type !== "paren_expr") return null;
    const cells = items(row.expr as Node).map((n) => readCell(n, f.text));
    if (cells.some((c) => !c)) return null;
    rows.push(cells as Cell[]);
  }
  return { rows };
}

function cellText(c: Cell, type: string | null): string {
  const v = c.value.trim();
  if (c.kind === "keyword") return v.toUpperCase();
  if (!v) return "NULL";
  if (c.kind === null && /^(null|default)$/i.test(v)) return v.toUpperCase();
  return literal(c.value, c.kind ?? valueKind(type, c.value));
}

/** Rows as VALUES text; `typeAt` gives column i's catalog type. */
export function printValues(
  f: ValuesForm,
  typeAt: (i: number) => string | null,
): string {
  if (f.source !== undefined) return markerName(f.source);
  return f.rows
    .filter((r) => r.length > 0)
    .map((r) => `(${r.map((c, i) => cellText(c, typeAt(i))).join(", ")})`)
    .join(", ");
}

/** The ON CONFLICT card: the key columns, then DO NOTHING or DO UPDATE
 *  with SET rows and an optional WHERE. */
export interface ConflictForm {
  target: string[];
  action: "nothing" | "update";
  set: SetRow[];
  where: string;
}

export function parseConflict(
  body: string,
  dialect: Dialect,
): ConflictForm | null {
  if (!body.trim())
    return { target: [], action: "nothing", set: [], where: "" };
  const f = parseFragment(
    `INSERT INTO t VALUES (1) ON CONFLICT ${body}`,
    dialect,
    "insert_stmt",
  );
  if (!f) return null;
  const ups = f.clauses.filter((c) => c.type === "upsert_clause");
  const u = ups[0];
  if (
    ups.length !== 1 ||
    !only(u, ["onConflictKw", "conflictTarget", "doKw", "action"])
  )
    return null;
  const target: string[] = [];
  const t = u.conflictTarget as Node | undefined;
  if (t) {
    if (t.type !== "paren_expr") return null;
    for (const spec of items(t.expr as Node)) {
      const expr =
        spec.type === "index_specification" ? (spec.expr as Node) : spec;
      if (!isColumn(expr) || (spec !== expr && !only(spec, ["expr"])))
        return null;
      target.push(f.text(expr));
    }
  }
  const action = u.action as Node;
  if (action.type === "upsert_action_nothing")
    return { target, action: "nothing", set: [], where: "" };
  if (action.type !== "upsert_action_update") return null;
  const set = readAssignments((action.set as Node).assignments as Node, f.text);
  if (!set) return null;
  const where = action.where as Node | undefined;
  return {
    target,
    action: "update",
    set,
    where: where ? f.text(where.expr as Node) : "",
  };
}

export function printConflict(
  f: ConflictForm,
  typeOf: (column: string) => string | null,
): string {
  const target = f.target.filter((c) => c.trim());
  const head = target.length > 0 ? `(${target.join(", ")}) ` : "";
  if (f.action === "nothing") return `${head}DO NOTHING`;
  const where = f.where.trim() ? ` WHERE ${f.where.trim()}` : "";
  return `${head}DO UPDATE SET ${printSet(f.set, typeOf)}${where}`;
}

/** RETURNING: every column (`*`), or picked columns with aliases. */
export interface ReturningForm {
  all: boolean;
  items: Picked[];
}

export function parseReturning(
  body: string,
  dialect: Dialect,
): ReturningForm | null {
  if (!body.trim()) return { all: false, items: [] };
  if (body.trim() === "*") return { all: true, items: [] };
  const picked = parseSelect(body, dialect);
  return picked && { all: false, items: picked };
}

export function printReturning(f: ReturningForm): string {
  return f.all ? "*" : printSelect(f.items);
}
