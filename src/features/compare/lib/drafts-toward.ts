import type { ForeignKeyInfo, IndexInfo, TableSchema } from "@/shared/api";
import type { DdlDiffSection } from "@/shared/components/diff-grid";
import {
  cols_from_schema,
  describe_schema_changes,
  fks_from_schema,
  idxs_from_schema,
  next_id,
  pk_from_schema,
  trigs_from_schema,
  type ColDraft,
  type FkDraft,
  type IdxDraft,
  type TriggerDraft,
} from "@/shared/schema-drafts/drafts";

export interface TowardDrafts {
  table: string;
  cols: ColDraft[];
  idxs: IdxDraft[];
  trigs: TriggerDraft[];
  fks: FkDraft[];
  schema_pk: string[];
}

const identity = (n: string) => n;

function idx_def(ix: IndexInfo): string {
  return JSON.stringify([
    ix.unique,
    ix.columns,
    ix.column_dirs ?? ix.columns.map(() => 1),
    !!ix.sparse,
    ix.ttl_seconds ?? null,
    ix.partial_filter ?? "",
  ]);
}

function fk_def(fk: ForeignKeyInfo): string {
  const act = (v?: string | null) => (!v || v === "NO ACTION" ? "" : v);
  return JSON.stringify([
    fk.column,
    fk.referenced_table,
    fk.referenced_column,
    act(fk.on_delete),
    act(fk.on_update),
  ]);
}

/** Items of `a` with no partner of the same key in `b`, counting
 *  duplicates, so two identical indexes on one side need two on the other. */
function unmatched<T>(a: T[], b: T[], key: (x: T) => string): T[] {
  const pool = new Map<string, number>();
  for (const x of b) pool.set(key(x), (pool.get(key(x)) ?? 0) + 1);
  return a.filter((x) => {
    const n = pool.get(key(x)) ?? 0;
    if (n > 0) pool.set(key(x), n - 1);
    return n === 0;
  });
}

/** Drafts that load `right` as the original and edit it until it matches
 *  `left`. Columns and triggers match by name; indexes and foreign keys by
 *  definition, so a same shaped index under another name is not a change.
 *  The table keeps its right side name. */
export function drafts_toward(
  right_table: string,
  right: TableSchema,
  left: TableSchema,
): TowardDrafts {
  const cols = cols_from_schema(right);
  const schema_pk = pk_from_schema(cols);
  const left_cols = new Map(left.columns.map((c) => [c.name, c]));
  for (const c of cols) {
    const l = left_cols.get(c.name);
    if (!l) {
      c.dropped = true;
      continue;
    }
    c.data_type = l.data_type;
    c.not_null = l.not_null;
    c.default_text = l.default ?? "";
    c.primary_key = l.primary_key;
  }
  const right_names = new Set(right.columns.map((c) => c.name));
  for (const l of left.columns) {
    if (right_names.has(l.name)) continue;
    cols.push({
      id: next_id(),
      orig_name: null,
      orig_data_type: null,
      orig_not_null: null,
      orig_default: null,
      name: l.name,
      data_type: l.data_type,
      not_null: l.not_null,
      default_text: l.default ?? "",
      primary_key: l.primary_key,
      dropped: false,
    });
  }

  // Constraint backed indexes still count when matching, so a UNIQUE
  // constraint on one side and a unique index on the other are equal.
  const not_pk = (ix: IndexInfo) => ix.origin !== "pk";
  const idxs = idxs_from_schema(right);
  const right_ix = right.indexes.filter(not_pk);
  const left_ix = left.indexes.filter(not_pk);
  const drop_ix = new Set(unmatched(right_ix, left_ix, idx_def));
  right.indexes.forEach((ix, i) => {
    if (drop_ix.has(ix)) idxs[i].dropped = true;
  });
  for (const ix of unmatched(left_ix, right_ix, idx_def)) {
    if (ix.origin !== "c") continue;
    idxs.push({
      id: next_id(),
      orig_name: null,
      orig_unique: null,
      orig_columns: null,
      orig_column_dirs: null,
      orig_sparse: null,
      orig_ttl_seconds: null,
      orig_partial_filter: null,
      name: ix.name,
      unique: ix.unique,
      columns: [...ix.columns],
      column_dirs: ix.column_dirs
        ? [...ix.column_dirs]
        : ix.columns.map(() => 1),
      sparse: ix.sparse ?? false,
      ttl_seconds: ix.ttl_seconds ?? null,
      partial_filter: ix.partial_filter ?? "",
      dropped: false,
      system: false,
    });
  }

  const trigs = trigs_from_schema(right);
  const left_trigs = new Map(left.triggers.map((t) => [t.name, t]));
  for (const t of trigs) {
    const l = t.orig_name ? left_trigs.get(t.orig_name) : undefined;
    if (!l) t.dropped = true;
    else t.sql = l.sql;
  }
  const right_trig_names = new Set(right.triggers.map((t) => t.name));
  for (const l of left.triggers) {
    if (right_trig_names.has(l.name)) continue;
    trigs.push({
      id: next_id(),
      orig_name: null,
      orig_sql: null,
      sql: l.sql,
      dropped: false,
    });
  }

  // Unnamed foreign keys (SQLite) can't be dropped, so they only take part
  // in matching.
  const fks = fks_from_schema(right);
  const drop_fk = new Set(
    unmatched(right.foreign_keys, left.foreign_keys, fk_def).map((f) => f.name),
  );
  for (const f of fks)
    if (f.orig_name && drop_fk.has(f.orig_name)) f.dropped = true;
  for (const fk of unmatched(left.foreign_keys, right.foreign_keys, fk_def)) {
    fks.push({
      id: next_id(),
      orig_name: null,
      columns: [fk.column],
      ref_table: fk.referenced_table,
      ref_columns: [fk.referenced_column],
      on_delete:
        fk.on_delete && fk.on_delete !== "NO ACTION" ? fk.on_delete : "",
      on_update:
        fk.on_update && fk.on_update !== "NO ACTION" ? fk.on_update : "",
      orig_on_delete: null,
      orig_on_update: null,
      dropped: false,
    });
  }

  return { table: right_table, cols, idxs, trigs, fks, schema_pk };
}

/** The structure diff as review grid sections: what would change on the
 *  right to make it match the left. */
export function structure_diff(d: TowardDrafts): DdlDiffSection[] {
  return describe_schema_changes(
    d.table,
    d.table,
    d.cols,
    d.idxs,
    identity,
    d.trigs,
    d.fks,
    d.schema_pk,
  );
}
