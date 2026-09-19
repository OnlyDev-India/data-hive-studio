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
    /// Amazon DocumentDB — speaks the MongoDB wire protocol, so it's
    /// connected to identically to `Mongodb` (see `server::vault`'s
    /// `conn_secret_params`, which maps both to the same
    /// `AdapterParams::Mongodb`). Kept as a distinct variant purely so a
    /// saved connection remembers which picker entry it was created from.
    #[allow(dead_code)]
    DocumentDb,
}

impl DbKind {
    pub fn pretty(self) -> &'static str {
        match self {
            DbKind::Sqlite => "SQLite",
            DbKind::Postgres => "PostgreSQL",
            DbKind::Mysql => "MySQL",
            DbKind::Mongodb => "MongoDB",
            DbKind::DocumentDb => "Amazon DocumentDB",
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

/// A key's distinct-count truncation marker on a wide `FieldShape` object
/// (spec 0001, AC-5): `shown` of `total` distinct keys were kept.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FieldKeyTruncation {
    pub shown: u32,
    pub total: u32,
}

/// One node of a MongoDB collection's inferred nested field shape (spec
/// 0001), read only and independent of `ColumnInfo`/`TableSchema` (which
/// stay flat for the data grid's column headers, see `MongoAdapter::field_tree`
/// for the sampling that builds this).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FieldShape {
    /// Last path segment, e.g. `"zip"` for `address.zip`.
    pub name: String,
    /// Full dot path from the document root, e.g. `"address.zip"`.
    pub path: String,
    /// The single most common BSON type observed at this path ("object",
    /// "array", or a scalar name). Never a union — a mixed-type field still
    /// reports only its most common type, matching `inferred_schema`'s
    /// existing top-level behavior.
    #[serde(rename = "type")]
    pub bson_type: String,
    /// True when present in fewer sampled documents than its parent is
    /// (`present_count(path) < present_count(parent_path)`, where
    /// `present_count(root)` is the sample size) — NOT the raw sample size,
    /// so a field always present whenever its parent exists is not
    /// misleadingly optional just because the parent itself sometimes is not.
    pub optional: bool,
    /// Nested fields, present when `bson_type` is "object", or "array" whose
    /// sampled elements include objects.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<FieldShape>,
    /// Present only when `bson_type` is "array": the union of BSON types
    /// observed among sampled elements (e.g. `["object", "string"]`). The
    /// one place a union appears; `bson_type` itself never is one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub element_types: Vec<String>,
    /// Set when an object's distinct sampled keys exceeded the 50 key cap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncated: Option<FieldKeyTruncation>,
    /// True when `bson_type` is "object"/"array" but zero keys/elements were
    /// observed across the whole sample.
    #[serde(default)]
    pub empty: bool,
    /// True when recursion stopped at the 6 level depth cap, or the global
    /// node budget, even though the real document nests deeper.
    #[serde(default)]
    pub depth_truncated: bool,
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
    /// The user stopped this run (spec 0006). Not an error: rows already
    /// streamed stay with the caller. Absent from an older server's reply.
    #[serde(default)]
    pub cancelled: bool,
}

/// How careful to be with a connection (spec 0007). Travels as one unit
/// through every place a connection is saved, described or opened, flattened
/// into the owning struct so the wire shape stays four plain fields.
/// Adapters read only `read_only`; the other three pass through to
/// [`ConnectionInfo`] for the UI to display.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ConnGuard {
    /// Writes are refused, not just warned about. Fixed for the life of an
    /// adapter: changing it means a new connection.
    #[serde(default)]
    pub read_only: bool,
    /// Environment name shown as a chip (Production, Staging, or custom).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_label: Option<String>,
    /// Palette key for a custom label's colour (presets ignore it).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env_color: Option<String>,
    /// Ask before every write, even without a Production label.
    #[serde(default)]
    pub confirm_writes: bool,
}

