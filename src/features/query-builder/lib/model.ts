import type {
  BuilderQuery,
  BuilderQueryKind,
  Clause,
  ClauseKind,
  SubChain,
} from "@/shared/store";
import { maskStringsAndComments } from "@/shared/lib/utils";
import type { Dialect } from "./sql-text";

/** The order cards sit in per query kind, as SQL is written. JOIN, CTE
 *  and set operation cards may repeat; every other kind appears at most
 *  once. */
export const CARD_ORDER: Record<BuilderQueryKind, ClauseKind[]> = {
  select: [
    "cte",
    "select",
    "from",
    "join",
    "where",
    "group",
    "having",
    "compound",
    "order",
    "limit",
  ],
  update: ["update", "set", "from", "join", "where", "returning"],
  delete: ["delete", "using", "where", "returning"],
  insert: ["insert", "values", "conflict", "returning"],
  statement: ["statement"],
};

/** The order the database runs a SELECT's clauses in, which previews
 *  follow. */
export const RUN_ORDER: ClauseKind[] = [
  "cte",
  "from",
  "join",
  "where",
  "group",
  "having",
  "select",
  "compound",
  "order",
  "limit",
];

/** Kinds that may repeat, and drag to reorder among their own kind. */
export const REPEATS: ReadonlySet<ClauseKind> = new Set([
  "join",
  "cte",
  "compound",
]);

export const CLAUSE_LABEL: Record<ClauseKind, string> = {
  from: "FROM",
  join: "JOIN",
  where: "WHERE",
  group: "GROUP BY",
  having: "HAVING",
  select: "SELECT",
  order: "ORDER BY",
  limit: "LIMIT",
  update: "UPDATE",
  set: "SET",
  delete: "DELETE",
  using: "USING",
  insert: "INSERT",
  values: "VALUES",
  conflict: "ON CONFLICT",
  returning: "RETURNING",
  statement: "SQL",
  cte: "WITH",
  compound: "UNION",
};

/** Kinds each query holds, which can't be added or deleted. */
const FIXED: Record<BuilderQueryKind, ReadonlySet<ClauseKind>> = {
  select: new Set(["select", "from"]),
  update: new Set(["update", "set"]),
  delete: new Set(["delete"]),
  insert: new Set(["insert", "values"]),
  statement: new Set(["statement"]),
};

/** Kinds an empty card is skipped for, rather than an error. An empty
 *  SELECT is never skipped: it means `*`, or the group outputs. */
export const SKIPPABLE: ReadonlySet<ClauseKind> = new Set([
  "where",
  "having",
  "order",
  "limit",
  "using",
  "conflict",
  "returning",
]);

/** A query's kind, read from its cards: write queries start with their
 *  own head card, and a statement query holds one statement card. */
export function kindOf(clauses: Clause[]): BuilderQueryKind {
  if (clauses.some((c) => c.kind === "statement")) return "statement";
  const head = clauses[0]?.kind;
  return head === "update" || head === "delete" || head === "insert"
    ? head
    : "select";
}

export const isWrite = (kind: BuilderQueryKind) =>
  kind === "update" || kind === "delete" || kind === "insert";

const rankIn = (order: ClauseKind[]) => (k: ClauseKind) => order.indexOf(k);

export function newClause(kind: ClauseKind, body = ""): Clause {
  return {
    id: crypto.randomUUID(),
    kind,
    body,
    aggregates: kind === "group" ? "" : null,
    view: "form",
  };
}

export function findClause(clauses: Clause[], id: string | null) {
  return (id && clauses.find((c) => c.id === id)) || null;
}

/** Whether a card has nothing in it, so it is skipped (or, for FROM and
 *  JOIN, an error). */
export function isEmpty(c: Clause): boolean {
  return !c.body.trim() && !c.aggregates?.trim();
}

/** What a card list is: a query, a subquery chain, or the right side of a
 *  set operation. A chain holds no CTE; a set operation's side holds no
 *  set operation, ORDER BY or LIMIT. */
export type ListRole = "query" | "chain" | "side";

const NOT_IN: Record<ListRole, ReadonlySet<ClauseKind>> = {
  query: new Set(),
  chain: new Set(["cte"]),
  side: new Set(["cte", "compound", "order", "limit"]),
};

/** Whether a `kind` card may be added to `clauses` at all, wherever it
 *  goes: not fixed, not there yet unless it repeats, and its needs met. */
