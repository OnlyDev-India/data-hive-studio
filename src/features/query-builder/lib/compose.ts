import { findBindVariables } from "@/shared/lib/bind-variables";
import type { Clause } from "@/shared/store";
import { Builder, parseError, qualified, type Built } from "./built";
import { composeWrite } from "./compose-write";
import { parseInsert, parseTarget } from "./forms/writes";
import { isMarker, markersIn, replaceMarkers } from "./markers";
import {
  CLAUSE_LABEL,
  isEmpty,
  isWrite,
  kindOf,
  orderErrors,
  runOrder,
  SKIPPABLE,
} from "./model";
import {
  isDistinct,
  joinText,
  parseJoin,
  parseLimit,
  parseTableRef,
  readCte,
  readSetOp,
  refName,
  tableText,
  unquote,
  type Dialect,
  type TableRef,
} from "./sql-text";

/** How many rows a card's preview brings back for the bottom panel. */
export const PREVIEW_SHOW = 20;
/** The column every preview target adds for its count; Rust strips it. */
export const COUNT_COLUMN = "__dh_count";

export interface PreviewTarget {
  clause_id: string;
  sql: string;
  /** The LIMIT card's count is the window count after its offset and
   *  limit; other cards show the count as it comes. */
  limit?: { limit: number; offset: number };
}

export interface Composed {
  /** The whole query for Run, bare table names; null while any card fails. */
  sql: string | null;
  /** The same for Copy and Open in SQL editor: on Postgres every bare table
   *  is schema qualified. Unformatted. */
  output: string | null;
  /** One per card that is not skipped, in run order up to the first
   *  failing card, chain cards included. The SELECT card's is the whole
   *  query's, there only when every card composes. */
  targets: PreviewTarget[];
  /** Counts the FROM table up to `cap + 1`. */
  probe: string | null;
  /** The FROM table as written, for the activity entry. */
  table: string | null;
  /** A card's own error: its text, its place, or a parse error in it. */
  errors: Map<string, string>;
  /** Empty optional cards, left out. */
  skipped: Set<string>;
  /** Cards holding a bind variable: no preview until Run asks for it. */
  binds: Set<string>;
}

/** Plain is for Run (bare names), output for Copy and Open (schema
 *  qualified on Postgres), capped for previews (each FROM reads its first
 *  `cap` rows). */
export type Mode = "plain" | "output" | "capped";
export type Texts = Record<Mode, string>;

/** What every list in one query composes against. */
export interface Env {
  dialect: Dialect;
  schema: string | null;
  cap: number;
  /** Chains that read the outer row: checked, never previewed. */
  outer: ReadonlySet<string>;
  out: Composed;
  /** CTE names in scope, lower case and unquoted: never qualified. */
  ctes: Set<string>;
}

/** One CTE as the WITH list writes it. */
interface Cte {
  id: string;
  /** Its name, lower case and unquoted. */
  key: string;
  recursive: boolean;
  text: Texts;
}

const MODES: Mode[] = ["plain", "output", "capped"];

function emptyComposed(): Composed {
  return {
    sql: null,
    output: null,
    targets: [],
    probe: null,
    table: null,
    errors: new Map(),
    skipped: new Set(),
    binds: new Set(),
  };
}

/** A table as the mode writes it: qualified in output, except a CTE or a
 *  subquery's marker. */
export function tableIn(env: Env, t: TableRef, mode: Mode): TableRef {
  if (mode !== "output" || isMarker(t.name)) return t;
  if (!t.schema && env.ctes.has(unquote(t.name).toLowerCase())) return t;
  return qualified(t, env.schema, env.dialect);
}

/** Why a card's markers and chains don't match, if they don't. */
function markerError(c: Clause): string | null {
  const chains = c.chains ?? [];
  const markers = markersIn(c.body).map((m) => m.n);
  if (c.kind === "cte" || c.kind === "compound") {
    if (chains.length !== 1) return "This card has lost its subquery";
    if (markers.length > 0) return "This card can't hold a subquery marker";
    return null;
  }
  if (new Set(markers).size !== markers.length)
    return "A subquery marker is here twice";
  const have = new Set(chains.map((ch) => ch.marker));
  if (markers.some((n) => !have.has(n)))
    return "A subquery marker has no subquery";
  if (chains.some((ch) => !markers.includes(ch.marker)))
    return "A subquery is missing from this card's text";
  return null;
}

/** Each chain of `c` composed, by marker; null when any fails, which then
 *  fails `c` too. `prefix` is the WITH list chain previews start with. */
