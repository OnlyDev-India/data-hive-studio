import type { SchemaOp, TableRef, TableSchema } from "@/shared/api";
import type { DdlDiffSection } from "@/shared/components/diff-grid";
import { build_index_ops, build_ops } from "@/shared/schema-drafts/drafts";
import {
  drafts_toward,
  structure_diff,
  type TowardDrafts,
} from "./drafts-toward";

export interface StructureSync {
  /** What runs, in one transaction, on the right side. */
  ops: SchemaOp[];
  /** What the review dialog shows: built from the same drafts as `ops`. */
  ddl: DdlDiffSection[];
  /** Trigger changes were left out because the table names differ. */
  triggers_left_out: boolean;
  /** Right side columns the sync drops, with their data. */
  dropped_columns: string[];
}

const identity = (n: string) => n;

/** Both sides live where index names must be unique together. An unknown
 *  (connection default) database or schema counts as possibly the same. */
export function same_namespace(a: TableRef, b: TableRef): boolean {
  const eq = (x?: string, y?: string) => !x || !y || x === y;
  return (
    a.conn_key === b.conn_key &&
    eq(a.database, b.database) &&
    eq(a.schema, b.schema)
  );
}

/** A created index's name on the right: the left table's name prefix
 *  swapped for the right's, else the right's name in front. */
export function index_name_for(
  name: string,
  left_table: string,
  right_table: string,
): string {
  if (left_table === right_table) return name;
  return name.startsWith(left_table)
    ? right_table + name.slice(left_table.length)
    : `${right_table}_${name}`;
}

/** Drafts for syncing: triggers kept as they are on the right when the table
 *  names differ (their SQL names the left table), and new indexes renamed
 *  when both tables share a namespace. */
function sync_drafts(d: TowardDrafts, left: TableRef, right: TableRef) {
  const tables_differ = left.table !== right.table;
  const trigger_changes = d.trigs.some(
    (t) => t.dropped || !t.orig_name || t.sql !== t.orig_sql,
  );
  const trigs = tables_differ
    ? d.trigs
        .filter((t) => t.orig_name)
        .map((t) => ({ ...t, dropped: false, sql: t.orig_sql ?? t.sql }))
    : d.trigs;
  const rename = same_namespace(left, right);
  const idxs = d.idxs.map((ix) =>
    rename && ix.orig_name === null
      ? { ...ix, name: index_name_for(ix.name, left.table, right.table) }
      : ix,
  );
  return {
    drafts: { ...d, trigs, idxs },
    triggers_left_out: tables_differ && trigger_changes,
  };
}

/** The ops that make the right table's structure match the left's. Never a
 *  table rename: the right keeps its name. */
export function sql_structure_sync(
  left: TableRef,
  right: TableRef,
  l: TableSchema,
  r: TableSchema,
): StructureSync {
  const { drafts: d, triggers_left_out } = sync_drafts(
    drafts_toward(right.table, r, l),
    left,
    right,
  );
  return {
    ops: build_ops(
      d.table,
      d.table,
      d.cols,
      d.idxs,
      identity,
      d.trigs,
      d.fks,
      d.schema_pk,
    ),
    ddl: structure_diff(d),
    triggers_left_out,
    dropped_columns: d.cols
      .filter((c) => c.dropped && c.orig_name)
      .map((c) => c.orig_name!),
  };
}

/** A collection's syncable structure is its indexes; field shapes live in
 *  the documents, which Sync data changes. */
export function mongo_structure_sync(
  right: TableRef,
  l: TableSchema,
  r: TableSchema,
): StructureSync {
  const indexes_only = (s: TableSchema): TableSchema => ({
    ...s,
    columns: [],
    foreign_keys: [],
    triggers: [],
  });
  const d = drafts_toward(right.table, indexes_only(r), indexes_only(l));
  return {
    ops: build_index_ops(d.table, d.idxs, identity),
    ddl: structure_diff(d).filter((s) => s.entity === "index"),
    triggers_left_out: false,
    dropped_columns: [],
  };
}