function addable(
  clauses: Clause[],
  k: ClauseKind,
  dialect: Dialect,
  role: ListRole,
): boolean {
  const kind = kindOf(clauses);
  const present = new Set(clauses.map((c) => c.kind));
  if (FIXED[kind].has(k) || NOT_IN[role].has(k)) return false;
  if (!REPEATS.has(k) && present.has(k)) return false;
  if (k === "having" && !present.has("group")) return false;
  if (k === "join" && !present.has("from")) return false;
  if (k === "using" && dialect === "sqlite") return false;
  return true;
}

/** The kinds a card added at `index` may be: only the ones that fit
 *  between its neighbours and are not there yet; HAVING only after a
 *  GROUP BY, JOIN only after a FROM, USING never on SQLite. Fixed cards are
 *  never offered, they are always there. */
export function slotKinds(
  clauses: Clause[],
  index: number,
  dialect: Dialect = "postgresql",
  role: ListRole = "query",
): ClauseKind[] {
  const prev = clauses[index - 1];
  const next = clauses[index];
  const kind = kindOf(clauses);
  if (!prev || kind === "statement") return [];
  const rank = rankIn(CARD_ORDER[kind]);
  return CARD_ORDER[kind].filter((k) => {
    if (!addable(clauses, k, dialect, role)) return false;
    if (rank(k) < rank(prev.kind)) return false;
    if (!REPEATS.has(k) && rank(k) === rank(prev.kind)) return false;
    if (next && rank(k) > rank(next.kind)) return false;
    if (next && !REPEATS.has(k) && rank(k) === rank(next.kind)) return false;
    return true;
  });
}

/** Every kind the add button under a list offers: each one that can be
 *  added anywhere, put at its own slot. */
export function endKinds(
  clauses: Clause[],
  dialect: Dialect = "postgresql",
  role: ListRole = "query",
): ClauseKind[] {
  const kind = kindOf(clauses);
  if (kind === "statement") return [];
  return CARD_ORDER[kind].filter((k) => addable(clauses, k, dialect, role));
}

/** Where a new card of `kind` goes so the order holds: after the last card
 *  that comes before it. */
export function slotFor(clauses: Clause[], kind: ClauseKind): number {
  const rank = rankIn(CARD_ORDER[kindOf(clauses)]);
  let at = 0;
  clauses.forEach((c, i) => {
    if (rank(c.kind) <= rank(kind)) at = i + 1;
  });
  return at;
}

export function insertClause(
  clauses: Clause[],
  index: number,
  clause: Clause,
): Clause[] {
  return [...clauses.slice(0, index), clause, ...clauses.slice(index)];
}

/** Whether card `c` of `clauses` can be deleted. */
export const canRemove = (clauses: Clause[], c: Clause) =>
  !FIXED[kindOf(clauses)].has(c.kind);

/** Remove a card; the fixed cards stay, a GROUP BY takes its HAVING with
 *  it, and an UPDATE's FROM takes its JOINs. */
export function removeClause(clauses: Clause[], id: string): Clause[] {
  const gone = findClause(clauses, id);
  if (!gone || !canRemove(clauses, gone)) return clauses;
  return clauses.filter(
    (c) =>
      c.id !== id &&
      !(gone.kind === "group" && c.kind === "having") &&
      !(gone.kind === "from" && c.kind === "join"),
  );
}