export function composeChains(
  c: Clause,
  env: Env,
  prefix: Cte[],
  preview: boolean,
): Map<number, Texts> | null {
  const bad = markerError(c);
  if (bad) {
    env.out.errors.set(c.id, bad);
    return null;
  }
  const out = new Map<number, Texts>();
  let ok = true;
  for (const ch of c.chains ?? []) {
    const self_reading = c.kind === "cte" && !!readCte(c.body)?.recursive;
    const r = composeList(ch.clauses, env, {
      prefix,
      preview: preview && !env.outer.has(ch.id) && !self_reading,
      side: c.kind === "compound",
    });
    if (r) out.set(ch.marker, r.text);
    else ok = false;
  }
  if (!ok) {
    env.out.errors.set(c.id, "Fix the subquery first");
    return null;
  }
  return out;
}

/** `c`'s body in `mode`, each marker written out as its chain: in
 *  parentheses, or bare for a VALUES source. */
export function expand(
  c: Clause,
  chains: Map<number, Texts>,
  mode: Mode,
): string {
  const bare = c.kind === "values" && /^\s*__dh_sub_\d+\s*$/.test(c.body);
  return replaceMarkers(c.body.trim(), (n) => {
    const t = chains.get(n)?.[mode] ?? "";
    return bare ? t : `(${t})`;
  });
}

interface Part {
  clause: Clause;
  text: Texts;
}

interface Parts {
  from: Part;
  joins: Part[];
  where: Part | null;
  group: Part | null;
  having: Part | null;
  select: Part | null;
  compounds: Part[];
  order: Part | null;
  limit: { clause: Clause; limit: number; offset: number } | null;
}

/** The select list a card's query uses: the SELECT card's, else the group
 *  keys and aggregates, else every column. */
function selectList(p: Parts, mode: Mode): { text: string; id?: string } {
  if (p.select) return { text: p.select.text[mode], id: p.select.clause.id };
  if (p.group) {
    const items = [p.group.text[mode], p.group.clause.aggregates?.trim() ?? ""]
      .filter(Boolean)
      .join(", ");
    return { text: items, id: p.group.clause.id };
  }
  return { text: "*" };
}

/** The WITH list in `mode`, each CTE's piece marked with its card. */
function addWith(b: Builder, ctes: Cte[], mode: Mode) {
  if (ctes.length === 0) return;
  b.add(ctes.some((c) => c.recursive) ? "WITH RECURSIVE " : "WITH ");
  ctes.forEach((c, i) => {
    if (i > 0) b.add(", ");
    b.add(c.text[mode], c.id);
  });
  b.add(" ");
}

/** One SELECT from parts, into `b`. `count` adds the window count; `limit`
 *  overrides the LIMIT part. */
function build(
  b: Builder,
  p: Parts,
  mode: Mode,
  opts: { count: boolean; limit: string | null },
) {
  const list = selectList(p, mode);
  b.add("SELECT ");
  b.add(list.text, list.id);
  if (opts.count) b.add(`, COUNT(*) OVER () AS ${COUNT_COLUMN}`);
  b.add(" FROM ");
  b.add(p.from.text[mode], p.from.clause.id);
  for (const j of p.joins) {
    b.add(" ");
    b.add(j.text[mode], j.clause.id);
  }
  if (p.where) {
    b.add(" WHERE ");
    b.add(p.where.text[mode], p.where.clause.id);
  }
  if (p.group?.text[mode]) {
    b.add(" GROUP BY ");
    b.add(p.group.text[mode], p.group.clause.id);
  }
  if (p.having) {
    b.add(" HAVING ");
    b.add(p.having.text[mode], p.having.clause.id);
  }
  for (const s of p.compounds) {
    b.add(" ");
    b.add(s.text[mode], s.clause.id);
  }
  if (p.order) {
    b.add(" ORDER BY ");
    b.add(p.order.text[mode], p.order.clause.id);
  }
  if (opts.limit !== null) {
    b.add(" LIMIT ");
    b.add(opts.limit, p.limit?.clause.id);
  }
}

/** Wrap a query so its preview counts the rows it returns and shows the
 *  first ones: for DISTINCT, set operations and a CTE's rows. */
function wrapped(ctes: Cte[], inner: (b: Builder) => void): Built {
  const b = new Builder();
  addWith(b, ctes, "capped");
  b.add(`SELECT q.*, COUNT(*) OVER () AS ${COUNT_COLUMN} FROM (`);
  inner(b);
  b.add(`) AS q LIMIT ${PREVIEW_SHOW}`);
  return b.done();
}

