import { parse as parseSql } from "sql-parser-cst";
import type {
  BuilderQuery,
  BuilderQueryKind,
  Clause,
  ClauseKind,
  SubChain,
} from "@/shared/store";
import { statementRanges } from "@/shared/lib/utils";
import { cardsText } from "./chains";
import { isColumn, items, keyword, parseable, type Node } from "./forms/cst";
import { isQuerySource, only, parseInsert, parseTarget } from "./forms/writes";
import { markerName } from "./markers";
import { newClause, statementQuery } from "./model";
import { readSetOp, type Dialect } from "./sql-text";

export type ParseBack =
  | { ok: true; kind: BuilderQueryKind; clauses: Clause[] }
  | {
      ok: false;
      error: string;
      /** What a statement card says about it, such as "LATERAL, kept as
       *  SQL"; null when its kind says enough. */
      note: string | null;
    };

type Refused = Extract<ParseBack, { ok: false }>;

const refuse = (what: string): Refused => ({
  ok: false,
  error: `The cards can't hold ${what}.`,
  note: `${what[0].toUpperCase()}${what.slice(1)}, kept as SQL`,
});

/** Thrown inside a read, caught where it started. */
class Refusal {
  readonly why: Refused;
  constructor(why: Refused) {
    this.why = why;
  }
}

const no = (what: string): never => {
  throw new Refusal(refuse(what));
};

/** Clauses the cards can't hold, by the parser's clause type. */
const REFUSED_CLAUSES: Record<string, string> = {
  window_clause: "a WINDOW clause",
  for_clause: "FOR UPDATE or FOR SHARE",
  into_table_clause: "SELECT INTO",
  into_clause: "SELECT INTO",
  default_values: "DEFAULT VALUES",
};

const refuseClause = (c: Node): never =>
  no(
    REFUSED_CLAUSES[c.type] ??
      `a ${c.type.replace(/_clause$/, "").replace(/_/g, " ")} clause`,
  );

const isSelect = (n: Node | undefined) =>
  n?.type === "select_stmt" || n?.type === "compound_select_stmt";

/** A parenthesized subquery: `(SELECT …)`. */
const isSubquery = (n: Node) =>
  n.type === "paren_expr" && isSelect(n.expr as Node);

/** Every parenthesized subquery under `n`, at any depth. */
function subqueries(n: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(n)) for (const x of n) subqueries(x, out);
  else if (n && typeof n === "object") {
    const node = n as Node;
    if (typeof node.type === "string" && isSubquery(node) && node.range)
      out.push(node);
    for (const [k, v] of Object.entries(node))
      if (k !== "range" && k !== "type") subqueries(v, out);
  }
  return out;
}

/** One statement being read: its text and every subquery in it. */
interface Ctx {
  sql: string;
  subs: Node[];
}

/** One card list being read: its markers are unique across it. */
interface List {
  next: number;
}

const within = (n: Node, from: number, to: number) =>
  n.range![0] >= from && n.range![1] <= to;

/** The text from `from` to `to` as a card body: each outermost subquery in
 *  it becomes a chain, with a marker where it was. */
function lift(
  ctx: Ctx,
  list: List,
  from: number,
  to: number,
): { body: string; chains: SubChain[] } {
  const inside = ctx.subs.filter((s) => within(s, from, to));
  const outer = inside.filter(
    (s) => !inside.some((o) => o !== s && within(s, o.range![0], o.range![1])),
  );
  outer.sort((a, b) => a.range![0] - b.range![0]);
  let body = "";
  let at = from;
  const chains: SubChain[] = [];
  for (const s of outer) {
    const marker = list.next++;
    chains.push(chainFrom(ctx, s.expr as Node, marker));
    body += ctx.sql.slice(at, s.range![0]) + markerName(marker);
    at = s.range![1];
  }
  body += ctx.sql.slice(at, to);
  return { body, chains };
}

