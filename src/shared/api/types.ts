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

/** One side of a table comparison. `conn_id` is the live session at pick
 *  time; `conn_key` (see `stableConnKey`) finds it again after a restart. */
export interface TableRef {
  conn_id: string;
  conn_key: string;
  /** Postgres / Mongo; undefined = the connection's own database. */
  database?: string;
  /** Postgres. */
  schema?: string;
  table: string;
}

/** A canonical key value; round trips so a page can resume after it. */
export type KeyVal =
  | { t: "int"; v: string }
  | { t: "num"; v: string }
  | { t: "text"; v: string }
  | { t: "bytes"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "ts"; v: string }
  | { t: "uuid"; v: string }
  | { t: "oid"; v: string }
  | { t: "ejson"; v: string };

export interface CompareDataRequest {
  left: TableRef;
  right: TableRef;
  /** Never empty. */
  key_columns: string[];
  /** Compared columns, key columns excluded. */
  columns: string[];
  filter: string | null;
  /** Resume after this key; null = from the start. */
  after_key: KeyVal[] | null;
  /** True on a first run: read both sides to the end for full counts. */
  count_all: boolean;
  page_size: number;
  run_id: string;
}

/** One difference. `left`/`right` are display text parallel to the
 *  request's `columns`; `changed` indexes into them. */
export interface DiffRow {
  kind: "left_only" | "right_only" | "changed";
  key: KeyVal[];
  key_display: string[];
  left?: (string | null)[];
  right?: (string | null)[];
  changed?: number[];
}

export interface DiffCounts {
  identical: number;
  changed: number;
  left_only: number;
  right_only: number;
}

export interface RowsRead {
  left: number;
  right: number;
}

export type CompareChunk =
  | { type: "rows"; rows: DiffRow[] }
  | { type: "progress"; rows_read: RowsRead; counts: DiffCounts }
  | { type: "page_full"; last_key: KeyVal[] };

export interface CompareSummary {
  status: "done" | "stopped";
  counts: DiffCounts;
  rows_read: RowsRead;
  /** Known only when a first run read both sides to the end. */
  total_diffs: number | null;
  /** Where the next page starts; null on the last page. */
  next_key: KeyVal[] | null;
}

/** What `compareDataToFile` writes: every difference, or a script that makes
 *  the right side's rows match the left's. */
export type CompareFileKind = "csv" | "json" | "sync_script";

