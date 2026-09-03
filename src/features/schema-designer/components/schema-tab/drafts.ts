import type { DefaultMode, SchemaOp, TableSchema } from "@/shared/api";

/** Types offered in the dropdown. SQLite accepts any declared type; the
 *  PostgreSQL-specific entries only matter for PG connections. */
export const TYPE_OPTIONS = [
  "",
  "INTEGER",
  "BIGINT",
  "TEXT",
  "REAL",
  "BLOB",
  "NUMERIC",
  "BOOLEAN",
  "VARCHAR",
  "UUID",
  "JSONB",
  "DATE",
  "TIMESTAMP",
  "TIMESTAMPTZ",
  "INET",
];

/** Editable mirror of one table column; `orig_*` fields snapshot the loaded
 *  schema so dirty checks and op building can diff against it. */
export interface ColDraft {
  id: string;
  orig_name: string | null;
  orig_data_type: string | null;
  orig_not_null: boolean | null;
  orig_default: string | null;
  name: string;
  data_type: string;
  not_null: boolean;
  default_text: string;
  primary_key: boolean;
  dropped: boolean;
}

/** Editable mirror of one table index (same snapshot pattern). `system`
 *  marks constraint-backed indexes (UNIQUE / PRIMARY KEY) which SQLite
 *  forbids dropping directly — they render read-only and never emit ops.
 *  The `*_dirs`/`sparse`/`ttl_seconds`/`partial_filter` fields are MongoDB-
 *  only extras; SQL engines never populate `orig_*` for them and always keep
 *  the plain defaults (ascending, not sparse, no TTL, no partial filter). */
export interface IdxDraft {
  id: string;
  orig_name: string | null;
  orig_unique: boolean | null;
  orig_columns: string[] | null;
  orig_column_dirs: number[] | null;
  orig_sparse: boolean | null;
  orig_ttl_seconds: number | null;
  orig_partial_filter: string | null;
  name: string;
  unique: boolean;
  columns: string[];
  /** Per-column sort direction (1 = asc, -1 = desc), parallel to `columns`. */
  column_dirs: number[];
  sparse: boolean;
  ttl_seconds: number | null;
  /** MQL extended JSON text, or "" for none. */
  partial_filter: string;
  dropped: boolean;
  system: boolean;
}

/** Editable mirror of one table trigger. The SQL is the source of truth —
 *  SQLite has no ALTER TRIGGER, so an edit is a drop + create pair and the
 *  name lives inside (is parsed from) the statement itself. */
export interface TriggerDraft {
  id: string;
  orig_name: string | null;
  orig_sql: string | null;
  sql: string;
  dropped: boolean;
}

/** Editable mirror of one foreign-key constraint. `orig_name` is null for
 *  newly added constraints; existing ones carry the PG constraint name so a
 *  drop can target it. SQLite FKs have no names — they render read-only. */
export interface FkDraft {
  id: string;
  orig_name: string | null;
  columns: string[];
  ref_table: string;
  ref_columns: string[];
  on_delete: string;
  on_update: string;
  /** Actions as loaded — PG cannot ALTER them; a change emits drop + add. */
  orig_on_delete: string | null;
  orig_on_update: string | null;
  dropped: boolean;
}

let uid_seq = 0;
/** Fresh id for a draft row that has no counterpart in the loaded schema. */
export const next_id = () => `n${++uid_seq}`;

export function cols_from_schema(schema: TableSchema): ColDraft[] {
  return schema.columns.map((c, i) => ({
    id: `o${i}`,
    orig_name: c.name,
    orig_data_type: c.data_type,
    orig_not_null: c.not_null,
    orig_default: c.default ?? null,
    name: c.name,
    data_type: c.data_type,
    not_null: c.not_null,
    default_text: c.default ?? "",
    primary_key: c.primary_key,
    dropped: false,
  }));
}

export function idxs_from_schema(schema: TableSchema): IdxDraft[] {
  return schema.indexes.map((ix, i) => {
    const default_dirs = ix.columns.map(() => 1);
    return {
      id: `o${i}`,
      orig_name: ix.name,
      orig_unique: ix.unique,
      orig_columns: ix.columns,
      orig_column_dirs: ix.column_dirs ?? null,
      orig_sparse: ix.sparse ?? null,
      orig_ttl_seconds: ix.ttl_seconds ?? null,
      orig_partial_filter: ix.partial_filter ?? null,
      name: ix.name,
      unique: ix.unique,
      columns: [...ix.columns],
      column_dirs: ix.column_dirs ? [...ix.column_dirs] : default_dirs,
      sparse: ix.sparse ?? false,
      ttl_seconds: ix.ttl_seconds ?? null,
      partial_filter: ix.partial_filter ?? "",
      dropped: false,
      system: ix.origin !== "c",
    };
  });
}