/// The palette keys a custom environment label may use. Keep in step with
/// `ENV_COLORS` in `src/shared/api/env.ts` and the `--env-*` variables in
/// `src/index.css`.
pub const ENV_COLOR_KEYS: [&str; 8] = [
    "red", "orange", "amber", "green", "teal", "blue", "purple", "grey",
];

/// Longest environment label, in characters.
pub const ENV_LABEL_MAX_CHARS: usize = 24;

impl ConnGuard {
    /// Check the label and colour before a connection is saved and return the
    /// tidy copy to store: the label is trimmed and an empty one becomes
    /// none, and an empty colour becomes none. A label longer than
    /// [`ENV_LABEL_MAX_CHARS`] or a colour outside [`ENV_COLOR_KEYS`] is an
    /// error, so a bad value never reaches the saved file (spec 0007).
    pub fn normalized(mut self) -> Result<Self, String> {
        self.env_label = match self.env_label.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(label) if label.chars().count() > ENV_LABEL_MAX_CHARS => {
                return Err(format!(
                    "Environment label must be {ENV_LABEL_MAX_CHARS} characters or fewer."
                ));
            }
            Some(label) => Some(label.to_string()),
        };
        self.env_color = match self.env_color.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(key) if ENV_COLOR_KEYS.contains(&key) => Some(key.to_string()),
            Some(key) => {
                return Err(format!(
                    "Unknown environment colour \"{key}\". Pick one of: {}.",
                    ENV_COLOR_KEYS.join(", ")
                ));
            }
        };
        Ok(self)
    }
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
    #[serde(flatten)]
    pub guard: ConnGuard,
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
    /// Column value is one of `GridFilterCond::values` — the header's own
    /// Excel-style distinct-value checkbox quick filter. An empty `values`
    /// matches nothing (all boxes unchecked), same as Excel.
    In,
}

/// One filter condition as sent by the UI filter bar.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GridFilterCond {
    pub column: String,
    pub op: FilterOp,
    pub value: String,
    /// Only populated for `FilterOp::In` — the checked values. NULL is
    /// deliberately not selectable here (that's what `is_null`/`is_not_null`
    /// are for), so these are always non-null.
    #[serde(default)]
    pub values: Vec<String>,
    /// How this condition combines with the previous one. Defaults to AND.
    #[serde(default)]
    pub conjunction: Option<String>,
}

