import type { BuilderQuery, Clause } from "@/shared/store";
import { maskStringsAndComments } from "@/shared/lib/utils";
import { viewText } from "./chains";
import { cardTable, queryTables } from "./compose";
import { headerId } from "./lanes";
import { isMarker } from "./markers";
import { allCards, queryLabel } from "./model";
import { unquote, type Dialect } from "./sql-text";

/** What a search over a tab's queries found. */
export interface SearchResult {
  /** Matching header and card node ids, in canvas order. */
  hits: string[];
  /** Queries with no match. */
  dim: Set<string>;
  /** Collapsed chains holding a matching card. */
  open: Set<string>;
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*)`;
const QUALIFIED_RE = new RegExp(`(${IDENT})\\s*\\.\\s*(${IDENT})`, "g");
const BARE_RE = new RegExp(`(?<![\\w$".])(${IDENT})(?!\\s*[.(])`, "g");

const low = (ident: string) => unquote(ident).toLowerCase();

/** `table.column` for each column `text` names: qualified ones through
 *  `aliases`, bare ones on `only`, the list's one table. */
function columnRefs(
  text: string,
  aliases: Map<string, string>,
  only: string | null,
): string[] {
  const masked = maskStringsAndComments(text);
  const out: string[] = [];
  for (const m of masked.matchAll(QUALIFIED_RE)) {
    const table = aliases.get(low(m[1]));
    if (table) out.push(`${table}.${low(m[2])}`);
  }
  if (only)
    for (const m of masked.matchAll(BARE_RE))
      if (!isMarker(m[1])) out.push(`${only}.${low(m[1])}`);
  return out;
}

/** Everything a card is found by: its SQL with subqueries written out, its
 *  table, and the columns it names. */
function cardTexts(
  c: Clause,
  list: Clause[],
  aliases: Map<string, string> | null,
  dialect: Dialect,
): string[] {
  const sql = [viewText(c), c.aggregates ?? ""].join(" ");
  const ref = cardTable(c, dialect);
  const t = ref && !isMarker(ref.name) ? ref : null;
  const own = aliases ? queryTables(list, dialect) : [];
  const only = own.length === 1 ? low(own[0].name) : null;
  return [
    sql,
    ...(t
      ? [
          unquote(t.name),
          t.schema ? `${unquote(t.schema)}.${unquote(t.name)}` : "",
        ]
      : []),
    // A subquery's columns count for its own cards, not the parent's.
    ...(aliases
      ? columnRefs(`${c.body} ${c.aggregates ?? ""}`, aliases, only)
      : []),
  ].map((s) => s.toLowerCase());
}

/** Find `text`, ignoring case, in query names and auto labels, the tables
 *  and columns each query uses, and every card's SQL. Null when `text` is
 *  blank. */
export function searchQueries(
  queries: BuilderQuery[],
  text: string,
  dialect: Dialect,
): SearchResult | null {
  const needle = text.trim().toLowerCase();
  if (!needle) return null;
  // Column references only for `table.column` text, so a table name alone
  // doesn't outline every card naming one of its columns.
  const columns = needle.includes(".");
  const out: SearchResult = { hits: [], dim: new Set(), open: new Set() };
  for (const q of queries) {
    const aliases = new Map<string, string>();
    for (const t of queryTables(allCards(q.clauses), dialect)) {
      const name = low(t.name);
      aliases.set(name, name);
      if (t.alias) aliases.set(low(t.alias), name);
    }
    let found = false;
    if (
      [q.name ?? "", queryLabel(q)].some((s) =>
        s.toLowerCase().includes(needle),
      )
    ) {
      out.hits.push(headerId(q.id));
      found = true;
    }
    const walk = (list: Clause[], collapsed: string[]) => {
      for (const c of list) {
        if (
          cardTexts(c, list, columns ? aliases : null, dialect).some((s) =>
            s.includes(needle),
          )
        ) {
          out.hits.push(c.id);
          collapsed.forEach((id) => out.open.add(id));
          found = true;
        }
        for (const ch of c.chains ?? [])
          walk(ch.clauses, ch.collapsed ? [...collapsed, ch.id] : collapsed);
      }
    };
    walk(q.clauses, []);
    if (!found) out.dim.add(q.id);
  }
  return out;
}

/** `queries` with the chains in `open` shown open. */
export function openChains(
  queries: BuilderQuery[],
  open: Set<string>,
): BuilderQuery[] {
  if (open.size === 0) return queries;
  const list = (clauses: Clause[]): Clause[] =>
    clauses.map((c) =>
      c.chains
        ? {
            ...c,
            chains: c.chains.map((ch) => ({
              ...ch,
              collapsed: ch.collapsed && !open.has(ch.id),
              clauses: list(ch.clauses),
            })),
          }
        : c,
    );
  return queries.map((q) => ({ ...q, clauses: list(q.clauses) }));
}
