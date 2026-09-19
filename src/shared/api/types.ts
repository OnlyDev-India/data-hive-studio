// "documentdb" is never what a live `ConnectionInfo` actually reports (a
// DocumentDB connection is opened via `connect_mongodb` like any other
// Mongo server, so `ConnectionInfo.kind` there is genuinely "mongodb") —
// it only appears as a *saved connection's* kind, so the picker remembers
// which entry was chosen. One shared `DbKind` covers both uses rather than
// a second parallel type, mirroring the Rust `DbKind` enum this is typed
// against.
export type DbKind = "sqlite" | "postgres" | "mysql" | "mongodb" | "documentdb";

/** Kinds a saved/local connection can be — everything `DbKind` covers
 *  except "mysql" (no local/saved MySQL support yet). Derive from `DbKind`
 *  rather than re-listing kinds so adding one only means editing `DbKind`. */
export type SavedDbKind = Exclude<DbKind, "mysql">;

/** Kinds a team-server-shared connection can be — `DbKind` minus "mysql"
 *  and "sqlite" (neither is supported as a shared connection). */
export type SharedDbKind = Exclude<DbKind, "mysql" | "sqlite">;

/** How careful to be with a connection (spec 0007). Mirrors the Rust
 *  `ConnGuard`, which flattens these four fields into every struct that saves,
 *  describes or opens a connection. A connection saved before this existed has
 *  none of them: read that as not read only, no label. */
export interface ConnGuard {
  /** Writes are refused by the backend. Fixed for a live connection: changing
   *  it means saving, then reconnecting. */
  read_only?: boolean;
  /** Environment name shown as a chip (Production, Staging, or custom). */
  env_label?: string | null;
  /** Palette key for a custom label's colour. */
  env_color?: string | null;
  /** Ask before every write, even without a Production label. */
  confirm_writes?: boolean;
}

export interface ConnectionInfo extends ConnGuard {
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

/** A category of schema-scoped object the sidebar's catalog tree can list —
 *  one fixed set of rows under every Postgres schema node. MongoDB only ever
 *  returns rows for "table" (its collections); every other kind is empty. */
export type SchemaObjectKind =
  | "table"
  | "view"
  | "materialized_view"
  | "procedure"
  | "function"
  | "sequence"
  | "type";

/** One row in a `listSchemaObjects`/`listRoles` result — `extra` is optional
 *  secondary context shown alongside the name (a function's signature, a
 *  sequence's last value, a role's superuser/login flags). */
export interface SchemaObject {
  name: string;
  extra: string | null;
}

/** Full attribute set for one role (Postgres) — the Users & Privileges tab's
 *  detail panel. `listRoles` stays the short name+summary pair above. */
export interface RoleDetail {
  name: string;
  attributes: string[];
  can_login: boolean;
  superuser: boolean;
  conn_limit: number;
  valid_until: string | null;
  comment: string | null;
  member_of: string[];
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

/** A key-count truncation marker on a wide `FieldShape` object (AC-5):
 *  `shown` of `total` distinct keys were kept. */
export interface FieldKeyTruncation {
  shown: number;
  total: number;
}

/** One node of a MongoDB collection's inferred nested field shape (spec
 *  0001's "Fields" view) — read only, independent of `ColumnInfo`/
 *  `TableSchema` (which stay flat for the data grid's column headers). */
export interface FieldShape {
  /** Last path segment, e.g. "zip" for "address.zip". */
  name: string;
  /** Full dot path from the document root, e.g. "address.zip". */
  path: string;
  /** The single most common BSON type observed at this path ("object",
   *  "array", or a scalar name). Never a union, even for a mixed-type
   *  field — matches the flat schema's existing most-common-type behavior. */
  type: string;
  /** True when present in fewer sampled documents than its parent is, not
   *  the raw sample size — a field always present whenever its parent
   *  exists is not misleadingly optional just because the parent itself
   *  sometimes is not. */
  optional: boolean;
  /** Nested fields, present when `type` is "object", or "array" whose
   *  sampled elements include objects. Absent (not `[]`) when there are
   *  none — the Rust side omits an empty vec from the wire payload. */
  children?: FieldShape[];
  /** Present only when `type` is "array": the union of BSON types observed
   *  among sampled elements. The one place a union appears; `type` itself
   *  never is one. Absent (not `[]`) when there are none. */
  element_types?: string[];
  /** Set when an object's distinct sampled keys exceeded the 50 key cap.
   *  Absent (not `null`) otherwise. */
  truncated?: FieldKeyTruncation;
  /** True when `type` is "object"/"array" but zero keys/elements were
   *  observed across the whole sample. */
  empty: boolean;
  /** True when recursion stopped at the 6 level depth cap, or the global
   *  node budget, even though the real document nests deeper. */
  depth_truncated: boolean;
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
  /** "user" for something the user directly asked for, "app" for work the
   *  app ran on its own (background schema prefetching, etc.) — explicit
   *  per entry rather than inferred from `kind`, since e.g. `kind ===
   *  "schema"` covers both. Absent on entries logged before this field
   *  existed; treat as "user" (the entire log used to be user-only). */
  origin?: string;
  /** Stable identity of the connection this entry belongs to (a file path
   *  for SQLite, kind+name otherwise) — NOT `conn_id`, which is a fresh id
   *  every connect and can't match a past session's entries for the same
   *  database. Absent on entries logged before this field existed, or
   *  logged in the brief window before a brand-new connection registers. */
  conn_key?: string | null;
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
  /** The user stopped this run (spec 0006). Not an error: rows already
   *  streamed stay with the caller. Absent from an older server's reply. */
  cancelled?: boolean;
}

/** How a Stop request ended: `stopped` (the run ended after the cancel),
 *  `winding_down` (no confirmation within 3 seconds, the run was abandoned),
 *  `not_running` (nothing to cancel: unknown, finished, or another
 *  connection's run). */
export type CancelState = "stopped" | "winding_down" | "not_running";

export interface CancelOutcome {
  state: CancelState;
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
    case "documentdb":
      return "Amazon DocumentDB";
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
    | "is_not_null"
    | "in";
  value: string;
  /** Only populated for `op: "in"` — the header quick filter's checked values. */
  values?: string[];
  conjunction?: string;
}

/** One column of a multi-column sort, in priority order (index 0 = primary). */
export interface WireOrderBy {
  column: string;
  dir: "ASC" | "DESC";
}

/** A structured statement request, executed by `executeOp`. */
export type QueryOp =
  | {
      kind: "select";
      table: string;
      filters?: WireFilter[];
      /** Raw WHERE text written by the user; wins over `filters`. */
      custom_where?: string;
      /** Sort keys in priority order; absent/empty = unsorted. */
      order_by?: WireOrderBy[];
      limit?: number;
      offset?: number;
    }
  | {
      kind: "count";
      table: string;
      filters?: WireFilter[];
      custom_where?: string;
    }
  /** Set one column to the same value on every row matching the predicate
   * (same `filters`/`custom_where` shape as `select`) — a real, immediate
   * write, unlike the grid's buffered per-cell edits which only ever touch
   * already-loaded rows. */
  | {
      kind: "bulk_update";
      table: string;
      column: string;
      value: string | null;
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
