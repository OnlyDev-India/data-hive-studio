import type { Clause, ClauseKind } from "@/shared/store";
import { cardTable } from "./compose";
import { parseGroup, parseSelect, printAggregate } from "./forms/lists";
import { parseInsert } from "./forms/writes";
import { isMarker, maskMarkers } from "./markers";
import { kindOf } from "./model";
import {
  parseJoin,
  parseTableRef,
  readCte,
  refName,
  unquote,
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
 *    else the input.
 *  Write queries read theirs in `writeColumns`. */
export function cardColumns(
  clauses: Clause[],
  columnsOf: ColumnsOf,
  dialect: Dialect,
): Record<string, Column[]> {
  if (kindOf(clauses) !== "select")
    return writeColumns(clauses, columnsOf, dialect);
  const sh = shape(clauses, columnsOf, dialect);
  const { input, keys, aggregate_calls, group_outputs, select_names } = sh;

  const out: Record<string, Column[]> = {};
  let seen = 0;
  for (const c of clauses) {
    if (c.kind === "from" || c.kind === "join") {
      if (parseTableRef(c.body) || parseJoin(c.body)) seen++;
      out[c.id] = sh.columnsFor(sh.tables.slice(0, Math.max(seen, 1)));
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
        out[c.id] = sh.group ? [...keys, ...aggregate_calls] : input;
        break;
      case "order":
        out[c.id] = select_names.length
          ? select_names
          : sh.group
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

/** What a SELECT card list reads and puts out. */
function shape(clauses: Clause[], columnsOf: ColumnsOf, dialect: Dialect) {
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

  const group = clauses.find((c) => c.kind === "group") ?? null;
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
  const picked = select ? parseSelect(maskMarkers(select.body), dialect) : null;
  const select_names: Column[] = (picked ?? []).map((p) => ({
    name: p.alias.trim() || p.expr,
    type: typeOf(p.expr),
  }));
  return {
    tables,
    columnsFor,
    input,
    group,
    keys,
    aggregate_calls,
    group_outputs,
    select_names,
  };
}

/** The columns a SELECT card list puts out, as a table over it names them:
 *  its SELECT list (aliases, else the column's own name), else its group
 *  outputs, else every input column. */
export function outputColumns(
  clauses: Clause[],
  columnsOf: ColumnsOf,
  dialect: Dialect,
): Column[] {
  const sh = shape(clauses, columnsOf, dialect);
  const list = sh.select_names.length
    ? sh.select_names
    : sh.group
      ? sh.group_outputs
      : sh.input;
  return list.map((c) => ({
    name: c.name.replace(/^.*\.\s*/, ""),
    type: c.type,
  }));
}

/** Cards whose own chains can't see the tables beside them. */
const SOURCE_KINDS: ReadonlySet<ClauseKind> = new Set([
  "cte",
  "compound",
  "from",
  "join",
  "using",
]);

/** Cards a correlated column can be written in. */
const READS_OUTER: ReadonlySet<ClauseKind> = new Set([
  "select",
  "join",
  "where",
  "group",
  "having",
  "order",
]);

/** The columns every card of a query can pick from, chains included. A
 *  subquery used as a table, and a CTE's name, read their chain's output
 *  columns; a chain's cards also offer the outer tables' columns as
 *  `alias.column`. */
export function queryColumns(
  clauses: Clause[],
  columnsOf: ColumnsOf,
  dialect: Dialect,
): Record<string, Column[]> {
  const out: Record<string, Column[]> = {};
  const ctes = new Map<string, Column[]>();
  const walk = (list: Clause[], outer: Column[]) => {
    const byMarker = new Map(
      list.flatMap((c) =>
        (c.chains ?? []).map((ch) => [ch.marker, ch] as const),
      ),
    );
    const resolve: ColumnsOf = (t) => {
      if (isMarker(t.name)) {
        const ch = byMarker.get(Number(t.name.slice("__dh_sub_".length)));
        return (
          ch &&
          outputColumns(ch.clauses, resolve, dialect).map((c) => ({
            name: c.name,
            type: c.type ?? "",
          }))
        );
      }
      if (!t.schema) {
        const cte = ctes.get(unquote(t.name).toLowerCase());
        if (cte) return cte.map((c) => ({ name: c.name, type: c.type ?? "" }));
      }
      return columnsOf(t);
    };
    // CTEs first: every card after them may read their names.
    for (const c of list) {
      const cte = c.kind === "cte" ? readCte(c.body) : null;
      const def = c.chains?.[0];
      if (!cte || !def) continue;
      walk(def.clauses, outer);
      ctes.set(
        unquote(cte.name).toLowerCase(),
        outputColumns(def.clauses, resolve, dialect),
      );
    }
    const own = cardColumns(list, resolve, dialect);
    for (const [id, cols] of Object.entries(own)) {
      const c = list.find((x) => x.id === id);
      out[id] =
        outer.length > 0 && c && READS_OUTER.has(c.kind)
          ? [...cols, ...outer]
          : cols;
    }
    const here = list
      .flatMap((c) => cardTable(c, dialect) ?? [])
      .flatMap((t) =>
        (resolve(t) ?? []).map((col) => ({
          name: `${refName(t)}.${col.name}`,
          type: col.type || null,
        })),
      );
    for (const c of list) {
      if (c.kind === "cte") continue;
      for (const ch of c.chains ?? [])
        walk(
          ch.clauses,
          SOURCE_KINDS.has(c.kind) ? outer : [...outer, ...here],
        );
    }
  };
  walk(clauses, []);
  return out;
}

const TARGETS = new Set(["update", "delete", "insert"]);

/** Where ON CONFLICT card `id` finds its `excluded.<column>` suggestions. */
export const excludedKey = (id: string) => `${id}:excluded`;

/** The columns each write card can pick from:
 *  - SET, ON CONFLICT and the head card offer the target's own columns,
 *    bare, since SET can't qualify them.
 *  - VALUES offers the INSERT card's columns in its order, else every
 *    target column: the grid's header.
 *  - FROM, JOIN and USING read the tables so far on their side.
 *  - WHERE and RETURNING read every table, qualified once there are
 *    several. */
function writeColumns(
  clauses: Clause[],
  columnsOf: ColumnsOf,
  dialect: Dialect,
): Record<string, Column[]> {
  const head = clauses.find((c) => TARGETS.has(c.kind));
  const target = head ? cardTable(head, dialect) : null;
  const own: Column[] = target
    ? (columnsOf(target) ?? []).map((c) => ({ name: c.name, type: c.type }))
    : [];
  const sources = clauses
    .filter((c) => !TARGETS.has(c.kind))
    .flatMap((c) => cardTable(c, dialect) ?? []);
  const tables = target ? [target, ...sources] : sources;
  const qualify = tables.length > 1;
  const columnsFor = (ts: TableRef[]): Column[] =>
    ts.flatMap((t) =>
      (columnsOf(t) ?? []).map((col) => ({
        name: qualify ? `${refName(t)}.${col.name}` : col.name,
        type: col.type,
      })),
    );
  const input = columnsFor(tables);
  const insert = clauses.find((c) => c.kind === "insert");
  const listed = insert
    ? (parseInsert(insert.body, dialect)?.columns ?? [])
    : [];
  const values: Column[] =
    listed.length > 0
      ? listed.map((name) => ({
          name,
          type: own.find((c) => c.name === unquote(name))?.type ?? null,
        }))
      : own;

  const out: Record<string, Column[]> = {};
  let seen = 0;
  for (const c of clauses) {
    switch (c.kind) {
      case "from":
      case "join":
      case "using":
        if (cardTable(c, dialect)) seen++;
        out[c.id] = columnsFor(sources.slice(0, Math.max(seen, 1)));
        break;
      case "values":
        out[c.id] = values;
        break;
      case "conflict":
        out[c.id] = own;
        out[excludedKey(c.id)] = values.map((v) => ({
          name: `excluded.${v.name}`,
          type: v.type,
        }));
        break;
      case "where":
      case "returning":
        out[c.id] = input;
        break;
      default:
        out[c.id] = own;
    }
  }
  return out;
}