interface ListResult {
  text: Texts;
  /** The first plain FROM table, for the probe and the activity entry. */
  table: TableRef | null;
}

/** Compose one SELECT card list: a query or a chain. Its cards' errors,
 *  skips, binds and (when `preview`) targets go into `env.out`; its text
 *  comes back, or null when any of its cards fails. `prefix` is the WITH
 *  list its previews start with; `side` is a set operation's right side. */
export function composeList(
  clauses: Clause[],
  env: Env,
  opts: { prefix: Cte[]; preview: boolean; side?: boolean },
): ListResult | null {
  const { errors, skipped, binds } = env.out;
  for (const [id, m] of orderErrors(clauses)) errors.set(id, m);
  const failed = () => clauses.some((c) => errors.has(c.id));

  // Read each card's text in run order; the first card that fails stops
  // the walk. Chains compose as their card is reached, after the CTEs, so
  // they see every CTE name.
  const readable: Clause[] = [];
  const texts = new Map<string, Texts>();
  const ctes: Cte[] = [];
  let from: { clause: Clause; table: TableRef } | null = null;
  let first_table: TableRef | null = null;
  for (const c of runOrder(clauses)) {
    if (errors.has(c.id)) break;
    if (c.kind === "select" && isEmpty(c)) {
      texts.set(c.id, { plain: "", output: "", capped: "" });
      readable.push(c);
      continue;
    }
    if (isEmpty(c) && c.kind !== "compound") {
      if (SKIPPABLE.has(c.kind)) {
        skipped.add(c.id);
        continue;
      }
      errors.set(
        c.id,
        c.kind === "from"
          ? "Pick a table to start from"
          : c.kind === "join"
            ? "Pick a table to join"
            : c.kind === "cte"
              ? "Name the CTE"
              : `${CLAUSE_LABEL[c.kind]} needs a key column or an aggregate`,
      );
      break;
    }
    if (c.kind === "cte") {
      const cte = readCte(c.body);
      if (!cte) {
        errors.set(
          c.id,
          "A CTE takes a name, RECURSIVE first if it reads itself",
        );
        break;
      }
      const key = unquote(cte.name).toLowerCase();
      if (ctes.some((x) => x.key === key)) {
        errors.set(c.id, `Two CTEs are named ${cte.name}`);
        break;
      }
      env.ctes.add(key);
    }
    if (c.kind === "compound" && !readSetOp(c.body)) {
      errors.set(c.id, "Pick UNION, UNION ALL, INTERSECT or EXCEPT");
      break;
    }
    if (c.kind === "from") {
      const table = parseTableRef(c.body);
      if (!table) {
        errors.set(c.id, "FROM takes one table or subquery, with an alias");
        break;
      }
      if (isMarker(table.name) && !table.alias) {
        errors.set(c.id, "A subquery in FROM needs an alias");
        break;
      }
      from = { clause: c, table };
    }
    if (c.kind === "join") {
      const j = parseJoin(c.body);
      if (!j) {
        errors.set(
          c.id,
          "JOIN takes the join type, one table or subquery with an optional alias, and ON or USING",
        );
        break;
      }
      if (isMarker(j.table.name) && !j.table.alias) {
        errors.set(c.id, "A subquery in a JOIN needs an alias");
        break;
      }
    }
    if (c.kind === "limit" && !parseLimit(c.body)) {
      errors.set(c.id, "LIMIT takes a row count and an optional OFFSET");
      break;
    }
    const prefix = [...opts.prefix, ...ctes];
    const chains = composeChains(c, env, prefix, opts.preview);
    if (!chains) break;
    const text = cardTexts(c, chains, env);
    texts.set(c.id, text);
    if (c.kind === "cte") {
      const cte = readCte(c.body)!;
      ctes.push({
        id: c.id,
        key: unquote(cte.name).toLowerCase(),
        recursive: cte.recursive,
        text,
      });
    }
    if (c.kind === "from" && from) {
      if (isMarker(from.table.name)) {
        const inner = c.chains?.[0];
        first_table = (inner && firstTable(inner.clauses)) ?? null;
      } else if (!env.ctes.has(unquote(from.table.name).toLowerCase()))
        first_table = from.table;
    }
    readable.push(c);
  }
  if (!from || failed()) return null;

  const parts: Parts = {
    from: { clause: from.clause, text: texts.get(from.clause.id)! },
    joins: [],
    where: null,
    group: null,
    having: null,
    select: null,
    compounds: [],
    order: null,
    limit: null,
  };

  const targets: PreviewTarget[] = [];
  let select: Clause | null = null;
  let last: PreviewTarget | null = null;
  // A card holding a bind variable previews nothing, and nor does any card
  // after it; their text is still checked.
  let held = false;
  let done_ctes: Cte[] = [];
  for (const c of readable) {
    const text = texts.get(c.id)!;
    if (findBindVariables([text.plain, c.aggregates ?? ""]).length > 0) {
      binds.add(c.id);
      held = true;
    }
    if (c.kind === "cte") {
      done_ctes = [...done_ctes, ctes.find((x) => x.id === c.id)!];
      const name = readCte(c.body)!.name;
      const built = wrapped([...opts.prefix, ...done_ctes], (b) =>
        b.add(`SELECT * FROM ${name}`),
      );
      const bad = parseError(built, env.dialect, c.id);
      if (bad) {
        errors.set(bad.id, bad.message);
        break;
      }
      if (!held) targets.push({ clause_id: c.id, sql: built.text });
      continue;
    }
    const part = { clause: c, text };
    if (c.kind === "select") {
      select = c;
      if (!isEmpty(c)) parts.select = part;
    } else if (c.kind === "join") parts.joins.push(part);
    else if (c.kind === "compound") parts.compounds.push(part);
    else if (c.kind === "limit") {
      const l = parseLimit(c.body)!;
      parts.limit = { clause: c, ...l };
    } else if (
      c.kind === "where" ||
      c.kind === "group" ||
      c.kind === "having" ||
      c.kind === "order"
    )
      parts[c.kind] = part;

    const prefix = [...opts.prefix, ...ctes];
    const wrap =
      (!!parts.select && isDistinct(parts.select.clause.body)) ||
      parts.compounds.length > 0;
    let built: Built;
    let target: PreviewTarget;
    if (wrap) {
      built = wrapped(prefix, (b) =>
        build(b, parts, "capped", {
          count: false,
          limit: parts.limit ? limitText(parts.limit) : null,
        }),
      );
      target = { clause_id: c.id, sql: built.text };
    } else {
      const shown = parts.limit
        ? `${Math.min(parts.limit.limit, PREVIEW_SHOW)}${parts.limit.offset ? ` OFFSET ${parts.limit.offset}` : ""}`
        : String(PREVIEW_SHOW);
      const b = new Builder();
      addWith(b, prefix, "capped");
      build(b, parts, "capped", { count: true, limit: shown });
      built = b.done();
      target = {
        clause_id: c.id,
        sql: built.text,
        ...(parts.limit && c.kind === "limit"
          ? { limit: { limit: parts.limit.limit, offset: parts.limit.offset } }
          : {}),
      };
    }
    const bad = parseError(built, env.dialect, c.id);
    if (bad) {
      errors.set(bad.id, bad.message);
      // A parse error in an earlier card's text drops that card's target.
      const at = targets.findIndex((t) => t.clause_id === bad.id);
      if (at >= 0) targets.splice(at);
      break;
    }
    last = target;
    if (c.kind !== "select" && !held) targets.push(target);
  }

  if (opts.preview) env.out.targets.push(...targets);
  if (failed()) return null;
  if (select && last && !held && opts.preview)
    env.out.targets.push({ ...last, clause_id: select.id });

  const limit = parts.limit ? limitText(parts.limit) : null;
  const whole = (mode: Mode) => {
    const b = new Builder();
    addWith(b, ctes, mode);
    build(b, parts, mode, { count: false, limit });
    return b.text;
  };
  if (opts.side && (parts.order || parts.limit)) {
    errors.set(
      (parts.order ?? parts.limit)!.clause.id,
      "The right side of a set operation takes no ORDER BY or LIMIT",
    );
    return null;
  }
  return {
    text: {
      plain: whole("plain"),
      output: whole("output"),
      capped: whole("capped"),
    },
    table: first_table,
  };
}