export function patchClause(
  clauses: Clause[],
  id: string,
  patch: Partial<Omit<Clause, "id" | "kind">>,
): Clause[] {
  return clauses.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

/** Move JOIN, CTE or set operation card `id` to `slot` among the cards of
 *  its kind. Nothing else moves. */
export function moveJoin(
  clauses: Clause[],
  id: string,
  slot: number,
): Clause[] {
  const card = findClause(clauses, id);
  if (!card || !REPEATS.has(card.kind)) return clauses;
  const kind = card.kind;
  const same = clauses.filter((c) => c.kind === kind && c.id !== id);
  const at = Math.max(0, Math.min(slot, same.length));
  same.splice(at, 0, card);
  const first = clauses.findIndex((c) => c.kind === kind);
  const rest = clauses.filter((c) => c.kind !== kind);
  return [...rest.slice(0, first), ...same, ...rest.slice(first)];
}

/** A card's text and its chains' text, all the way down; what a preview
 *  depends on. */
function textKey(c: Clause): string {
  const chains = (c.chains ?? []).map(
    (ch) => `${ch.id}:${ch.marker}[${ch.clauses.map(textKey).join("|")}]`,
  );
  return `${c.kind}\u0000${c.body}\u0000${c.aggregates ?? ""}\u0000${chains.join(",")}`;
}

const sameText = (a: Clause, b: Clause) =>
  a.id === b.id && textKey(a) === textKey(b);

/** The cards in the order the database runs them; a write or statement
 *  query's as written. */
export function runOrder(clauses: Clause[]): Clause[] {
  if (kindOf(clauses) !== "select") return clauses;
  return RUN_ORDER.flatMap((k) => clauses.filter((c) => c.kind === k));
}

/** The first card, in run order, whose query `next` changes: its id, null
 *  when the change is at the very start, undefined when no card's query
 *  changed (a flip between form and SQL, or the last card removed). */
export function firstChanged(
  prev: Clause[],
  next: Clause[],
): string | null | undefined {
  const a_run = runOrder(prev);
  const b_run = runOrder(next);
  const n = Math.max(a_run.length, b_run.length);
  for (let i = 0; i < n; i++) {
    const a = a_run[i];
    const b = b_run[i];
    if (a && b && sameText(a, b)) continue;
    if (!b) return undefined;
    return i === 0 ? null : b.id;
  }
  return undefined;
}

/** The cards a refresh from `from` (null for all) previews: that card,
 *  every card after it in run order, the SELECT card, which previews the
 *  whole query, and every chain card under any of them. */
export function previewTargets(
  clauses: Clause[],
  from: string | null,
): Set<string> {
  const run = runOrder(clauses);
  const at = from === null ? 0 : run.findIndex((c) => c.id === from);
  const picked = run.slice(Math.max(at, 0));
  const select = clauses.find((c) => c.kind === "select");
  if (select && !picked.includes(select)) picked.push(select);
  return new Set(
    picked.flatMap((c) => [c.id, ...chainCards(c).map((x) => x.id)]),
  );
}

/** "Card 3", how a card is named when it holds others back. */
export const cardName = (index: number) => `card ${index + 1}`;

/** Why a card breaks the order, if it does. Cards restored from an older
 *  snapshot or pasted could. */
export function orderErrors(clauses: Clause[]): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Set<ClauseKind>();
  const rank = rankIn(CARD_ORDER[kindOf(clauses)]);
  let last = -1;
  for (const c of clauses) {
    const r = rank(c.kind);
    if (r < 0)
      out.set(c.id, `${CLAUSE_LABEL[c.kind]} doesn't belong in this query`);
    else if (!REPEATS.has(c.kind) && seen.has(c.kind))
      out.set(c.id, `Only one ${CLAUSE_LABEL[c.kind]}`);
    else if (r < last) out.set(c.id, `${CLAUSE_LABEL[c.kind]} is out of place`);
    else if (c.kind === "having" && !seen.has("group"))
      out.set(c.id, "HAVING needs a GROUP BY before it");
    else if (c.kind === "join" && !seen.has("from"))
      out.set(c.id, "JOIN needs a FROM before it");
    seen.add(c.kind);
    last = Math.max(last, r);
  }
  return out;
}

/** Every card under `c`'s chains, at any depth. */
export function chainCards(c: Clause): Clause[] {
  return (c.chains ?? []).flatMap((ch) => allCards(ch.clauses));
}

/** `clauses` and every card under their chains, at any depth. */
export function allCards(clauses: Clause[]): Clause[] {
  return clauses.flatMap((c) => [c, ...chainCards(c)]);
}

/** Every chain under `clauses`, at any depth, outer ones first. */
export function allChains(clauses: Clause[]): SubChain[] {
  return clauses.flatMap((c) =>
    (c.chains ?? []).flatMap((ch) => [ch, ...allChains(ch.clauses)]),
  );
}

/** The card list holding card `id`: its query's or a chain's. */
export function listOf(clauses: Clause[], id: string): Clause[] | null {
  if (clauses.some((c) => c.id === id)) return clauses;
  for (const c of clauses)
    for (const ch of c.chains ?? []) {
      const found = listOf(ch.clauses, id);
      if (found) return found;
    }
  return null;
}

/** The chain whose cards hold card `id` directly, if any. */
export function chainOf(clauses: Clause[], id: string): SubChain | null {
  for (const c of clauses)
    for (const ch of c.chains ?? []) {
      if (ch.clauses.some((x) => x.id === id)) return ch;
      const found = chainOf(ch.clauses, id);
      if (found) return found;
    }
  return null;
}

/** A chain by id, at any depth. */
export function findChain(clauses: Clause[], id: string): SubChain | null {
  return allChains(clauses).find((ch) => ch.id === id) ?? null;
}