/// One column of a multi-column sort, in priority order (index 0 = primary).
/// `dir` is a loose string (`"DESC"` else ascending), matching how the old
/// single-column `order_dir` was already compared — no enum needed since
/// every adapter just checks `== "DESC"`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OrderByCond {
    pub column: String,
    pub dir: String,
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
        /// Sort keys in priority order; empty = unsorted.
        #[serde(default)]
        order_by: Vec<OrderByCond>,
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
    /// Set one column to the same value on every row matching the predicate
    /// (same `filters`/`custom_where` shape as [`QueryOp::Select`]) — a real,
    /// immediate write (UPDATE / Mongo `updateMany`), unlike the grid's
    /// buffered per-cell edits which only ever touch already-loaded rows.
    BulkUpdate {
        table: String,
        column: String,
        value: Option<String>,
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

impl QueryOp {
    /// True for the ops that only read (select, count, distinct values).
    /// Everything else changes data or schema. The team server gateway uses
    /// this to decide which role an op needs, and a read only connection uses
    /// it to decide what to refuse (spec 0007).
    pub fn is_read(&self) -> bool {
        matches!(
            self,
            QueryOp::Select { .. } | QueryOp::Count { .. } | QueryOp::SelectDistinct { .. }
        )
    }

    /// A fixed, human name for a write op, for the read only refusal
    /// ("Read only connection: row update is not allowed."). Reads have none.
    pub fn write_name(&self) -> &'static str {
        match self {
            QueryOp::BulkUpdate { .. } => "bulk update",
            QueryOp::Insert { .. } => "row insert",
            QueryOp::Update { .. } => "row update",
            QueryOp::Delete { .. } => "row delete",
            QueryOp::DropTable { .. } => "drop table",
            QueryOp::Select { .. } | QueryOp::Count { .. } | QueryOp::SelectDistinct { .. } => "read",
        }
    }
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
#[derive(Debug, Clone, Deserialize, Serialize)]
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
#[cfg(test)]
mod conn_guard_tests {
    use super::*;

    /// AC-1: a connection saved before spec 0007 has none of the four keys
    /// and loads as not read only, no label.
    #[test]
    fn legacy_connection_info_loads_with_a_default_guard() {
        let info: ConnectionInfo =
            serde_json::from_str(r#"{"id":"a","name":"db","kind":"postgres"}"#).unwrap();
        assert_eq!(info.guard, ConnGuard::default());
        assert!(!info.guard.read_only);
        assert_eq!(info.guard.env_label, None);
        assert!(!info.guard.confirm_writes);
    }

    fn guard_with(label: Option<&str>, color: Option<&str>) -> ConnGuard {
        ConnGuard {
            env_label: label.map(str::to_string),
            env_color: color.map(str::to_string),
            ..ConnGuard::default()
        }
    }

    #[test]
    fn normalized_trims_the_label_and_drops_empty_values() {
        let g = guard_with(Some("  Staging EU  "), Some("")).normalized().unwrap();
        assert_eq!(g.env_label.as_deref(), Some("Staging EU"));
        assert_eq!(g.env_color, None);
        let g = guard_with(Some("   "), None).normalized().unwrap();
        assert_eq!(g.env_label, None);
    }

    #[test]
    fn normalized_accepts_exactly_24_characters_and_refuses_25() {
        let ok = "a".repeat(ENV_LABEL_MAX_CHARS);
        assert!(guard_with(Some(&ok), None).normalized().is_ok());
        let too_long = "a".repeat(ENV_LABEL_MAX_CHARS + 1);
        assert!(guard_with(Some(&too_long), None).normalized().is_err());
        // Characters, not bytes: 24 multi byte characters still fit.
        let wide = "é".repeat(ENV_LABEL_MAX_CHARS);
        assert!(guard_with(Some(&wide), None).normalized().is_ok());
    }

    #[test]
    fn normalized_refuses_a_colour_outside_the_palette() {
        for key in ENV_COLOR_KEYS {
            assert!(guard_with(Some("x"), Some(key)).normalized().is_ok(), "{key}");
        }
        let err = guard_with(Some("x"), Some("hotpink")).normalized().unwrap_err();
        assert!(err.contains("hotpink"), "{err}");
    }

    #[test]
    fn normalized_leaves_the_flags_alone() {
        let g = ConnGuard { read_only: true, confirm_writes: true, ..ConnGuard::default() };
        assert_eq!(g.clone().normalized().unwrap(), g);
    }

    /// The guard is flattened, so the wire shape is four plain fields next
    /// to `id`/`name`/`kind`, and unset label fields are left out.
    #[test]
    fn guard_fields_sit_flat_on_the_wire() {
        let info = ConnectionInfo {
            id: "a".into(),
            name: "db".into(),
            kind: DbKind::Postgres,
            source_path: None,
            guard: ConnGuard {
                read_only: true,
                env_label: Some("Production".into()),
                env_color: None,
                confirm_writes: true,
            },
        };
        let v = serde_json::to_value(&info).unwrap();
        assert_eq!(v["read_only"], true);
        assert_eq!(v["env_label"], "Production");
        assert_eq!(v["confirm_writes"], true);
        assert!(v.get("env_color").is_none());
        assert!(v.get("guard").is_none());

        let back: ConnectionInfo = serde_json::from_value(v).unwrap();
        assert_eq!(back, info);
    }
}
