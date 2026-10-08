import type { Clause } from "@/shared/store";
import { parseGroup, parseSelect, printAggregate } from "./forms/lists";
import {
  parseJoin,
  parseTableRef,
  refName,
  type Dialect,
  type TableRef,
} from "./sql-text";

export interface Column {
  /** As the query writes it: `c.name` once there is more than one table. */
  name: string;
  type: string | null;
}

/** A table's columns from the catalog; undefined while unknown. */
export type ColumnsOf = (
  t: TableRef,
) => { name: string; type: string }[] | undefined;

/** The columns each card can pick from:
 *  - FROM, JOIN, WHERE and GROUP BY read the tables so far (a JOIN its own
 *    too), qualified once the query has more than one table.
 *  - HAVING offers the group keys and aggregates, then the input columns.
 *  - SELECT after a GROUP BY offers its keys and aggregates, else the input.
 *  - ORDER BY offers the SELECT list's names, else the GROUP BY outputs,
 *    else the input. */
export function cardColumns(
  clauses: Clause[],
  columnsOf: ColumnsOf,
  dialect: Dialect,
): Record<string, Column[]> {
  const tables: TableRef[] = [];
  for (const c of clauses) {
    const t =
      c.kind === "from"
        ? parseTableRef(c.body)
        : c.kind === "join"
          ? (parseJoin(c.body)?.table ?? null)
          : null;
    if (t) tables.push(t);
  }
  const qualify = tables.length > 1;
  const columnsFor = (ts: TableRef[]): Column[] =>
    ts.flatMap((t) =>
      (columnsOf(t) ?? []).map((col) => ({
        name: qualify ? `${refName(t)}.${col.name}` : col.name,
        type: col.type,
      })),
    );
  const input = columnsFor(tables);
  const typeOf = (name: string) =>
    input.find((c) => c.name === name)?.type ?? null;

  const group = clauses.find((c) => c.kind === "group");
  const g = group
    ? parseGroup(group.body, group.aggregates ?? "", dialect)
    : null;
  const keys: Column[] = (g?.keys ?? []).map((k) => ({
    name: k,
    type: typeOf(k),
  }));
  const aggregate_calls: Column[] = (g?.aggregates ?? []).map((a) => ({
    name: printAggregate({ ...a, alias: "" }),
    type: null,
  }));
  const group_outputs: Column[] = [
    ...keys,
    ...(g?.aggregates ?? []).map((a) => ({
      name: a.alias.trim() || printAggregate({ ...a, alias: "" }),
      type: null,
    })),
  ];
  const select = clauses.find((c) => c.kind === "select");
  const picked = select ? parseSelect(select.body, dialect) : null;
  const select_names: Column[] = (picked ?? []).map((p) => ({
    name: p.alias.trim() || p.expr,
    type: typeOf(p.expr),
  }));

  const out: Record<string, Column[]> = {};
  let seen = 0;
  for (const c of clauses) {
    if (c.kind === "from" || c.kind === "join") {
      if (parseTableRef(c.body) || parseJoin(c.body)) seen++;
      out[c.id] = columnsFor(tables.slice(0, Math.max(seen, 1)));
      continue;
    }
    switch (c.kind) {
      case "where":
      case "group":
        out[c.id] = input;
        break;
      case "having":
        out[c.id] = [...keys, ...aggregate_calls, ...input];
        break;
      case "select":
        out[c.id] = group ? [...keys, ...aggregate_calls] : input;
        break;
      case "order":
        out[c.id] = select_names.length
          ? select_names
          : group
            ? group_outputs
            : input;
        break;
      case "limit":
        out[c.id] = [];
        break;
    }
  }
  return out;
}
