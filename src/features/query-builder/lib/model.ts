import type { Clause, ClauseKind } from "@/shared/store";

/** The order cards always sit in. JOIN may repeat; every other kind appears
 *  at most once. */
export const CLAUSE_ORDER: ClauseKind[] = [
  "from",
  "join",
  "where",
  "group",
  "having",
  "select",
  "order",
  "limit",
];

export const CLAUSE_LABEL: Record<ClauseKind, string> = {
  from: "FROM",
  join: "JOIN",
  where: "WHERE",
  group: "GROUP BY",
  having: "HAVING",
  select: "SELECT",
  order: "ORDER BY",
  limit: "LIMIT",
};

/** Kinds an empty card is skipped for, rather than an error. */
export const SKIPPABLE: ReadonlySet<ClauseKind> = new Set([
  "where",
  "having",
  "select",
  "order",
  "limit",
]);

const rank = (k: ClauseKind) => CLAUSE_ORDER.indexOf(k);

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

/** The kinds a card added at `index` may be: only the ones that fit
 *  between its neighbours and are not there yet; HAVING only after a
 *  GROUP BY. FROM is never offered, it is always the first card. */
export function slotKinds(clauses: Clause[], index: number): ClauseKind[] {
  const prev = clauses[index - 1];
  const next = clauses[index];
  if (!prev) return [];
  const present = new Set(clauses.map((c) => c.kind));
  return CLAUSE_ORDER.filter((k) => {
    if (k === "from") return false;
    if (k !== "join" && present.has(k)) return false;
    if (k === "having" && !present.has("group")) return false;
    if (rank(k) < rank(prev.kind)) return false;
    if (k !== "join" && rank(k) === rank(prev.kind)) return false;
    if (next && rank(k) > rank(next.kind)) return false;
    if (next && k !== "join" && rank(k) === rank(next.kind)) return false;
    return true;
  });
}

/** Where a new card of `kind` goes so the order holds: after the last card
 *  that comes before it. */
export function slotFor(clauses: Clause[], kind: ClauseKind): number {
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

/** Remove a card; FROM stays, and a GROUP BY takes its HAVING with it. */
export function removeClause(clauses: Clause[], id: string): Clause[] {
  const gone = findClause(clauses, id);
  if (!gone || gone.kind === "from") return clauses;
  return clauses.filter(
    (c) => c.id !== id && !(gone.kind === "group" && c.kind === "having"),
  );
}

export function patchClause(
  clauses: Clause[],
  id: string,
  patch: Partial<Omit<Clause, "id" | "kind">>,
): Clause[] {
  return clauses.map((c) => (c.id === id ? { ...c, ...patch } : c));
}

/** Move JOIN `id` to `slot` among the JOIN cards. Nothing else moves. */
export function moveJoin(
  clauses: Clause[],
  id: string,
  slot: number,
): Clause[] {
  const join = findClause(clauses, id);
  if (!join || join.kind !== "join") return clauses;
  const joins = clauses.filter((c) => c.kind === "join" && c.id !== id);
  const at = Math.max(0, Math.min(slot, joins.length));
  joins.splice(at, 0, join);
  const first = clauses.findIndex((c) => c.kind === "join");
  const rest = clauses.filter((c) => c.kind !== "join");
  return [...rest.slice(0, first), ...joins, ...rest.slice(first)];
}

const sameText = (a: Clause, b: Clause) =>
  a.id === b.id &&
  a.kind === b.kind &&
  a.body === b.body &&
  a.aggregates === b.aggregates;

/** The first card whose query `next` changes: its id, null when the change
 *  is at the very start, undefined when no card's query changed (a flip
 *  between form and SQL, or the last card removed). */
export function firstChanged(
  prev: Clause[],
  next: Clause[],
): string | null | undefined {
  const n = Math.max(prev.length, next.length);
  for (let i = 0; i < n; i++) {
    const a = prev[i];
    const b = next[i];
    if (a && b && sameText(a, b)) continue;
    if (!b) return undefined;
    return i === 0 ? null : b.id;
  }
  return undefined;
}

/** The cards a refresh from `from` (null for all) previews. */
export function previewTargets(
  clauses: Clause[],
  from: string | null,
): Set<string> {
  const at = from === null ? 0 : clauses.findIndex((c) => c.id === from);
  return new Set(clauses.slice(Math.max(at, 0)).map((c) => c.id));
}

/** "Card 3", how a card is named when it holds others back. */
export const cardName = (index: number) => `card ${index + 1}`;

/** Why a card breaks the order, if it does. Cards restored from an older
 *  snapshot or pasted could. */
export function orderErrors(clauses: Clause[]): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Set<ClauseKind>();
  let last = -1;
  clauses.forEach((c, i) => {
    const r = rank(c.kind);
    if (i === 0 && c.kind !== "from")
      out.set(c.id, "The first card must be FROM");
    else if (i > 0 && c.kind === "from") out.set(c.id, "Only one FROM, first");
    else if (c.kind !== "join" && seen.has(c.kind))
      out.set(c.id, `Only one ${CLAUSE_LABEL[c.kind]}`);
    else if (r < last) out.set(c.id, `${CLAUSE_LABEL[c.kind]} is out of place`);
    else if (c.kind === "having" && !seen.has("group"))
      out.set(c.id, "HAVING needs a GROUP BY before it");
    seen.add(c.kind);
    last = Math.max(last, r);
  });
  return out;
}