/** The card a chain hangs off, at any depth. */
export function parentOf(clauses: Clause[], chain: string): Clause | null {
  for (const c of clauses) {
    if (c.chains?.some((ch) => ch.id === chain)) return c;
    for (const ch of c.chains ?? []) {
      const found = parentOf(ch.clauses, chain);
      if (found) return found;
    }
  }
  return null;
}

/** `fn` applied to the list `list` names: the cards of chain `list`, or
 *  `clauses` itself when it is the top list (`list` null). */
export function mapList(
  clauses: Clause[],
  list: string | null,
  fn: (clauses: Clause[]) => Clause[],
): Clause[] {
  if (list === null) return fn(clauses);
  return clauses.map((c) => {
    if (!c.chains?.length) return c;
    let hit = false;
    const chains = c.chains.map((ch) => {
      if (ch.id === list) {
        hit = true;
        return { ...ch, clauses: fn(ch.clauses) };
      }
      const inner = mapList(ch.clauses, list, fn);
      if (inner === ch.clauses) return ch;
      hit = true;
      return { ...ch, clauses: inner };
    });
    return hit ? { ...c, chains } : c;
  });
}

/** `fn` applied to the list holding card `id`, at any depth. */
export function mapListOf(
  clauses: Clause[],
  id: string,
  fn: (clauses: Clause[]) => Clause[],
): Clause[] {
  if (clauses.some((c) => c.id === id)) return fn(clauses);
  const chain = chainOf(clauses, id);
  return chain ? mapList(clauses, chain.id, fn) : clauses;
}

/** `fn` applied to chain `id`, at any depth. */
export function mapChain(
  clauses: Clause[],
  id: string,
  fn: (chain: SubChain) => SubChain,
): Clause[] {
  const parent = parentOf(clauses, id);
  if (!parent) return clauses;
  return mapListOf(clauses, parent.id, (list) =>
    list.map((c) =>
      c.id === parent.id
        ? { ...c, chains: c.chains!.map((ch) => (ch.id === id ? fn(ch) : ch)) }
        : c,
    ),
  );
}

/** A card by id, at any depth. */
export function findCard(clauses: Clause[], id: string | null): Clause | null {
  if (!id) return null;
  return allCards(clauses).find((c) => c.id === id) ?? null;
}

/** The query holding card `id`, at any depth. */
export function queryOf(
  queries: BuilderQuery[],
  id: string | null,
): BuilderQuery | null {
  if (!id) return null;
  return (
    queries.find((q) => allCards(q.clauses).some((c) => c.id === id)) ?? null
  );
}

/** The query holding chain `id`, at any depth. */
export function queryOfChain(
  queries: BuilderQuery[],
  id: string,
): BuilderQuery | null {
  return queries.find((q) => findChain(q.clauses, id)) ?? null;
}

export function findQuery(queries: BuilderQuery[], id: string | null) {
  return (id && queries.find((q) => q.id === id)) || null;
}

/** The current query: the last one picked. */
export function currentQuery(s: {
  queries: BuilderQuery[];
  picked_query_ids: string[];
}): BuilderQuery | null {
  return findQuery(s.queries, s.picked_query_ids.at(-1) ?? null);
}

/** `fn` applied to query `id`'s cards. */
export function mapQuery(
  queries: BuilderQuery[],
  id: string,
  fn: (clauses: Clause[]) => Clause[],
): BuilderQuery[] {
  return queries.map((q) =>
    q.id === id ? { ...q, clauses: fn(q.clauses) } : q,
  );
}

/** `clauses` with new card and chain ids throughout. */
export function freshIds(clauses: Clause[]): Clause[] {
  return clauses.map((c) => ({
    ...c,
    id: crypto.randomUUID(),
    ...(c.chains
      ? {
          chains: c.chains.map((ch) => ({
            ...ch,
            id: crypto.randomUUID(),
            clauses: freshIds(ch.clauses),
          })),
        }
      : {}),
  }));
}

/** A copy of `q` with new ids throughout, named after it. */
export function duplicateQuery(q: BuilderQuery): BuilderQuery {
  return {
    ...q,
    id: crypto.randomUUID(),
    name: q.name === null ? null : `${q.name} copy`,
    clauses: freshIds(q.clauses),
  };
}

/** Move query `id` to `slot` in canvas order. */
export function moveQuery(
  queries: BuilderQuery[],
  id: string,
  slot: number,
): BuilderQuery[] {
  const q = findQuery(queries, id);
  if (!q) return queries;
  const rest = queries.filter((x) => x.id !== id);
  const at = Math.max(0, Math.min(slot, rest.length));
  return [...rest.slice(0, at), q, ...rest.slice(at)];
}

