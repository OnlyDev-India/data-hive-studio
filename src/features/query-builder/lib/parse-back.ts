import { parse as parseSql } from "sql-parser-cst";
import type { Clause } from "@/shared/store";
import { isColumn, items, keyword, type Node } from "./forms/cst";
import { newClause } from "./model";
import type { Dialect } from "./sql-text";

export type ParseBack =
  { ok: true; clauses: Clause[] } | { ok: false; error: string };

const refuse = (what: string): ParseBack => ({
  ok: false,
  error: `The builder can't hold ${what}. Keep this query in the SQL editor.`,
});

/** Clauses the cards can't hold, by the parser's clause type. */
const REFUSED_CLAUSES: Record<string, string> = {
  with_clause: "a WITH clause",
  window_clause: "a WINDOW clause",
  for_clause: "FOR UPDATE or FOR SHARE",
  into_table_clause: "SELECT INTO",
  into_clause: "SELECT INTO",
};

/** Why a FROM or JOIN source is not a plain table, or null when it is. */
function sourceProblem(n: Node, text: string): string | null {
  const inner = n.type === "alias" ? (n.expr as Node) : n;
  if (isColumn(inner)) return null;
  if (/^\s*lateral\b/i.test(text)) return "LATERAL";
  if (inner.type === "func_call" || inner.type === "table_func_call")
    return "a function as a FROM or JOIN source";
  return "a subquery as a FROM or JOIN source";
}

/** One SELECT as cards, each holding its clause's text as written. Refuses
 *  what the cards can't hold, naming the construct. */
export function parseBack(sql: string, dialect: Dialect): ParseBack {
  let program: { statements: Node[] };
  try {
    program = parseSql(sql, {
      dialect,
      includeRange: true,
    }) as unknown as { statements: Node[] };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message.split("\n")[0] };
  }
  const statements = program.statements.filter((s) => s.type !== "empty");
  if (statements.length === 0)
    return { ok: false, error: "There is no query to open." };
  if (statements.length > 1) return refuse("more than one statement");
  const stmt = statements[0];
  if (stmt.type === "compound_select_stmt")
    return refuse("UNION, INTERSECT or EXCEPT");
  if (stmt.type !== "select_stmt") return refuse("anything but a SELECT");

  const text = (n: Node | undefined) =>
    n?.range ? sql.slice(n.range[0], n.range[1]) : "";
  const start = (op: unknown): number | null => {
    const first = Array.isArray(op) ? op[0] : op;
    return (first as Node | undefined)?.range?.[0] ?? null;
  };
  const by = new Map<string, Node>();
  for (const c of stmt.clauses as Node[]) {
    if (REFUSED_CLAUSES[c.type]) return refuse(REFUSED_CLAUSES[c.type]);
    by.set(c.type, c);
  }
  const known = new Set([
    "select_clause",
    "from_clause",
    "where_clause",
    "group_by_clause",
    "having_clause",
    "order_by_clause",
    "limit_clause",
  ]);
  for (const t of by.keys())
    if (!known.has(t))
      return refuse(`a ${t.replace(/_clause$/, "").replace(/_/g, " ")} clause`);

  const from = by.get("from_clause");
  if (!from) return refuse("a query with no FROM");

  // The FROM tree nests to the left: walk it into the table and its joins.
  const out: Clause[] = [];
  const joins: Clause[] = [];
  let problem: string | null = null;
  const walk = (n: Node) => {
    if (n.type !== "join_expr") {
      problem ??= sourceProblem(n, text(n));
      out.push(newClause("from", text(n)));
      return;
    }
    walk(n.left as Node);
    const op = keyword(n.operator);
    if (op === ",") {
      problem ??= "a comma join";
      return;
    }
    const right = n.right as Node;
    problem ??= sourceProblem(right, text(right));
    const end = ((n.specification as Node | undefined) ?? right).range?.[1];
    const begin = start(n.operator);
    if (begin === null || end === undefined) {
      problem ??= "this join";
      return;
    }
    joins.push(newClause("join", sql.slice(begin, end)));
  };
  walk(from.expr as Node);
  if (problem) return refuse(problem);
  out.push(...joins);

  const where = by.get("where_clause");
  if (where) out.push(newClause("where", text(where.expr as Node)));

  const select = by.get("select_clause")!;
  const distinct = (select.modifiers as Node[]).length > 0;
  if ((select.modifiers as Node[]).some((m) => m.type !== "select_distinct"))
    return refuse("this SELECT modifier");
  const list = items(select.columns as Node);
  const star = list.length === 1 && list[0].type === "all_columns";

  const group = by.get("group_by_clause");
  let select_text = star && !distinct ? null : text(select.columns as Node);
  if (distinct) select_text = `DISTINCT ${select_text}`;
  if (group) {
    const keys = items(group.columns as Node).map(text);
    const g = newClause("group", keys.join(", "));
    // A select list of exactly the keys, then aggregates, lives on the
    // GROUP BY card; anything else keeps its own SELECT card.
    const plain = list.filter((n) => {
      const e = n.type === "alias" ? (n.expr as Node) : n;
      return e.type !== "func_call";
    });
    const calls = list.filter((n) => !plain.includes(n));
    const fits =
      !distinct &&
      plain.length === keys.length &&
      plain.every((n, i) => text(n) === keys[i]) &&
      list.slice(0, plain.length).every((n, i) => n === plain[i]);
    if (fits) {
      g.aggregates = calls.map(text).join(", ");
      select_text = null;
    }
    out.push(g);
    const having = by.get("having_clause");
    if (having) out.push(newClause("having", text(having.expr as Node)));
  } else if (by.has("having_clause")) return refuse("HAVING without GROUP BY");

  if (select_text !== null) out.push(newClause("select", select_text));

  const order = by.get("order_by_clause");
  if (order) out.push(newClause("order", text(order.specifications as Node)));

  const limit = by.get("limit_clause");
  if (limit) {
    const count = limit.count as Node | undefined;
    const offset = limit.offset as Node | undefined;
    if (
      !count ||
      count.type !== "number_literal" ||
      (offset && offset.type !== "number_literal")
    )
      return refuse("a LIMIT or OFFSET that is not a number");
    out.push(
      newClause(
        "limit",
        offset ? `${text(count)} OFFSET ${text(offset)}` : text(count),
      ),
    );
  }
  return { ok: true, clauses: out };
}
