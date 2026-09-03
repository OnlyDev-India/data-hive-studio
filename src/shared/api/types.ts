export type DbKind = "sqlite" | "postgres" | "mysql" | "mongodb";

export interface ConnectionInfo {
  id: string;
  name: string;
  kind: DbKind;
  /** Real file path this connection was opened from (or saved to). Null for
   *  freshly created databases that only live in a temp file. */
  source_path?: string | null;
}

export interface TableInfo {
  name: string;
  kind: string;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  not_null: boolean;
  primary_key: boolean;
  default: string | null;
  /** Postgres native enums: allowed labels. */
  enum_values?: string[];
  /** Postgres only: true when the column is an array type. */
  is_array?: boolean;
}

export interface ForeignKeyInfo {
  column: string;
  referenced_table: string;
  referenced_column: string;
  /** Constraint name (Postgres). Null on SQLite — those FKs are system-
   *  managed and cannot be dropped in place. */
  name?: string | null;
  /** Current referential actions (Postgres). */
  on_delete?: string | null;
  on_update?: string | null;
}

/** Sidebar bootstrap for a Postgres connection — one catalog round trip. */
export interface CatalogOverview {
  schemas: string[];
  databases: string[];
  active_schema: string;
}

/** One minted token (adm_ or tem_). */
export interface TokenGrantSpec {
  conn_id: string;
  can_read: boolean;
  can_update: boolean;
  can_delete: boolean;
}

export interface TokenInfo {
  token: string;
  prefix: string;
  user_name: string;
  team_name: string | null;
  created_ms: number;
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
  /** 'c' = explicit CREATE INDEX, 'u' = UNIQUE constraint, 'pk' = PRIMARY KEY.
   *  Constraint-backed ('u'/'pk') indexes are read-only in the designer. */
  origin: string;
  /** MongoDB only: per-column sort direction (1 = asc, -1 = desc), parallel
   *  to `columns`. Absent on SQL adapters. */
  column_dirs?: number[] | null;
  /** MongoDB only: sparse index. */
  sparse?: boolean | null;
  /** MongoDB only: TTL index — seconds after which documents expire. */
  ttl_seconds?: number | null;
  /** MongoDB only: partial index filter (MQL extended JSON text). */
  partial_filter?: string | null;
}

export interface TableSchema {
  /** "table" | "view" | "matview" (Postgres). Absent/empty on older
   *  payloads — treat as "table". */
  kind?: string;
  columns: ColumnInfo[];
  foreign_keys: ForeignKeyInfo[];
  indexes: IndexInfo[];
  triggers: TriggerInfo[];
}

/** One executed backend command, pushed live via the `activity://entry`
 *  event and hydratable through get_activity. */
export interface ActivityEntry {
  id: number;
  /** Wall-clock epoch ms — rendered as HH:MM:SS. */
  ts_ms: number;
  conn_id: string;
  /** select | count | distinct | insert | update | delete | drop_table |
   *  sql | ddl | duplicate | schema | connect | disconnect */
  kind: string;
  /** Table name / SQL first line / database label — what was touched. */
  target: string;
  ok: boolean;
  rows: number;
  duration_ms: number;
  error: string | null;
  /** Full statement text for `sql` entries (multi-line, comments kept). */
  sql?: string | null;
}

/** One trigger on a table (read-only — SQLite has no ALTER TRIGGER). */
export interface TriggerInfo {
  name: string;
  /** BEFORE / AFTER / INSTEAD OF (parsed from the SQL, may be empty). */
  timing: string;
  /** INSERT / UPDATE / DELETE (parsed from the SQL, may be empty). */
  event: string;
  /** Full original CREATE TRIGGER statement. */
  sql: string;
}

export interface QueryResult {
  columns: string[];
  rows: (string | null)[][];
  rows_affected: number;
  is_select: boolean;
  error: string | null;
  elapsed_ms: number;
}

export function prettyKind(kind: DbKind): string {
  switch (kind) {
    case "sqlite":
      return "SQLite";
    case "postgres":
      return "PostgreSQL";
    case "mysql":
      return "MySQL";
    case "mongodb":
      return "MongoDB";
  }
}

/** Quote an identifier (table/column name) for use in a SQL statement. */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Build the `LIMIT x OFFSET y` args from (page, page_size). */
export function paginationClause(
  page: number,
  pageSize: number,
): { limit: number; offset: number } {
  return { limit: pageSize, offset: page * pageSize };
}

// ---- Structured operations -------------------------------------------------
//
// The frontend never writes SQL for CRUD/browse operations. It describes WHAT
// it wants with a QueryOp; the connection's backend adapter decides HOW to
// say it in its dialect. Values are always bound as `?` parameters.