function chainFrom(ctx: Ctx, stmt: Node, marker: number): SubChain {
  return {
    id: crypto.randomUUID(),
    marker,
    name: null,
    clauses: readQuery(ctx, stmt, "chain"),
    collapsed: false,
  };
}

/** A card of `kind` holding the text of `n` (or `from` to `to`). */
function card(
  ctx: Ctx,
  list: List,
  kind: ClauseKind,
  n: Node | [number, number] | undefined,
): Clause {
  const [from, to] = Array.isArray(n) ? n : (n?.range ?? [0, 0]);
  const { body, chains } = lift(ctx, list, from, to);
  return withChains(newClause(kind, body), chains);
}

const withChains = (c: Clause, chains: SubChain[]): Clause =>
  chains.length > 0 ? { ...c, chains } : c;

const text = (ctx: Ctx, n: Node | undefined) =>
  n?.range ? ctx.sql.slice(n.range[0], n.range[1]) : "";

/** Why a FROM or JOIN source is not a table or an aliased subquery, or
 *  null when it is one. */
function sourceProblem(ctx: Ctx, n: Node): string | null {
  const inner = n.type === "alias" ? (n.expr as Node) : n;
  if (isColumn(inner)) return null;
  if (/^\s*lateral\b/i.test(text(ctx, n))) return "a LATERAL join";
  if (isSubquery(inner))
    return n.type === "alias" ? null : "a subquery source with no alias";
  if (inner.type === "func_call" || inner.type === "table_func_call")
    return "a function as a FROM or JOIN source";
  return "this FROM or JOIN source";
}

/** A FROM tree, nested to the left, as a FROM card and its JOIN cards. */
function fromCards(ctx: Ctx, list: List, expr: Node): Clause[] {
  const start = (op: unknown): number | null => {
    const first = Array.isArray(op) ? op[0] : op;
    return (first as Node | undefined)?.range?.[0] ?? null;
  };
  const from: Clause[] = [];
  const joins: Clause[] = [];
  const walk = (n: Node) => {
    if (n.type !== "join_expr") {
      const problem = sourceProblem(ctx, n);
      if (problem) no(problem);
      from.push(card(ctx, list, "from", n));
      return;
    }
    walk(n.left as Node);
    if (keyword(n.operator) === ",") no("a comma join");
    const right = n.right as Node;
    const problem = sourceProblem(ctx, right);
    if (problem) no(problem);
    const end = ((n.specification as Node | undefined) ?? right).range?.[1];
    const begin = start(n.operator);
    if (begin === null || end === undefined) no("this join");
    joins.push(card(ctx, list, "join", [begin!, end!]));
  };
  walk(expr);
  return [...from, ...joins];
}

/** A CTE list as CTE cards. */
function cteCards(ctx: Ctx, list: List, w: Node): Clause[] {
  const recursive = !!w.recursiveKw;
  return items(w.tables as Node).map((t) => {
    if (!only(t, ["table", "columns", "asKw", "expr"])) no("this CTE option");
    const name = text(ctx, t.table as Node);
    const def = t.expr as Node;
    if (!isSubquery(def)) no("this CTE");
    const cols = t.columns ? ` ${text(ctx, t.columns as Node)}` : "";
    const self =
      recursive &&
      new RegExp(
        String.raw`(^|[^\w$"])${name.replace(/[^\w$]/g, "\\$&")}($|[^\w$"])`,
        "i",
      ).test(text(ctx, def));
    const chain = chainFrom(ctx, def.expr as Node, list.next++);
    return withChains(
      newClause("cte", `${self ? "RECURSIVE " : ""}${name}${cols}`),
      [chain],
    );
  });
}

