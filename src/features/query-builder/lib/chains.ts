import type { Clause, ClauseKind, SubChain } from "@/shared/store";
import { maskStringsAndComments } from "@/shared/lib/utils";
import { cardTable } from "./compose";
import type { ColumnsOf } from "./columns";
import { isMarker, markersIn, replaceMarkers } from "./markers";
import { allCards, newClause, type ListRole } from "./model";
import {
  parseJoin,
  readCte,
  refName,
  unquote,
  type Dialect,
  type TableRef,
} from "./sql-text";

/** Cards holding exactly one chain and no marker: the CTE's definition, the
 *  set operation's right side. */
export const OWN_CHAIN: ReadonlySet<ClauseKind> = new Set(["cte", "compound"]);

/** A new subquery: a SELECT card (empty, so `*`) and a FROM card. */
export function newChain(marker: number, from = ""): SubChain {
  return {
    id: crypto.randomUUID(),
    marker,
    name: null,
    clauses: [newClause("select"), newClause("from", from)],
    collapsed: false,
  };
}

/** What a chain under a `kind` card may hold. */
export const roleOf = (kind: ClauseKind): ListRole =>
  kind === "compound" ? "side" : "chain";

/** The next free marker among the chains of `clauses`. Markers are kept
 *  unique across a whole list, so a marker names one derived table. */
export function nextMarker(clauses: Clause[]): number {
  let max = 0;
  for (const c of clauses)
    for (const ch of c.chains ?? []) max = Math.max(max, ch.marker);
  return max + 1;
}

/** `next` with each chain collapsed or open as it is in `cur`, since
 *  collapsing is not an undo step. */
export function keepCollapsed(next: Clause[], cur: Clause[]): Clause[] {
  const was = new Map<string, boolean>();
  const read = (list: Clause[]) => {
    for (const c of list)
      for (const ch of c.chains ?? []) {
        was.set(ch.id, ch.collapsed);
        read(ch.clauses);
      }
  };
  read(cur);
  const apply = (list: Clause[]): Clause[] =>
    list.map((c) =>
      c.chains
        ? {
            ...c,
            chains: c.chains.map((ch) => ({
              ...ch,
              collapsed: was.get(ch.id) ?? ch.collapsed,
              clauses: apply(ch.clauses),
            })),
          }
        : c,
    );
  return apply(next);
}

/** A card after its body changed: chains whose marker is gone are dropped,
 *  and each of `create` gets a new empty chain. A CTE or set operation card
 *  keeps its one chain. */
export function syncChains(c: Clause, create: number[] = []): Clause {
  if (OWN_CHAIN.has(c.kind)) return c;
  const used = new Set(markersIn(c.body).map((m) => m.n));
  const kept = (c.chains ?? []).filter((ch) => used.has(ch.marker));
  const have = new Set(kept.map((ch) => ch.marker));
  const added = create
    .filter((n) => used.has(n) && !have.has(n))
    .map((n) => newChain(n));
  const chains = [...kept, ...added];
  if (chains.length === (c.chains ?? []).length && added.length === 0) return c;
  return { ...c, chains };
}

/** A card's body with each marker written out as its chain's SQL, for the
 *  SQL view. A VALUES source is written bare. */
export function expandBody(c: Clause): string {
  const chains = new Map((c.chains ?? []).map((ch) => [ch.marker, ch]));
  const bare = c.kind === "values" && /^\s*__dh_sub_\d+\s*$/.test(c.body);
  return replaceMarkers(c.body, (n) => {
    const ch = chains.get(n);
    if (!ch) return `__dh_sub_${n}`;
    const text = cardsText(ch.clauses);
    return bare ? text : `(${text})`;
  });
}

/** What a card's SQL view shows: its body with subqueries written out; a
 *  CTE as `name AS (…)`, a set operation as `UNION …`. */
export function viewText(c: Clause): string {
  const chain = c.chains?.[0];
  if (c.kind === "cte")
    return `${c.body.trim()} AS (${chain ? cardsText(chain.clauses) : ""})`;
  if (c.kind === "compound")
    return `${c.body.trim()} ${chain ? cardsText(chain.clauses) : ""}`.trim();
  return expandBody(c);
}

/** A SELECT card list as SQL, as written, subqueries written out. For
 *  display and search; Run uses `compose`. */
export function cardsText(clauses: Clause[]): string {
  const ctes = clauses.filter((c) => c.kind === "cte");
  const parts: string[] = [];
  if (ctes.length > 0) {
    const rec = ctes.some((c) => readCte(c.body)?.recursive);
    const list = ctes.map((c) => {
      const text = viewText(c).replace(/^\s*recursive\s+/i, "");
      return text;
    });
    parts.push(`WITH ${rec ? "RECURSIVE " : ""}${list.join(", ")}`);
  }
  const group = clauses.find((c) => c.kind === "group");
  for (const c of clauses) {
    const body = expandBody(c).trim();
    switch (c.kind) {
      case "cte":
        break;
      case "select": {
        const keys = group
          ? [group.body.trim(), group.aggregates?.trim() ?? ""]
              .filter(Boolean)
              .join(", ")
          : "";
        parts.push(`SELECT ${body || keys || "*"}`);
        break;
      }
      case "join":
        if (body) parts.push(body);
        break;
      case "compound":
        parts.push(viewText(c));
        break;
      case "group":
        if (body) parts.push(`GROUP BY ${body}`);
        break;
      case "order":
        if (body) parts.push(`ORDER BY ${body}`);
        break;
      default:
        if (body) parts.push(`${c.kind.toUpperCase()} ${body}`);
    }
  }
  return parts.join(" ");
}