/** The first plain table a card list reads, through derived tables. */
function firstTable(clauses: Clause[]): TableRef | null {
  const from = clauses.find((c) => c.kind === "from");
  const t = from && parseTableRef(from.body);
  if (!t) return null;
  if (!isMarker(t.name)) return t;
  const inner = from.chains?.[0];
  return inner ? firstTable(inner.clauses) : null;
}

/** A card's text in each mode: subqueries written out; FROM capped for
 *  previews, tables qualified for output. */
function cardTexts(c: Clause, chains: Map<number, Texts>, env: Env): Texts {
  const out = {} as Texts;
  for (const mode of MODES) {
    switch (c.kind) {
      case "from": {
        const t = parseTableRef(c.body)!;
        if (isMarker(t.name)) {
          out[mode] =
            `${expand({ ...c, body: t.name }, chains, mode)} AS ${t.alias}`;
        } else if (mode === "capped") {
          out[mode] =
            `(SELECT * FROM ${tableText({ ...t, alias: null })} LIMIT ${env.cap}) AS ${refName(t)}`;
        } else out[mode] = tableText(tableIn(env, t, mode));
        break;
      }
      case "join": {
        const j = parseJoin(c.body)!;
        const body = joinText({ ...j, table: tableIn(env, j.table, mode) });
        out[mode] = expand({ ...c, body }, chains, mode);
        break;
      }
      case "cte": {
        const cte = readCte(c.body)!;
        const head = cte.columns ? `${cte.name} ${cte.columns}` : cte.name;
        out[mode] =
          `${head} AS (${chains.values().next().value?.[mode] ?? ""})`;
        break;
      }
      case "compound":
        out[mode] =
          `${readSetOp(c.body)} ${chains.values().next().value?.[mode] ?? ""}`;
        break;
      default:
        out[mode] = expand(c, chains, mode);
    }
  }
  return out;
}