/** One filter condition as understood by the UI filter bar. */
export interface WireFilter {
  column: string;
  op:
    | "eq"
    | "neq"
    | "contains"
    | "starts_with"
    | "ends_with"
    | "gt"
    | "gte"
    | "lt"
    | "lte"
    | "is_null"
    | "is_not_null";
  value: string;
  conjunction?: string;
}

/** A structured statement request, executed by `executeOp`. */
export type QueryOp =
  | {
      kind: "select";
      table: string;
      filters?: WireFilter[];
      /** Raw WHERE text written by the user; wins over `filters`. */
      custom_where?: string;
      order_by?: string;
      order_dir?: "ASC" | "DESC";
      limit?: number;
      offset?: number;
    }
  | {
      kind: "count";
      table: string;
      filters?: WireFilter[];
      custom_where?: string;
    }
  | { kind: "select_distinct"; table: string; column: string; limit?: number }
  /** With `skip_empty`, columns whose value is null/'' are left out so the
   * database applies defaults/autoincrement; if none remain, a DEFAULT
   * VALUES insert is produced instead. */
  | {
      kind: "insert";
      table: string;
      values: Record<string, string | null>;
      skip_empty?: boolean;
    }
  /** Update rows whose stored values equal `match_row` (the full original
   * row). Matching every column keeps the target stable even when the edit
   * changes key columns, and works on tables without a primary key. */
  | {
      kind: "update";
      table: string;
      set: Record<string, string | null>;
      match_row: Record<string, string | null>;
    }
  /** Delete rows whose stored values equal `match_row` (the full original
   * row), so deletes also work without a primary key. */
  | { kind: "delete"; table: string; match_row: Record<string, string | null> }
  | { kind: "drop_table"; table: string };

// ---- Structured schema (DDL) operations -------------------------------------
//
// Same principle as QueryOp: the frontend describes WHAT should change; the
// backend adapter builds the dialect SQL (including a table rebuild when the
// dialect has no in-place ALTER). Applied in order by `applySchemaOps`.

/** How alter_column treats the column's DEFAULT clause. */
export type DefaultMode = "keep" | "set" | "drop";

export type SchemaOp =
  | { kind: "rename_table"; table: string; new_name: string }
  /** SQLite cannot add NOT NULL without DEFAULT to a non-empty table; the
   * database's own error is surfaced if attempted. */
  | {
      kind: "add_column";
      table: string;
      name: string;
      data_type: string;
      not_null?: boolean;
      default?: string | null;
    }
  | { kind: "drop_column"; table: string; name: string }
  /** Fields left undefined keep their current value; only-name changes run a
   * cheap RENAME COLUMN, anything else rebuilds the table server-side. */
  | {
      kind: "alter_column";
      table: string;
      column: string;
      new_name?: string;
      data_type?: string;
      not_null?: boolean;
      default_mode?: DefaultMode;
      /** Literal for default_mode 'set' (normalized backend-side). */
      default_value?: string | null;
    }
  | {
      kind: "create_index";
      table: string;
      name: string;
      columns: string[];
      unique?: boolean;
      /** MongoDB only: per-column sort direction (1/-1), parallel to
       *  `columns`. SQL adapters ignore this (always ascending). */
      column_dirs?: number[];
      /** MongoDB only: sparse index. SQL adapters ignore this. */
      sparse?: boolean;
      /** MongoDB only: TTL index expiry in seconds. SQL adapters ignore this. */
      ttl_seconds?: number;
      /** MongoDB only: partial index filter (MQL extended JSON text). SQL
       *  adapters ignore this. */
      partial_filter?: string;
    }
  /** `table` is required for MongoDB (index names are only unique per
   *  collection there); SQLite/Postgres ignore it (unique per file/schema). */
  | { kind: "drop_index"; table?: string; index: string }
  /** SQLite has no ALTER TRIGGER — edits run as a drop + create pair. */
  | { kind: "drop_trigger"; name: string }
  /** Full CREATE TRIGGER statement, executed verbatim. */
  | { kind: "create_trigger"; sql: string }
  /** Replace the PRIMARY KEY with exactly these columns ([] = drop).
   *  Postgres only — SQLite needs a table rebuild. */
  | { kind: "set_primary_key"; table: string; columns?: string[] }
  /** Add a foreign-key constraint (Postgres only). */
  | {
      kind: "add_foreign_key";
      table: string;
      columns: string[];
      ref_table: string;
      ref_columns: string[];
      on_delete?: string;
      on_update?: string;
    }
  /** Drop a named constraint (Postgres; covers FK constraints). */
  | { kind: "drop_constraint"; table: string; name: string };
/** Snapshot of a grid's rows, captured by the data-export feature. Lives in
 *  shared/api because the store's GridBridge hands it to the export menu. */
export interface ExportPayload {
  /** Table name (empty for arbitrary query results). */
  table: string;
  columns: string[];
  rows: (string | null)[][];
  /** Declared column types ("INTEGER", "BOOLEAN", …) for typed output. */
  types?: Record<string, string>;
}