/** True when an index draft's MongoDB-only extras differ from what was
 *  loaded. Shared by `idx_is_dirty` and `build_index_ops`'s "did this index
 *  change" check so the two can't drift out of sync. */
function idx_extras_changed(ix: IdxDraft): boolean {
  const orig_dirs = ix.orig_column_dirs ?? ix.orig_columns?.map(() => 1) ?? [];
  return (
    JSON.stringify(ix.column_dirs) !== JSON.stringify(orig_dirs) ||
    ix.sparse !== !!ix.orig_sparse ||
    ix.ttl_seconds !== ix.orig_ttl_seconds ||
    ix.partial_filter !== (ix.orig_partial_filter ?? "")
  );
}

export function col_is_dirty(c: ColDraft): boolean {
  if (c.dropped) return c.orig_name !== null;
  if (c.orig_name === null) return true;
  return (
    c.name.trim() !== c.orig_name ||
    c.data_type.trim() !== (c.orig_data_type ?? "") ||
    c.not_null !== !!c.orig_not_null ||
    c.default_text !== (c.orig_default ?? "")
  );
}

export function idx_is_dirty(
  ix: IdxDraft,
  resolve: (n: string) => string,
): boolean {
  if (ix.system) return false;
  if (ix.dropped) return ix.orig_name !== null;
  if (ix.orig_name === null) return true;
  return (
    ix.name.trim() !== ix.orig_name ||
    ix.unique !== !!ix.orig_unique ||
    JSON.stringify(ix.columns.map(resolve)) !==
      JSON.stringify(ix.orig_columns) ||
    idx_extras_changed(ix)
  );
}

export function trigs_from_schema(schema: TableSchema): TriggerDraft[] {
  return schema.triggers.map((t, i) => ({
    id: `t${i}`,
    orig_name: t.name,
    orig_sql: t.sql,
    sql: t.sql,
    dropped: false,
  }));
}