/** ORDER BY and LIMIT cards. */
function tailCards(ctx: Ctx, list: List, by: Map<string, Node>): Clause[] {
  const out: Clause[] = [];
  const order = by.get("order_by_clause");
  if (order) out.push(card(ctx, list, "order", order.specifications as Node));
  const limit = by.get("limit_clause");
  if (limit) {
    const count = limit.count as Node | undefined;
    const offset = limit.offset as Node | undefined;
    if (
      !count ||
      count.type !== "number_literal" ||
      (offset && offset.type !== "number_literal")
    )
      no("a LIMIT or OFFSET that is not a number");
    out.push(
      newClause(
        "limit",
        offset
          ? `${text(ctx, count)} OFFSET ${text(ctx, offset)}`
          : text(ctx, count),
      ),
    );
  }
  return out;
}

const SELECT_CLAUSES = new Set([
  "with_clause",
  "select_clause",
  "from_clause",
  "where_clause",
  "group_by_clause",
  "having_clause",
  "order_by_clause",
  "limit_clause",
]);

/** A SELECT's clauses by type, refusing any the cards can't hold. */
function clausesBy(stmt: Node, role: Role): Map<string, Node> {
  const by = new Map<string, Node>();
  for (const c of stmt.clauses as Node[]) {
    if (REFUSED_CLAUSES[c.type] || !SELECT_CLAUSES.has(c.type)) refuseClause(c);
    by.set(c.type, c);
  }
  if (by.has("with_clause") && role !== "query") no("a WITH inside a subquery");
  return by;
}

type Role = "query" | "chain" | "side";

/** One SELECT's cards up to HAVING, in written order: CTE, SELECT, FROM,
 *  JOIN, WHERE, GROUP BY, HAVING. An empty SELECT card stands for `*`. */
function headCards(ctx: Ctx, list: List, by: Map<string, Node>): Clause[] {
  const out: Clause[] = [];
  const w = by.get("with_clause");
  const ctes = w ? cteCards(ctx, list, w) : [];

  const from = by.get("from_clause");
  if (!from) no("a query with no FROM");
  out.push(...fromCards(ctx, list, from!.expr as Node));

  const where = by.get("where_clause");
  if (where) out.push(card(ctx, list, "where", where.expr as Node));

  const select = by.get("select_clause")!;
  const distinct = (select.modifiers as Node[]).length > 0;
  if ((select.modifiers as Node[]).some((m) => m.type !== "select_distinct"))
    no("this SELECT modifier");
  const columns = select.columns as Node;
  const list_items = items(columns);
  const star = list_items.length === 1 && list_items[0].type === "all_columns";

  const group = by.get("group_by_clause");
  let select_card: Clause | null =
    star && !distinct
      ? newClause("select")
      : card(ctx, list, "select", columns);
  if (distinct)
    select_card = { ...select_card, body: `DISTINCT ${select_card.body}` };
  if (group) {
    const keys = items(group.columns as Node).map((n) => text(ctx, n));
    const g = card(ctx, list, "group", group.columns as Node);
    // A select list of exactly the keys, then aggregates, lives on the
    // GROUP BY card; anything else keeps its own SELECT card.
    const plain = list_items.filter((n) => {
      const e = n.type === "alias" ? (n.expr as Node) : n;
      return e.type !== "func_call";
    });
    const calls = list_items.filter((n) => !plain.includes(n));
    const fits =
      !distinct &&
      plain.length === keys.length &&
      plain.every((n, i) => text(ctx, n) === keys[i]) &&
      list_items.slice(0, plain.length).every((n, i) => n === plain[i]) &&
      !calls.some((n) => subqueries(n).length > 0);
    if (fits) {
      g.aggregates = calls.map((n) => text(ctx, n)).join(", ");
      select_card = newClause("select");
    }
    out.push(g);
    const having = by.get("having_clause");
    if (having) out.push(card(ctx, list, "having", having.expr as Node));
  } else if (by.has("having_clause")) no("HAVING without GROUP BY");

  return [...ctes, select_card, ...out];
}

/** A SELECT, or a chain of set operations, as cards in written order. The
 *  set operations' ORDER BY and LIMIT sit on the last SELECT. */