/** How a chain reads as a one line chip: "subquery on customers, 3 cards". */
export function chainSummary(ch: SubChain, dialect: Dialect): string {
  const from = ch.clauses.find((c) => c.kind === "from");
  const t = from && cardTable(from, dialect);
  const on = t && !isMarker(t.name) ? ` on ${unquote(t.name)}` : "";
  const n = allCards(ch.clauses).length;
  return `subquery${on}, ${n} card${n === 1 ? "" : "s"}`;
}

const SEES_OUTER_ONLY: ReadonlySet<ClauseKind> = new Set([
  "cte",
  "compound",
  "from",
  "join",
  "using",
]);

const KEYWORDS = new Set(
  (
    "select from where and or not in is null as on join left right full inner outer cross " +
    "group by having order asc desc limit offset union all intersect except exists any some " +
    "between like ilike case when then else end distinct true false with recursive using " +
    "count sum avg min max cast interval date time timestamp current_date current_timestamp " +
    "nulls first last over partition filter collate escape similar to values default set " +
    "update delete insert into returning conflict do nothing excluded"
  ).split(" "),
);

/** The tables a list's own FROM, JOIN, UPDATE, DELETE, INSERT and USING
 *  cards name. */
const listTables = (clauses: Clause[], dialect: Dialect): TableRef[] =>
  clauses.flatMap((c) => cardTable(c, dialect) ?? []);

/** The text of `c` a column reference can sit in: a JOIN's condition, not
 *  its table; nothing for a FROM or a CTE's name. */
function refText(c: Clause): string {
  switch (c.kind) {
    case "from":
    case "using":
    case "update":
    case "delete":
    case "insert":
    case "cte":
    case "compound":
      return "";
    case "join":
      return parseJoin(c.body)?.condition ?? "";
    default:
      return `${c.body} ${c.aggregates ?? ""}`;
  }
}

/** Column references in `text`: `alias.column` pairs, and bare names. */
function refsIn(text: string): { qualified: string[]; bare: string[] } {
  const masked = maskStringsAndComments(text).replace(/__dh_sub_\d+/g, " ");
  const ident = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
  const qualified = [
    ...masked.matchAll(new RegExp(String.raw`(${ident})\s*\.\s*${ident}`, "g")),
  ].map((m) => unquote(m[1]).toLowerCase());
  const bare = [
    ...masked.matchAll(
      new RegExp(String.raw`(?<![\w$."])(${ident})(?![\w$"]*\s*[.(])`, "g"),
    ),
  ]
    .map((m) => unquote(m[1]))
    .filter((n) => !KEYWORDS.has(n.toLowerCase()) && !/^\d/.test(n));
  return { qualified, bare };
}

/** The chains under `clauses` that read a column of an outer query, so
 *  can't run on their own: a reference qualified by an alias only an outer
 *  scope defines, or a bare name only an outer scope's tables have. A
 *  recursive CTE's chain counts too, since it reads itself. */
export function outerChains(
  clauses: Clause[],
  columnsOf: ColumnsOf,
  dialect: Dialect,
): Set<string> {
  const out = new Set<string>();
  const columnNames = (ts: TableRef[]) =>
    new Set(
      ts.flatMap((t) => (columnsOf(t) ?? []).map((c) => c.name.toLowerCase())),
    );
  const walk = (list: Clause[], outer: TableRef[]) => {
    const own = listTables(list, dialect);
    for (const c of list)
      for (const ch of c.chains ?? []) {
        // A source or a CTE can't see the tables beside it; a condition
        // or a column can.
        const scope = SEES_OUTER_ONLY.has(c.kind) ? outer : [...outer, ...own];
        const cte = c.kind === "cte" && readCte(c.body)?.recursive;
        const cards = allCards(ch.clauses);
        const inner = listTables(cards, dialect);
        const defined = new Set(
          inner.map((t) => unquote(refName(t)).toLowerCase()),
        );
        const outer_aliases = new Set(
          scope.map((t) => unquote(refName(t)).toLowerCase()),
        );
        const refs = cards.map((x) => refsIn(refText(x)));
        const by_alias = refs.some((r) =>
          r.qualified.some((a) => !defined.has(a) && outer_aliases.has(a)),
        );
        let by_name = false;
        if (!by_alias) {
          const mine = columnNames(inner);
          const theirs = columnNames(scope);
          by_name = refs.some((r) =>
            r.bare.some((n) => {
              const k = n.toLowerCase();
              return theirs.has(k) && !mine.has(k);
            }),
          );
        }
        if (cte || by_alias || by_name) out.add(ch.id);
        walk(ch.clauses, scope);
      }
  };
  walk(clauses, []);
  // A chain inside one that reads the outer row can't run alone either.
  const spread = (list: Clause[], under: boolean) => {
    for (const c of list)
      for (const ch of c.chains ?? []) {
        if (under) out.add(ch.id);
        spread(ch.clauses, under || out.has(ch.id));
      }
  };
  spread(clauses, false);
  return out;
}