export interface CompareFileSummary {
  status: "done" | "stopped";
  /** Differences written; a stopped run writes no file. */
  rows_written: number;
  counts: DiffCounts;
  /** Desktop only: where the file was written. */
  path?: string;
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

/** One schema's tables and foreign keys, for the relation diagram. Mirrors
 *  `api/common/graph.rs`. */
export interface SchemaGraph {
  tables: GraphTable[];
  links: GraphLink[];
}

export interface GraphTable {
  /** Null on SQLite and Mongo. */
  schema: string | null;
  name: string;
  /** A table in another schema, drawn without columns. */
  stub: boolean;
  columns: GraphColumn[];
  /** Mongo: the collection failed to sample. */
  error?: string;
}

export interface GraphColumn {
  name: string;
  data_type: string;
  primary_key: boolean;
  not_null: boolean;
}

/** One foreign key; `from_columns` and `to_columns` pair up by position. */
export interface GraphLink {
  id: string;
  from_schema: string | null;
  from_table: string;
  from_columns: string[];
  to_schema: string | null;
  to_table: string;
  to_columns: string[];
  inferred: boolean;
  on_delete?: string;
  /** The FK columns are the referencing table's primary key or one of its
   *  unique indexes (one to one). Missing from older servers. */
  unique?: boolean;
  /** Mongo: most sampled values of the field are arrays. */
  array?: boolean;
}

export interface SchemaGraphResult {
  graph: SchemaGraph;
  statements: string[];
}

export type MongoGraphEvent =
  | { kind: "start"; total: number; collections: string[] }
  | { kind: "collection"; table: GraphTable; links: GraphLink[] }
  | { kind: "done" }
  | { kind: "error"; message: string };

/** One aggregation builder card as Rust composes it. `body` is the stage
 *  value as relaxed extended JSON text. */
export interface StageSpec {
  id: string;
  op: string;
  body: string;
  enabled: boolean;
  title?: string | null;
  note?: string | null;
  branches?: BranchSpec[];
}

export interface BranchSpec {
  key: string;
  stages: StageSpec[];
}

/** One card read back from pipeline text, with no id yet. */
export interface StageDraft {
  op: string;
  body: string;
  enabled: boolean;
  title: string | null;
  note: string | null;
  branches?: { key: string; stages: StageDraft[] }[];
}

/** Pipeline text as cards, and the collection a shell call names. */
export interface ParsedPipeline {
  collection: string | null;
  stages: StageDraft[];
}

export interface PipelineSpec {
  stages: StageSpec[];
}

export interface StageError {
  stage_id: string;
  branch_key?: string;
  message: string;
}

export interface ComposedPipeline {
  /** Canonical extended JSON array, for driver code. */
  canonical: unknown[];
  shell: string;
  json: string;
  /** The Save format, with title, note and disabled markers. */
  file: string;
  errors: StageError[];
}

export interface PipelinePreviewRequest {
  database: string;
  collection: string;
  spec: PipelineSpec;
  /** Refresh from this card on; null refreshes every card. */
  from: { stage_id: string; branch_key?: string | null } | null;
  cap: number;
  time_ms: number;
  show: number;
  concurrency: number;
  run_id: string | null;
}

/** One card's preview, sent as soon as its query finishes. */
export interface PreviewChunk {
  stage_id: string;
  branch_key?: string;
  count: number;
  columns: string[];
  rows: (string | null)[][];
  documents: unknown[];
  elapsed_ms: number;
  error?: string;
  /** The error is the preview's time limit, not the stage itself. */
  timed_out?: boolean;
}

/** One query builder card's preview query. */
export interface SqlPreviewTarget {
  clause_id: string;
  sql: string;
}

export interface SqlBuilderPreviewRequest {
  database: string | null;
  schema: string | null;
  targets: SqlPreviewTarget[];
  /** Counts the FROM table's rows up to `cap + 1`, for the sampled badge. */
  probe_sql: string | null;
  /** The FROM table and the cap, for the activity entry. */
  table: string;
  cap: number;
  time_ms: number;
  concurrency: number;
  run_id: string | null;
}

/** One card's preview, sent as soon as its query finishes. `count` is every
 *  row the clause put out; `rows` holds at most the shown few. */
export interface SqlPreviewChunk {
  clause_id: string;
  count: number;
  columns: string[];
  rows: (string | null)[][];
  elapsed_ms: number;
  error?: string;
  /** The error is the preview's time limit, not the clause itself. */
  timed_out?: boolean;
}

export interface SqlPreviewSummary {
  cancelled: boolean;
  /** The probe's count, at most `cap + 1`. */
  source_rows: number | null;
}

export interface PreviewSummary {
  cancelled: boolean;
  source_estimate: number | null;
}

export interface PipelineRunRequest {
  database: string;
  collection: string;
  spec: PipelineSpec;
  allow_disk_use: boolean;
  run_id: string | null;
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
  /** A streamed result: how many entries of `rows` are valid. `rows` is one
   *  append only array shared by every update of the run, so its length can
   *  run ahead of what was last handed to the UI. Absent means every entry
   *  counts (`rows.length`). */
  row_count?: number;
}

/** How many rows of `result` are valid, streamed or not. */
export function resultRowCount(result: {
  rows: unknown[];
  row_count?: number;
}): number {
  return result.row_count ?? result.rows.length;
}

/** Which engine's explain produced a plan. Mirrors Rust `PlanDialect`. */
export type PlanDialect = "postgres" | "sqlite" | "mongodb";

/** `estimate` never runs the statement; `analyze` runs it for real timings. */
export type PlanMode = "estimate" | "analyze";

/** One step of a plan, the same shape for every engine. A value the database
 *  does not give is `null` and shows as a dash. Mirrors Rust `PlanNode`. */
export interface PlanNode {
  /** Unique within its tree: the row key. */
  id: number;
  label: string;
  /** Table, index or collection the step reads. Empty when there is none. */
  target: string;
  /** Filters and join conditions, one per line, each with its name. */
  condition: string;
  startup_cost: number | null;
  total_cost: number | null;
  est_rows: number | null;
  /** Analyze only. */
  actual_rows: number | null;
  actual_time_ms: number | null;
  loops: number | null;
  children: PlanNode[];
}

/** The answer to one Explain call, held by one Plan tab. A database error and
 *  a statement Explain does not accept arrive here, not as a thrown error. */
export interface PlanResult {
  dialect: PlanDialect;
  mode: PlanMode;
  /** Exactly the text that was explained. */
  statement: string;
  root: PlanNode | null;
  elapsed_ms: number;
  cancelled: boolean;
  /** The tree was cut at 5000 nodes. */
  truncated: boolean;
  error: string | null;
  /** Why the statement was not sent to the database at all. */
  unsupported: string | null;
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

// ---- Import (spec 0008) ----------------------------------------------------
// Mirrors `crates/dh-core/src/api/common/import.rs`.

/** A parsed, mapped cell. JSON null is SQL NULL. */
export type ImportCell = string | number | boolean | null | object;

/** What to do when some rows fail: commit nothing, or commit the good rows. */
export type ImportOnError = "rollback" | "skip";

export type ImportData =
  | { kind: "rows"; columns: string[]; rows: ImportCell[][] }
  | { kind: "docs"; docs: Record<string, unknown>[] };

export interface ImportRequest {
  table: string;
  /** One `CREATE TABLE`, run first inside the import transaction. */
  create_sql?: string | null;
  data: ImportData;
  on_error: ImportOnError;
  /** Run everything, then always roll back (the Check button). */
  dry_run: boolean;
  run_id?: string | null;
  /** The file name, only for the activity log text. */
  source_label?: string | null;
}

/** One row that did not load. `index` is its position in the rows sent. */
export interface RowFailure {
  index: number;
  column?: string | null;
  message: string;
}

/** What an import can promise: whether a rollback undoes everything. */
export interface ImportCapabilities {
  atomic: boolean;
}

/** How far a local import has got, sent between batches. */
export interface ImportProgress {
  done: number;
  total: number;
}

export interface ImportReport {
  /** Rows that loaded (or, on a rolled back run, would have loaded). */
  inserted: number;
  failed: RowFailure[];
  failed_total: number;
  failed_truncated: boolean;
  committed: boolean;
  atomic: boolean;
  cancelled: boolean;
  dry_run: boolean;
  statements: string[];
}