/** Compose the cards into the query, each card's preview query (chain
 *  cards' too), and the probe. Pure: no connection. `outer` names the
 *  chains that read the outer row, which never preview. */
export function compose({
  clauses,
  dialect,
  schema,
  cap,
  outer = new Set(),
}: {
  clauses: Clause[];
  dialect: Dialect;
  /** The tab's default schema (Postgres), for the qualified output. */
  schema: string | null;
  cap: number;
  outer?: ReadonlySet<string>;
}): Composed {
  const kind = kindOf(clauses);
  if (kind === "statement") return composeStatement(clauses);
  const out = emptyComposed();
  const env: Env = { dialect, schema, cap, outer, out, ctes: new Set() };
  if (isWrite(kind)) {
    composeWrite(clauses, env);
    return out;
  }
  const r = composeList(clauses, env, { prefix: [], preview: true });
  const from = clauses.find((c) => c.kind === "from");
  const t = from && parseTableRef(from.body);
  const named = t && !isMarker(t.name) ? t : firstTable(clauses);
  if (named) out.table = tableText({ ...named, alias: null });
  if (r?.table) {
    const name = tableText({ ...r.table, alias: null });
    out.probe = `SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${name} LIMIT ${cap + 1}) AS p`;
  }
  if (!r || out.errors.size > 0) return out;
  out.sql = r.text.plain;
  out.output = r.text.output;
  return out;
}

/** A statement query's one card: sent as written, never previewed. */
function composeStatement(clauses: Clause[]): Composed {
  const card = clauses[0];
  const text = card.body.trim().replace(/;\s*$/, "");
  const out = emptyComposed();
  if (clauses.length !== 1)
    out.errors.set(card.id, "A statement query holds one card");
  else if (!text) out.errors.set(card.id, "Write a statement");
  if (out.errors.size === 0) {
    out.sql = text;
    out.output = text;
  }
  return out;
}

function limitText(l: { limit: number; offset: number }) {
  return l.offset ? `${l.limit} OFFSET ${l.offset}` : String(l.limit);
}

/** The count a card shows: the LIMIT card's is cut by its offset and limit. */
export function shownCount(count: number, target?: PreviewTarget): number {
  if (!target?.limit) return count;
  const { limit, offset } = target.limit;
  return Math.min(Math.max(count - offset, 0), limit);
}

/** The table a card names: FROM, JOIN, USING, and the UPDATE, DELETE and
 *  INSERT targets. */
export function cardTable(c: Clause, dialect: Dialect): TableRef | null {
  switch (c.kind) {
    case "from":
    case "using":
      return parseTableRef(c.body);
    case "join":
      return parseJoin(c.body)?.table ?? null;
    case "update":
    case "delete":
      return parseTarget(c.body);
    case "insert":
      return parseInsert(c.body, dialect)?.table ?? null;
    default:
      return null;
  }
}

/** Every catalog table the cards read or write, as the catalog names
 *  them: never a subquery's marker or a CTE's name. */
export function queryTables(clauses: Clause[], dialect: Dialect): TableRef[] {
  const ctes = new Set(
    clauses.flatMap((c) => {
      const cte = c.kind === "cte" ? readCte(c.body) : null;
      return cte ? [unquote(cte.name).toLowerCase()] : [];
    }),
  );
  return clauses
    .flatMap((c) => cardTable(c, dialect) ?? [])
    .filter(
      (t) =>
        !isMarker(t.name) &&
        !(!t.schema && ctes.has(unquote(t.name).toLowerCase())),
    );
}