function readQuery(ctx: Ctx, stmt: Node, role: Role): Clause[] {
  const list: List = { next: 1 };
  if (stmt.type === "select_stmt") {
    const by = clausesBy(stmt, role);
    if (
      role === "side" &&
      (by.has("order_by_clause") || by.has("limit_clause"))
    )
      no("ORDER BY or LIMIT inside a set operation");
    return [...headCards(ctx, list, by), ...tailCards(ctx, list, by)];
  }
  if (stmt.type !== "compound_select_stmt") return no("this query");
  if (role === "side") no("a set operation inside a set operation");
  const steps: { op: string; right: Node }[] = [];
  let left = stmt;
  while (left.type === "compound_select_stmt") {
    steps.unshift({ op: keyword(left.operator), right: left.right as Node });
    left = left.left as Node;
  }
  if (left.type !== "select_stmt") no("a parenthesized set operation");
  const head = clausesBy(left, role);
  if (head.has("order_by_clause") || head.has("limit_clause"))
    no("ORDER BY or LIMIT inside a set operation");
  const cards = headCards(ctx, list, head);
  let tail: Clause[] = [];
  steps.forEach(({ op, right }, i) => {
    const set = readSetOp(op);
    if (!set) no(`${op.toUpperCase()}`);
    if (right.type !== "select_stmt") no("a parenthesized set operation");
    const last = i === steps.length - 1;
    const by = clausesBy(right, "side");
    if (last) {
      tail = tailCards(ctx, list, by);
      by.delete("order_by_clause");
      by.delete("limit_clause");
    } else if (by.has("order_by_clause") || by.has("limit_clause"))
      no("ORDER BY or LIMIT inside a set operation");
    const side: SubChain = {
      id: crypto.randomUUID(),
      marker: list.next++,
      name: null,
      clauses: headCards(ctx, { next: 1 }, by),
      collapsed: false,
    };
    cards.push(withChains(newClause("compound", set!), [side]));
  });
  return [...cards, ...tail];
}

/** The one table an UPDATE or DELETE clause names, or null. */
function oneTarget(ctx: Ctx, c: Node, keys: string[]): string | null {
  const tables = items(c.tables as Node);
  if (tables.length !== 1 || !only(c, keys)) return null;
  const t = text(ctx, tables[0]);
  return parseTarget(t) ? t : null;
}

/** An UPDATE, DELETE or INSERT as write cards in written order. */
function readWrite(
  ctx: Ctx,
  stmt: Node,
  dialect: Dialect,
): { kind: BuilderQueryKind; clauses: Clause[] } {
  const list: List = { next: 1 };
  const out: Clause[] = [];
  const kind: BuilderQueryKind =
    stmt.type === "update_stmt"
      ? "update"
      : stmt.type === "delete_stmt"
        ? "delete"
        : "insert";
  for (const c of stmt.clauses as Node[]) {
    switch (c.type) {
      case "update_clause": {
        const t = oneTarget(ctx, c, ["updateKw", "tables"]);
        if (!t) no("this UPDATE target");
        out.push(newClause("update", t!));
        break;
      }
      case "delete_clause": {
        const t = oneTarget(ctx, c, ["deleteKw", "fromKw", "tables"]);
        if (!t) no("this DELETE target");
        out.push(newClause("delete", t!));
        break;
      }
      case "insert_clause": {
        if (!only(c, ["insertKw", "intoKw", "table", "columns"]))
          no("this INSERT form");
        const table = c.table as Node;
        const end = ((c.columns as Node | undefined) ?? table).range?.[1];
        const body =
          table.range && end !== undefined
            ? ctx.sql.slice(table.range[0], end)
            : "";
        if (!parseInsert(body, dialect)) no("this INSERT target");
        out.push(newClause("insert", body));
        break;
      }
      case "set_clause":
        out.push(card(ctx, list, "set", c.assignments as Node));
        break;
      case "from_clause": {
        if (kind === "delete") {
          const problem = sourceProblem(ctx, c.expr as Node);
          if (problem && (c.expr as Node).type !== "join_expr") no(problem);
          out.push(card(ctx, list, "using", c.expr as Node));
          break;
        }
        out.push(...fromCards(ctx, list, c.expr as Node));
        break;
      }
      case "values_clause":
        out.push(card(ctx, list, "values", c.values as Node));
        break;
      case "select_stmt":
      case "compound_select_stmt": {
        const chain = chainFrom(ctx, c, list.next++);
        out.push(
          withChains(newClause("values", markerName(chain.marker)), [chain]),
        );
        break;
      }
      case "upsert_clause": {
        if (out.some((x) => x.kind === "conflict"))
          no("more than one ON CONFLICT");
        const first = (c.conflictTarget ?? c.doKw) as Node | undefined;
        if (!first?.range || !c.range) no("this ON CONFLICT");
        out.push(card(ctx, list, "conflict", [first!.range![0], c.range![1]]));
        break;
      }
      case "where_clause":
        out.push(card(ctx, list, "where", c.expr as Node));
        break;
      case "returning_clause":
        out.push(card(ctx, list, "returning", c.columns as Node));
        break;
      default:
        refuseClause(c);
    }
  }
  if (kind === "insert" && !out.some((x) => x.kind === "values"))
    no("an INSERT with no rows or query");
  return { kind, clauses: out };
}

