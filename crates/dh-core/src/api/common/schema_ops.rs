use serde::{Deserialize, Serialize};

/// How an `alter_column` op should treat the column's DEFAULT clause:
/// keep the existing one, set a new literal value, or drop the clause.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DefaultMode {
    Keep,
    Set,
    Drop,
}

/// MySQL column attributes (spec 0025 AC-18) that ride on an add or alter
/// column op. Other engines ignore them. On an alter, `None` keeps what the
/// column has now.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct ColumnAttrs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_increment: Option<bool>,
    /// The `ON UPDATE` expression, e.g. `CURRENT_TIMESTAMP`. `Some("")`
    /// removes it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_update: Option<String>,
    /// `Some("")` removes the comment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

impl ColumnAttrs {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}

/// How one statement of a schema apply ended (spec 0025 AC-19).
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StatementStatus {
    Applied,
    Failed,
    NotRun,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StatementOutcome {
    pub sql: String,
    pub status: StatementStatus,
    /// The server's message, on the failed statement.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Every statement a schema apply planned, in order, with how each ended.
/// An engine that applies the batch in one transaction only ever reports
/// all applied; a failure there is an error instead.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct SchemaApplyReport {
    pub statements: Vec<StatementOutcome>,
}

impl SchemaApplyReport {
    pub fn all_applied(sqls: Vec<String>) -> Self {
        Self {
            statements: sqls
                .into_iter()
                .map(|sql| StatementOutcome { sql, status: StatementStatus::Applied, message: None })
                .collect(),
        }
    }

    pub fn failed(&self) -> Option<&StatementOutcome> {
        self.statements.iter().find(|s| s.status == StatementStatus::Failed)
    }

    pub fn applied(&self) -> Vec<String> {
        self.statements
            .iter()
            .filter(|s| s.status == StatementStatus::Applied)
            .map(|s| s.sql.clone())
            .collect()
    }
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
        #[serde(default, skip_serializing_if = "ColumnAttrs::is_empty")]
        attrs: ColumnAttrs,
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
        #[serde(default, skip_serializing_if = "ColumnAttrs::is_empty")]
        attrs: ColumnAttrs,
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
    /// Change a table's default charset, collation or comment (MySQL).
    /// `None` keeps the current value; an empty comment removes it.
    SetTableOptions {
        table: String,
        #[serde(default)]
        charset: Option<String>,
        #[serde(default)]
        collation: Option<String>,
        #[serde(default)]
        comment: Option<String>,
    },
}
