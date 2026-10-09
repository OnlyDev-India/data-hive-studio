import type { GraphLink } from "@/shared/api";
import type { Clause } from "@/shared/store";
import { queryTables } from "./compose";
import type { OnPair } from "./forms/tables";
import {
  quoteIdent,
  refName,
  unquote,
  type Dialect,
  type TableRef,
} from "./sql-text";
import { sameName, type PickTable } from "./use-catalog";

export interface JoinSuggestion {
  table: PickTable;
  /** `child.fk = parent.pk` per column pair. */
  on: OnPair[];
}

/** How a picked table is written in FROM or JOIN text: bare in the tab's
 *  schema, `schema.table` otherwise. */
export function tableIdent(
  t: PickTable,
  home: string | null,
  dialect: Dialect,
) {
  const name = quoteIdent(t.name, dialect);
  return t.schema && t.schema !== home
    ? `${quoteIdent(t.schema, dialect)}.${name}`
    : name;
}

/** The alias a table needs: none the first time, `<table>_2` (or the next
 *  free number) when the query already reads it. */
export function aliasFor(
  clauses: Clause[],
  name: string,
  dialect: Dialect,
): string | null {
  const refs = queryTables(clauses, dialect);
  const taken = new Set(refs.map((t) => unquote(refName(t)).toLowerCase()));
  if (!refs.some((t) => sameName(t.name, name, dialect))) return null;
  for (let n = 2; ; n++) {
    const alias = `${name}_${n}`;
    if (!taken.has(alias.toLowerCase())) return quoteIdent(alias, dialect);
  }
}

/** Tables linked by a foreign key to a table already in the query, in
 *  either direction, each with its ON filled in. */
export function joinSuggestions(
  clauses: Clause[],
  links: GraphLink[],
  home: string | null,
  dialect: Dialect,
): JoinSuggestion[] {
  // An UPDATE's JOIN can't name its target, only the FROM side.
  const refs = queryTables(
    clauses.filter((c) => c.kind === "from" || c.kind === "join"),
    dialect,
  );
  const schemaOf = (t: TableRef) =>
    dialect === "sqlite" ? null : t.schema ? unquote(t.schema) : home;
  const inQuery = (schema: string | null, name: string) =>
    refs.find(
      (t) =>
        (dialect === "sqlite" || schemaOf(t) === (schema ?? home)) &&
        sameName(t.name, name, dialect),
    );
  const out: JoinSuggestion[] = [];
  const seen = new Set<string>();
  const add = (table: PickTable, on: OnPair[]) => {
    const k = `${table.schema ?? ""}.${table.name}|${on.map((p) => `${p.left}=${p.right}`).join(",")}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ table, on });
  };
  for (const l of links) {
    if (l.inferred) continue;
    const child = inQuery(l.from_schema, l.from_table);
    const parent = inQuery(l.to_schema, l.to_table);
    const col = (ref: string, c: string) => `${ref}.${quoteIdent(c, dialect)}`;
    if (child) {
      const t = { schema: l.to_schema, name: l.to_table };
      const ref =
        aliasFor(clauses, l.to_table, dialect) ??
        quoteIdent(l.to_table, dialect);
      add(
        t,
        l.from_columns.map((c, i) => ({
          left: col(refName(child), c),
          right: col(ref, l.to_columns[i]),
        })),
      );
    }
    if (parent) {
      const t = { schema: l.from_schema, name: l.from_table };
      const ref =
        aliasFor(clauses, l.from_table, dialect) ??
        quoteIdent(l.from_table, dialect);
      add(
        t,
        l.from_columns.map((c, i) => ({
          left: col(ref, c),
          right: col(refName(parent), l.to_columns[i]),
        })),
      );
    }
  }
  return out;
}