/** One statement, or null when it is not exactly one. */
function parseOne(
  sql: string,
  dialect: Dialect,
): Node | { error: string } | null {
  let program: { statements: Node[] };
  try {
    program = parseSql(...parseable(sql, dialect)) as unknown as {
      statements: Node[];
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { error: message.split("\n")[0] };
  }
  const statements = program.statements.filter((s) => s.type !== "empty");
  return statements.length === 1 ? statements[0] : null;
}

/** One statement as cards: a SELECT (with its CTEs, set operations and
 *  subqueries), UPDATE, DELETE or INSERT, each card holding its clause's
 *  text as written and each subquery as a chain. Refuses what the cards
 *  can't hold, naming the construct. */
export function parseBack(sql: string, dialect: Dialect): ParseBack {
  let program: { statements: Node[] };
  try {
    program = parseSql(...parseable(sql, dialect)) as unknown as {
      statements: Node[];
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: message.split("\n")[0],
      note: "The parser can't read it, kept as SQL",
    };
  }
  const statements = program.statements.filter((s) => s.type !== "empty");
  if (statements.length === 0)
    return { ok: false, error: "There is no statement here.", note: null };
  if (statements.length > 1)
    return {
      ok: false,
      error: "It holds more than one statement.",
      note: null,
    };
  const stmt = statements[0];
  const ctx: Ctx = { sql, subs: subqueries(stmt) };
  try {
    switch (stmt.type) {
      case "select_stmt":
      case "compound_select_stmt":
        return {
          ok: true,
          kind: "select",
          clauses: readQuery(ctx, stmt, "query"),
        };
      case "update_stmt":
      case "delete_stmt":
      case "insert_stmt":
        return { ok: true, ...readWrite(ctx, stmt, dialect) };
      default:
        return {
          ok: false,
          error:
            "The cards hold SELECT, UPDATE, DELETE and INSERT queries only.",
          note: null,
        };
    }
  } catch (e) {
    if (e instanceof Refusal) return e.why;
    throw e;
  }
}

/** How a card's SQL view text is read back: wrapped in a statement the
 *  parser takes, the body's place in it, and the clause holding it. */
function wrapFor(
  kind: ClauseKind,
  body: string,
): { sql: string; at: number; type: string } | null {
  const wrap = (before: string, after = "", type = "select_stmt") => ({
    sql: `${before}${body}${after}`,
    at: before.length,
    type,
  });
  switch (kind) {
    case "where":
    case "having":
      return wrap("SELECT 1 FROM t WHERE ");
    case "select":
      return wrap("SELECT ", " FROM t");
    case "from":
      return wrap("SELECT 1 FROM ");
    case "join":
      return wrap("SELECT 1 FROM t ");
    case "group":
      return wrap("SELECT 1 FROM t GROUP BY ");
    case "order":
      return wrap("SELECT 1 FROM t ORDER BY ");
    case "set":
      return wrap("UPDATE t SET ", "", "update_stmt");
    case "using":
      return wrap("DELETE FROM t USING ", "", "delete_stmt");
    case "conflict":
      return wrap("INSERT INTO t VALUES (1) ON CONFLICT ", "", "insert_stmt");
    case "values":
      return isQuerySource(body)
        ? wrap("INSERT INTO t ", "", "insert_stmt")
        : wrap("INSERT INTO t VALUES ", "", "insert_stmt");
    case "returning":
      return wrap("DELETE FROM t RETURNING ", "", "delete_stmt");
    default:
      return null;
  }
}

/** Chains matched by position: the i-th new chain keeps the i-th old
 *  chain's id, marker and collapsed state, and its cards too when its text
 *  is unchanged. New ones get markers not in `taken`. */
function keepByPosition(
  fresh: SubChain[],
  old: SubChain[],
  taken: Set<number>,
): Map<number, SubChain> {
  const out = new Map<number, SubChain>();
  let next = Math.max(0, ...taken, ...old.map((o) => o.marker)) + 1;
  fresh.forEach((ch, i) => {
    const prev = old[i];
    if (!prev) {
      out.set(ch.marker, { ...ch, marker: next++ });
      return;
    }
    const same = cardsText(prev.clauses) === cardsText(ch.clauses);
    const clauses = same
      ? prev.clauses
      : ch.clauses.map((c, k) =>
          prev.clauses[k]?.kind === c.kind
            ? { ...c, id: prev.clauses[k].id }
            : c,
        );
    out.set(ch.marker, { ...prev, clauses });
  });
  return out;
}

/** A card after its SQL view text is committed: each subquery in the text
 *  becomes a chain again, keeping chain ids by position. Null when the
 *  text doesn't parse, so it is kept as typed. `taken` holds the markers
 *  other cards in its list use. */
export function rebuildCard(
  c: Clause,
  typed: string,
  dialect: Dialect,
  taken: Set<number>,
): Clause | null {
  const old = c.chains ?? [];
  const sameIds = (fresh: SubChain) =>
    keepByPosition([fresh], old, taken).values().next().value!;
  if (c.kind === "cte") {
    const stmt = parseOne(`WITH ${typed} SELECT 1`, dialect);
    if (!stmt || "error" in stmt) return null;
    const ctx: Ctx = { sql: `WITH ${typed} SELECT 1`, subs: subqueries(stmt) };
    try {
      const w = (stmt.clauses as Node[]).find((x) => x.type === "with_clause");
      const [cte, more] = w ? cteCards(ctx, { next: 1 }, w) : [];
      if (!cte || more) return null;
      const rec =
        /^\s*recursive\b/i.test(typed) && !/^\s*recursive\b/i.test(cte.body);
      return {
        ...c,
        body: rec ? `RECURSIVE ${cte.body}` : cte.body,
        chains: [sameIds(cte.chains![0])],
      };
    } catch (e) {
      if (e instanceof Refusal) return null;
      throw e;
    }
  }
  if (c.kind === "compound") {
    const sql = `SELECT 1 ${typed}`;
    const stmt = parseOne(sql, dialect);
    if (!stmt || "error" in stmt || stmt.type !== "compound_select_stmt")
      return null;
    if ((stmt.left as Node).type !== "select_stmt") return null;
    const op = readSetOp(keyword(stmt.operator));
    if (!op) return null;
    try {
      const ctx: Ctx = { sql, subs: subqueries(stmt) };
      const side = readQuery(ctx, stmt.right as Node, "side");
      const fresh: SubChain = {
        id: crypto.randomUUID(),
        marker: 1,
        name: null,
        clauses: side,
        collapsed: false,
      };
      return { ...c, body: op, chains: [sameIds(fresh)] };
    } catch (e) {
      if (e instanceof Refusal) return null;
      throw e;
    }
  }
  const w = wrapFor(c.kind, typed);
  if (!w) return { ...c, body: typed };
  const stmt = parseOne(w.sql, dialect);
  if (!stmt || "error" in stmt || stmt.type !== w.type) return null;
  const ctx: Ctx = { sql: w.sql, subs: subqueries(stmt) };
  try {
    let body: string;
    let chains: SubChain[];
    if (c.kind === "values" && isQuerySource(typed)) {
      const src = (stmt.clauses as Node[]).find(isSelect);
      if (!src) return null;
      const chain = chainFrom(ctx, src, 1);
      body = markerName(1);
      chains = [chain];
    } else {
      ({ body, chains } = lift(ctx, { next: 1 }, w.at, w.at + typed.length));
    }
    const kept = keepByPosition(chains, old, taken);
    body = body.replace(/__dh_sub_(\d+)\b/g, (m, n: string) => {
      const k = kept.get(Number(n));
      return k ? markerName(k.marker) : m;
    });
    const out = { ...c, body };
    if (kept.size === 0) {
      delete out.chains;
      return out;
    }
    return { ...out, chains: [...kept.values()] };
  } catch (e) {
    if (e instanceof Refusal) return null;
    throw e;
  }
}

/** Most statements one open or paste takes. */
export const MAX_STATEMENTS = 200;

const NAME_LINE = /^--\s*name:\s*(.*?)\s*$/i;

/** Each statement in `sql`, split as the editor splits it, with the name
 *  from a `-- name: <text>` line directly above it. Other comments between
 *  statements are dropped; comments inside a statement stay. */
export function splitStatements(
  sql: string,
): { text: string; name: string | null }[] {
  const out: { text: string; name: string | null }[] = [];
  for (const r of statementRanges(sql)) {
    const piece = sql.slice(r.start, r.end);
    let i = 0;
    let name: string | null = null;
    // Leading comments: the last line comment ending right above the
    // statement may name it.
    for (;;) {
      const gap = /^\s*/.exec(piece.slice(i))![0];
      if (name !== null && gap.split("\n").length > 2) name = null;
      i += gap.length;
      if (piece.startsWith("--", i)) {
        const end = piece.indexOf("\n", i);
        const line = piece.slice(i, end < 0 ? piece.length : end);
        name = NAME_LINE.exec(line)?.[1] || null;
        i += line.length;
      } else if (piece.startsWith("/*", i)) {
        const end = piece.indexOf("*/", i + 2);
        i = end < 0 ? piece.length : end + 2;
        name = null;
      } else break;
    }
    const text = piece.slice(i).trimEnd();
    if (text) out.push({ text, name });
  }
  return out;
}

/** Every statement in `sql` as a query: a SELECT, UPDATE, DELETE or INSERT
 *  the cards hold becomes cards, anything else a statement query kept as
 *  written. */
export function parseStatements(sql: string, dialect: Dialect): BuilderQuery[] {
  return splitStatements(sql).map(({ text, name }) => {
    const r = parseBack(text, dialect);
    if (!r.ok) return statementQuery(text, name);
    return { id: crypto.randomUUID(), kind: r.kind, name, clauses: r.clauses };
  });
}

/** What a statement card says about its text: whether it now fits the
 *  cards, or why not. */
export function statementNote(
  text: string,
  dialect: Dialect,
): { fits: boolean; note: string | null; error: string | null } {
  const r = parseBack(text, dialect);
  if (r.ok) return { fits: true, note: null, error: null };
  return { fits: false, note: r.note, error: r.error };
}