/** The picked set after query `id` is deleted from `queries` (as they were
 *  before): the previous remaining query becomes current, or the next when
 *  it was first. */
export function pickedAfterDelete(
  queries: BuilderQuery[],
  picked: string[],
  id: string,
): string[] {
  const rest = picked.filter((p) => p !== id);
  if (picked.at(-1) !== id) return rest;
  const i = queries.findIndex((q) => q.id === id);
  const next = queries[i - 1] ?? queries[i + 1];
  if (!next) return [];
  return [...rest.filter((p) => p !== next.id), next.id];
}

/** The picked set after a header click: a plain click picks only `id`, Cmd
 *  toggles it, Shift picks the range from the current query. The clicked
 *  query is current unless Cmd took it out. */
export function pickQuery(
  queries: BuilderQuery[],
  picked: string[],
  id: string,
  how: "only" | "toggle" | "range",
): string[] {
  if (how === "toggle") {
    if (!picked.includes(id)) return [...picked, id];
    const rest = picked.filter((p) => p !== id);
    return rest.length > 0 ? rest : picked;
  }
  if (how === "range") {
    const ids = queries.map((q) => q.id);
    const from = ids.indexOf(picked.at(-1) ?? id);
    const to = ids.indexOf(id);
    if (from < 0 || to < 0) return [id];
    const range =
      from <= to ? ids.slice(from, to + 1) : ids.slice(to, from + 1).reverse();
    return [...range.filter((r) => r !== id), id];
  }
  return [id];
}

/** A statement query holding `text` as written. */
export function statementQuery(
  text: string,
  name: string | null = null,
): BuilderQuery {
  return {
    id: crypto.randomUUID(),
    kind: "statement",
    name,
    clauses: [newClause("statement", text)],
  };
}

/** A statement's first keyword, upper case ("CREATE"), or "SQL" when it
 *  has none yet. */
export function statementKeyword(text: string): string {
  const masked = maskStringsAndComments(text).replace(/^[\s(]+/, "");
  return masked.match(/^[a-z_]+/i)?.[0].toUpperCase() ?? "SQL";
}

/** The kinds "+ Query" offers; an upsert is an INSERT with an ON
 *  CONFLICT card. */
export type NewQueryKind =
  "select" | "update" | "delete" | "insert" | "upsert" | "statement";

/** A new, empty query of `kind`. An upsert starts with DO NOTHING, which
 *  both engines take with no conflict target. */
export function newQuery(kind: NewQueryKind): BuilderQuery {
  if (kind === "statement") return statementQuery("");
  const query = (k: BuilderQueryKind, kinds: ClauseKind[]): BuilderQuery => ({
    id: crypto.randomUUID(),
    kind: k,
    name: null,
    clauses: kinds.map((x) => newClause(x)),
  });
  switch (kind) {
    case "select":
      return query("select", ["select", "from"]);
    case "update":
      return query("update", ["update", "set"]);
    case "delete":
      return query("delete", ["delete"]);
    case "insert":
      return query("insert", ["insert", "values"]);
    case "upsert": {
      const q = query("insert", ["insert", "values"]);
      return {
        ...q,
        clauses: [...q.clauses, newClause("conflict", "DO NOTHING")],
      };
    }
  }
}

/** The header's kind badge: SELECT, UPDATE, DELETE, INSERT, UPSERT, or a
 *  statement's first keyword. */
export function queryBadge(q: BuilderQuery): string {
  if (q.kind === "statement") return statementKeyword(q.clauses[0]?.body ?? "");
  if (q.kind === "insert" && q.clauses.some((c) => c.kind === "conflict"))
    return "UPSERT";
  return q.kind.toUpperCase();
}

/** The card naming a query's main table, by kind. */
const MAIN_TABLE: Partial<Record<BuilderQueryKind, ClauseKind>> = {
  select: "from",
  update: "update",
  delete: "delete",
  insert: "insert",
};

/** The header's name: the query's own, or its kind and main table. */
export function queryLabel(q: BuilderQuery): string {
  if (q.name?.trim()) return q.name.trim();
  if (q.kind === "statement") return `SQL statement: ${queryBadge(q)}`;
  const kind = queryBadge(q);
  const card = MAIN_TABLE[q.kind];
  const body = q.clauses.find((c) => c.kind === card)?.body.trim();
  const table = body?.split(/[\s(]+/)[0];
  return table ? `${kind} ${table}` : kind;
}