/** Pull the trigger name out of a CREATE TRIGGER statement. */
export function trigger_name_from_sql(sql: string): string {
  const m = sql.match(
    /create\s+(?:or\s+replace\s+)?trigger\s+(?:if\s+not\s+exists\s+)?["'`[]?([\w\s]+?)["'`[\]]?\s+(?:before|after|instead|when|begin|for|on)\b/i,
  );
  return (m?.[1] ?? "").trim();
}

export function trig_is_dirty(t: TriggerDraft): boolean {
  if (t.dropped) return t.orig_name !== null;
  if (t.orig_name === null) return true;
  return t.sql !== t.orig_sql;
}

export function fks_from_schema(schema: TableSchema): FkDraft[] {
  return schema.foreign_keys
    .filter((fk) => fk.name)
    .map((fk, i) => ({
      id: `f${i}`,
      orig_name: fk.name ?? null,
      columns: [fk.column],
      ref_table: fk.referenced_table,
      ref_columns: [fk.referenced_column],
      on_delete:
        fk.on_delete && fk.on_delete !== "NO ACTION" ? fk.on_delete : "",
      on_update:
        fk.on_update && fk.on_update !== "NO ACTION" ? fk.on_update : "",
      orig_on_delete: fk.on_delete ?? null,
      orig_on_update: fk.on_update ?? null,
      dropped: false,
    }));
}

export function fk_is_dirty(f: FkDraft): boolean {
  if (f.dropped) return f.orig_name !== null;
  if (f.orig_name === null) return true;
  // Existing constraint with edited referential actions → drop + add pair.
  const norm = (v: string | null) => (!v || v === "NO ACTION" ? "" : v);
  return (
    norm(f.on_delete) !== norm(f.orig_on_delete) ||
    norm(f.on_update) !== norm(f.orig_on_update)
  );
}

/** The PK columns as loaded — diffed against the kept columns' PK flags. */
export function pk_from_schema(cols: ColDraft[]): string[] {
  return cols.filter((c) => c.primary_key).map((c) => c.orig_name ?? c.name);
}

/** Cross-field validation shown as the inline banner before Apply. */
export function validate_drafts(
  table_name: string,
  cols: ColDraft[],
  idxs: IdxDraft[],
  trigs: TriggerDraft[] = [],
  fks: FkDraft[] = [],
): string | null {
  if (!table_name.trim()) return "Table name cannot be empty.";
  const cnames = new Set<string>();
  for (const c of cols) {
    if (c.dropped) continue;
    const n = c.name.trim();
    if (!n) return "Every kept column needs a name.";
    const key = n.toLowerCase();
    if (cnames.has(key)) return `Duplicate column name "${n}".`;
    cnames.add(key);
  }
  const inames = new Set<string>();
  for (const ix of idxs) {
    if (ix.dropped) continue;
    const n = ix.name.trim();
    if (!n) return "Every kept index needs a name.";
    if (ix.columns.length === 0)
      return `Index "${n}" needs at least one column.`;
    const key = n.toLowerCase();
    if (inames.has(key)) return `Duplicate index name "${n}".`;
    inames.add(key);
  }
  const tnames = new Set<string>();
  for (const t of trigs) {
    if (t.dropped) continue;
    const sql = t.sql.trim();
    if (!sql) return "Every kept trigger needs SQL.";
    const n = trigger_name_from_sql(sql);
    if (!n)
      return "Trigger SQL must be a CREATE TRIGGER statement with a name.";
    const key = n.toLowerCase();
    if (tnames.has(key)) return `Duplicate trigger name "${n}".`;
    tnames.add(key);
  }
  for (const f of fks) {
    if (f.dropped) continue;
    if (f.columns.length === 0)
      return "Every foreign key needs at least one column.";
    if (!f.ref_table.trim())
      return "Every foreign key needs a referenced table.";
    if (f.ref_columns.length === 0)
      return "Every foreign key needs referenced column(s).";
  }
  return null;
}

/** Diff index drafts against the loaded schema into drop/create ops for one
 *  table/collection. Shared by `build_ops` (SQL tables, which also diff
 *  columns/triggers/FKs) and the MongoDB index-only editor (Mongo collections
 *  have no columns/triggers/FKs to diff — indexes are the only DDL concept
 *  that applies). `table` rides along on every op — SQLite/Postgres ignore
 *  it on drop (index names are unique per file/schema there), but MongoDB
 *  requires it (index names are only unique per collection). */
export function build_index_ops(
  table: string,
  idxs: IdxDraft[],
  resolve: (n: string) => string,
): SchemaOp[] {
  const ops: SchemaOp[] = [];
  const dropped_idx = new Set<string>();
  for (const ix of idxs) {
    if (ix.system) continue;
    if (!ix.orig_name || !ix.dropped) continue;
    ops.push({ kind: "drop_index", table, index: ix.orig_name });
    dropped_idx.add(ix.id);
  }
  for (const ix of idxs) {
    if (ix.system || ix.dropped || !ix.orig_name) continue;
    const name = ix.name.trim();
    const final_cols = ix.columns.map(resolve);
    const changed =
      name !== ix.orig_name ||
      ix.unique !== !!ix.orig_unique ||
      JSON.stringify(final_cols) !== JSON.stringify(ix.orig_columns) ||
      idx_extras_changed(ix);
    if (changed && !dropped_idx.has(ix.id))
      ops.push({ kind: "drop_index", table, index: ix.orig_name });
  }
  for (const ix of idxs) {
    if (ix.system || ix.dropped) continue;
    const name = ix.name.trim();
    if (!name || ix.columns.length === 0) continue;
    const is_new = ix.orig_name === null;
    const final_cols = ix.columns.map(resolve);
    const changed =
      !is_new &&
      (name !== ix.orig_name ||
        ix.unique !== !!ix.orig_unique ||
        JSON.stringify(final_cols) !== JSON.stringify(ix.orig_columns) ||
        idx_extras_changed(ix));
    if (is_new || changed) {
      ops.push({
        kind: "create_index",
        table,
        name,
        columns: final_cols,
        ...(ix.unique ? { unique: true } : {}),
        ...(ix.column_dirs.some((d) => d < 0)
          ? { column_dirs: ix.column_dirs }
          : {}),
        ...(ix.sparse ? { sparse: true } : {}),
        ...(ix.ttl_seconds != null ? { ttl_seconds: ix.ttl_seconds } : {}),
        ...(ix.partial_filter.trim()
          ? { partial_filter: ix.partial_filter.trim() }
          : {}),
      });
    }
  }
  return ops;
}

/** Diff drafts against the original schema into an ordered batch of DDL ops:
 *  table rename → column drops → adds → alters → index drops → creates →
 *  trigger drops → creates. `resolve` maps original column names to their
 *  (possibly renamed) final names so index definitions follow renames. */
export function build_ops(
  orig_table: string,
  new_table: string,
  cols: ColDraft[],
  idxs: IdxDraft[],
  resolve: (n: string) => string,
  trigs: TriggerDraft[] = [],
  fks: FkDraft[] = [],
  schema_pk: string[] = [],
): SchemaOp[] {
  const ops: SchemaOp[] = [];
  const T = new_table;
  if (new_table !== orig_table)
    ops.push({ kind: "rename_table", table: orig_table, new_name: new_table });

  for (const c of cols) {
    if (c.dropped && c.orig_name)
      ops.push({ kind: "drop_column", table: T, name: c.orig_name });
  }
  for (const c of cols) {
    if (c.dropped || c.orig_name) continue;
    const name = c.name.trim();
    if (!name) continue;
    ops.push({
      kind: "add_column",
      table: T,
      name,
      data_type: c.data_type.trim(),
      ...(c.not_null ? { not_null: true } : {}),
      ...(c.default_text !== "" ? { default: c.default_text } : {}),
    });
  }
  for (const c of cols) {
    if (c.dropped || !c.orig_name) continue;
    const name = c.name.trim();
    const type_changed = c.data_type.trim() !== (c.orig_data_type ?? "");
    const nn_changed = c.not_null !== !!c.orig_not_null;
    const def_changed = c.default_text !== (c.orig_default ?? "");
    if (!type_changed && !nn_changed && !def_changed && name === c.orig_name)
      continue;
    ops.push({
      kind: "alter_column",
      table: T,
      column: c.orig_name,
      ...(name !== c.orig_name ? { new_name: name } : {}),
      ...(type_changed ? { data_type: c.data_type.trim() } : {}),
      ...(nn_changed ? { not_null: c.not_null } : {}),
      ...(def_changed
        ? {
            default_mode: (c.default_text === ""
              ? "drop"
              : "set") as DefaultMode,
            ...(c.default_text !== "" ? { default_value: c.default_text } : {}),
          }
        : {}),
    });
  }
  ops.push(...build_index_ops(T, idxs, resolve));
  // Triggers last: an edit is a drop + create pair (no ALTER TRIGGER in
  // SQLite); the transactional apply keeps the pair atomic.
  for (const t of trigs) {
    if (t.dropped && t.orig_name)
      ops.push({ kind: "drop_trigger", name: t.orig_name });
  }
  for (const t of trigs) {
    if (t.dropped || !trig_is_dirty(t)) continue;
    if (t.orig_name) ops.push({ kind: "drop_trigger", name: t.orig_name });
    ops.push({ kind: "create_trigger", sql: t.sql.trim() });
  }
  // Primary key: diff selected columns against the loaded key. Runs after
  // column renames so the new names are what PG sees.
  const final_pk = cols
    .filter((c) => !c.dropped && c.primary_key)
    .map((c) => resolve(c.name.trim()))
    .filter(Boolean);
  if (JSON.stringify(final_pk) !== JSON.stringify(schema_pk)) {
    ops.push({ kind: "set_primary_key", table: T, columns: final_pk });
  }
  // Foreign keys: drops first (by constraint name), then additions.
  // PG cannot ALTER a constraint's actions — an action edit on an EXISTING
  // constraint is emitted as a drop + re-add pair (atomic in the batch).
  for (const f of fks) {
    if (!f.dropped && f.orig_name !== null && fk_is_dirty(f)) {
      ops.push({ kind: "drop_constraint", table: T, name: f.orig_name });
    } else if (f.dropped && f.orig_name) {
      ops.push({ kind: "drop_constraint", table: T, name: f.orig_name });
    }
  }
  for (const f of fks) {
    if (f.dropped || !fk_is_dirty(f)) continue;
    const cols2 = f.columns.map(resolve).filter(Boolean);
    if (cols2.length === 0 || !f.ref_table.trim() || f.ref_columns.length === 0)
      continue;
    ops.push({
      kind: "add_foreign_key",
      table: T,
      columns: cols2,
      ref_table: f.ref_table.trim(),
      ref_columns: f.ref_columns,
      ...(f.on_delete ? { on_delete: f.on_delete } : {}),
      ...(f.on_update ? { on_update: f.on_update } : {}),
    });
  }
  return ops;
}
