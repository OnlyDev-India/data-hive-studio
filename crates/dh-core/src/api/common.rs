use serde::{Deserialize, Serialize};

/// The kind of database a connection is talking to. Extend this enum to add
/// support for more databases.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DbKind {
    Sqlite,
    #[allow(dead_code)]
    Postgres,
    #[allow(dead_code)]
    Mysql,
    #[allow(dead_code)]
    Mongodb,
}

impl DbKind {
    pub fn pretty(self) -> &'static str {
        match self {
            DbKind::Sqlite => "SQLite",
            DbKind::Postgres => "PostgreSQL",
            DbKind::Mysql => "MySQL",
            DbKind::Mongodb => "MongoDB",
        }
    }
}

impl Default for DbKind {
    /// Every shared team-server connection predates the `kind` column and
    /// was Postgres — this is the correct default for backfilling those rows
    /// and for JSON payloads that omit the field.
    fn default() -> Self {
        DbKind::Postgres
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TableInfo {
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub not_null: bool,
    pub primary_key: bool,
    pub default: Option<String>,
    /// Postgres native enums: allowed labels (empty otherwise).
    #[serde(default)]
    pub enum_values: Vec<String>,
    /// Postgres only: true when the column is an array type (e.g. `text[]`,
    /// `permission[]`). The frontend can then offer array-aware editing; when
    /// the array's element type is a native enum, `enum_values` holds its
    /// labels and `data_type` is the element type followed by `[]`.
    #[serde(default)]
    pub is_array: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ForeignKeyInfo {
    pub column: String,
    pub referenced_table: String,
    pub referenced_column: String,
    /// Constraint name (Postgres). SQLite FKs are unnamed — dropping them
    /// requires a table rebuild, so the UI treats them as system-managed.
    #[serde(default)]
    pub name: Option<String>,
    /// Referential actions as stored (Postgres). Null on SQLite.
    #[serde(default)]
    pub on_delete: Option<String>,
    #[serde(default)]
    pub on_update: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IndexInfo {
    pub name: String,
    pub unique: bool,
    pub columns: Vec<String>,
    /// Why the index exists: 'c' = explicit CREATE INDEX (editable), 'u' =
    /// UNIQUE table constraint, 'pk' = PRIMARY KEY constraint. Constraint-
    /// backed indexes cannot be dropped or altered directly in SQLite —
    /// the UI must treat them as read-only.
    pub origin: String,
    /// MongoDB only: per-column sort direction (1 = ascending, -1 =
    /// descending), parallel to `columns`. `None`/absent means all-ascending
    /// (or not applicable — SQL adapters don't report this).
    #[serde(default)]
    pub column_dirs: Option<Vec<i8>>,
    /// MongoDB only: a sparse index skips documents missing the indexed
    /// field(s).
    #[serde(default)]
    pub sparse: Option<bool>,
    /// MongoDB only: TTL index — documents expire this many seconds after
    /// the indexed (date) field's value.
    #[serde(default)]
    pub ttl_seconds: Option<u64>,
    /// MongoDB only: partial index filter, as MQL extended JSON text — only
    /// documents matching it are indexed.
    #[serde(default)]
    pub partial_filter: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct TableSchema {
    /// What this object is: "table", "view", "matview" (Postgres). Empty on
    /// older payloads — callers treat that as "table".
    #[serde(default)]
    pub kind: String,
    pub columns: Vec<ColumnInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub indexes: Vec<IndexInfo>,
    pub triggers: Vec<TriggerInfo>,
}

/// One trigger defined on a table. SQLite has no ALTER TRIGGER — a trigger's
/// identity is its SQL text, so it is surfaced read-only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TriggerInfo {
    pub name: String,
    /// BEFORE / AFTER / INSTEAD OF (parsed from the SQL, may be empty).
    pub timing: String,
    /// INSERT / UPDATE / DELETE (parsed from the SQL, may be empty).
    pub event: String,
    /// Full original CREATE TRIGGER statement.
    pub sql: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub rows_affected: u64,
    pub is_select: bool,
    pub error: Option<String>,
    pub elapsed_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConnectionInfo {
    pub id: String,
    pub name: String,
    pub kind: DbKind,
    /// Real file path this connection was opened from (or saved to). `None`
    /// for databases that only exist in-memory/temp (e.g. freshly created).
    #[serde(default)]
    pub source_path: Option<String>,
}

/// One streamed batch of SELECT rows pushed to the frontend over an IPC
/// channel while a large result is still being read. The first chunk carries
/// the column names (known from preparing the statement); later chunks carry
/// only rows.
#[derive(Debug, Clone, Serialize)]
pub struct QueryChunk {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub columns: Option<Vec<String>>,
    pub rows: Vec<Vec<Option<String>>>,
}

// ---- Structured operations -------------------------------------------------
//
// The frontend never writes SQL for CRUD/browse operations. It describes WHAT
// it wants with a [`QueryOp`]; the connection's adapter decides HOW to say it
// in its dialect. Adding a new database means adding an adapter, not touching
// UI code.

/// Comparison operator for one filter condition (mirrors the UI filter bar).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FilterOp {
    Eq,
    Neq,
    Contains,
    StartsWith,
    EndsWith,
    Gt,
    Gte,
    Lt,
    Lte,
    IsNull,
    IsNotNull,
}

/// One filter condition as sent by the UI filter bar.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GridFilterCond {
    pub column: String,
    pub op: FilterOp,
    pub value: String,
    /// How this condition combines with the previous one. Defaults to AND.
    #[serde(default)]
    pub conjunction: Option<String>,
}

/// A structured statement request. Values are always bound as `?` parameters
/// by the adapter — user input is never interpolated into SQL.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum QueryOp {
    /// Read a page of rows from a table.
    Select {
        table: String,
        #[serde(default)]
        filters: Vec<GridFilterCond>,
        /// Raw WHERE text written by the user; wins over `filters`.
        #[serde(default)]
        custom_where: Option<String>,
        #[serde(default)]
        order_by: Option<String>,
        #[serde(default)]
        order_dir: Option<String>,
        #[serde(default)]
        limit: Option<i64>,
        #[serde(default)]
        offset: Option<i64>,
    },
    /// Count rows matching the same predicate as [`QueryOp::Select`].
    Count {
        table: String,
        #[serde(default)]
        filters: Vec<GridFilterCond>,
        #[serde(default)]
        custom_where: Option<String>,
    },
    /// Bounded distinct values of one column (dropdown editors/filters).
    SelectDistinct {
        table: String,
        column: String,
        #[serde(default)]
        limit: Option<i64>,
    },
    /// Insert one row. With `skip_empty`, columns whose value is null/''
    /// are left out so the database applies defaults/autoincrement; if no
    /// columns remain, a DEFAULT VALUES insert is produced instead.
    Insert {
        table: String,
        values: std::collections::BTreeMap<String, Option<String>>,
        #[serde(default)]
        skip_empty: bool,
    },
    /// Update rows whose stored values equal `match_row` (the full original
    /// row). Matching every column keeps the target stable even when the edit
    /// itself changes key columns, and works on tables without a primary key.
    Update {
        table: String,
        set: std::collections::BTreeMap<String, Option<String>>,
        match_row: std::collections::BTreeMap<String, Option<String>>,
    },
    /// Delete rows whose stored values equal `match_row` (the full original
    /// row), so deletes also work without a primary key.
    Delete {
        table: String,
        match_row: std::collections::BTreeMap<String, Option<String>>,
    },
    DropTable { table: String },
}

/// How an `alter_column` op should treat the column's DEFAULT clause:
/// keep the existing one, set a new literal value, or drop the clause.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DefaultMode {
    Keep,
    Set,
    Drop,
}

/// A structured schema (DDL) change request. Like [`QueryOp`], the frontend
/// describes WHAT should change; the adapter decides how to say it in its
/// dialect (including falling back to a full table rebuild when SQLite has no
/// in-place ALTER for the requested change). Each op executes to completion —
/// the adapter returns every statement it ran so the UI can show it.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SchemaOp {
    RenameTable { table: String, new_name: String },
    /// Append a new column. Note: SQLite cannot add a NOT NULL column without
    /// a DEFAULT to a non-empty table; the database's own error is surfaced.
    AddColumn {
        table: String,
        name: String,
        data_type: String,
        #[serde(default)]
        not_null: bool,
        #[serde(default)]
        default: Option<String>,
    },
    DropColumn { table: String, name: String },
    /// Change one existing column. Fields left as `null` keep their current
    /// value; if only the name differs from the stored definition this runs a
    /// cheap `ALTER TABLE ... RENAME COLUMN`, otherwise the table is rebuilt
    /// (new CREATE TABLE → copy rows → drop old → rename back → recreate
    /// indexes).
    AlterColumn {
        table: String,
        /// Current column name (the edit target).
        column: String,
        #[serde(default)]
        new_name: Option<String>,
        #[serde(default)]
        data_type: Option<String>,
        #[serde(default)]
        not_null: Option<bool>,
        #[serde(default)]
        default_mode: Option<DefaultMode>,
        /// Literal for [`DefaultMode::Set`] (already normalized by the caller).
        #[serde(default)]
        default_value: Option<String>,
    },
    CreateIndex {
        table: String,
        name: String,
        columns: Vec<String>,
        #[serde(default)]
        unique: bool,
        /// MongoDB only: per-column sort direction (1/-1), parallel to
        /// `columns`. SQL adapters ignore this (always ascending).
        #[serde(default)]
        column_dirs: Option<Vec<i8>>,
        /// MongoDB only: sparse index. SQL adapters ignore this.
        #[serde(default)]
        sparse: Option<bool>,
        /// MongoDB only: TTL index expiry in seconds. SQL adapters ignore
        /// this.
        #[serde(default)]
        ttl_seconds: Option<u64>,
        /// MongoDB only: partial index filter (MQL extended JSON text). SQL
        /// adapters ignore this.
        #[serde(default)]
        partial_filter: Option<String>,
    },
    DropIndex {
        /// Index names are unique per database file in SQLite (and per
        /// schema in Postgres) — those adapters ignore `table`. MongoDB
        /// index names are only unique per collection, so Mongo requires it.
        #[serde(default)]
        table: Option<String>,
        index: String,
    },
    /// Remove a trigger. SQLite has no ALTER TRIGGER — editing is always a
    /// drop + create pair (safe inside one transaction).
    DropTrigger {
        name: String,
    },
    /// Create a trigger from its full CREATE TRIGGER statement, executed
    /// verbatim (single statement — body through END included).
    CreateTrigger {
        sql: String,
    },
    /// Replace the table's PRIMARY KEY with exactly these columns. An empty
    /// list drops the key. Postgres only (SQLite needs a table rebuild).
    SetPrimaryKey {
        table: String,
        #[serde(default)]
        columns: Vec<String>,
    },
    /// Add a foreign-key constraint (Postgres only).
    AddForeignKey {
        table: String,
        columns: Vec<String>,
        ref_table: String,
        ref_columns: Vec<String>,
        /// CASCADE | SET NULL | SET DEFAULT | RESTRICT | NO ACTION
        #[serde(default)]
        on_delete: Option<String>,
        #[serde(default)]
        on_update: Option<String>,
    },
    /// Drop a named constraint (Postgres; covers FK constraints).
    DropConstraint {
        table: String,
        name: String,
    },
}