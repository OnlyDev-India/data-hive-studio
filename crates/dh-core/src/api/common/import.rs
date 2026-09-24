//! Wire types for importing rows into a table or collection (spec 0008).
//!
//! The app parses, maps and checks the file, then sends every row in one
//! [`ImportRequest`]; the adapter writes them in one transaction and answers
//! with one [`ImportReport`].

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// What to do when some rows fail.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ImportOnError {
    /// Commit only if no row failed.
    #[default]
    Rollback,
    /// Commit the good rows and report the bad ones.
    Skip,
}

/// The rows to write: positional for SQL, documents for Mongo.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ImportData {
    Rows {
        columns: Vec<String>,
        rows: Vec<Vec<Value>>,
    },
    Docs {
        docs: Vec<Map<String, Value>>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ImportRequest {
    pub table: String,
    /// One `CREATE TABLE`, run first inside the same transaction (SQL only).
    #[serde(default)]
    pub create_sql: Option<String>,
    pub data: ImportData,
    #[serde(default)]
    pub on_error: ImportOnError,
    /// Run everything, then always roll back (the Check button).
    #[serde(default)]
    pub dry_run: bool,
    /// Lets Cancel find this import in the run registry (spec 0006).
    #[serde(default)]
    pub run_id: Option<String>,
    /// The file name, only used for the activity log text.
    #[serde(default)]
    pub source_label: Option<String>,
}

/// One row that did not load. `index` is its position in the rows sent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RowFailure {
    pub index: u32,
    #[serde(default)]
    pub column: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ImportReport {
    /// Rows that loaded (or, on a rolled back run, would have loaded).
    pub inserted: u64,
    /// The first failures, at most [`MAX_KEPT_FAILURES`].
    pub failed: Vec<RowFailure>,
    pub failed_total: u64,
    pub failed_truncated: bool,
    /// The transaction committed. False for Check, Cancel and a Roll back
    /// import that had a bad row.
    pub committed: bool,
    /// Whether a rollback would have undone everything (SQL: always).
    pub atomic: bool,
    pub cancelled: bool,
    pub dry_run: bool,
    pub statements: Vec<String>,
}

/// How far a local import has got, sent between batches (spec 0008). `done`
/// counts rows tried, loaded or failed.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportProgress {
    pub done: u64,
    pub total: u64,
}

/// What a connection can promise about an import (spec 0008).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ImportCapabilities {
    /// A rollback undoes the whole import. SQL is always true. Mongo is true
    /// only on a replica set or a sharded cluster.
    pub atomic: bool,
}

/// Failures beyond this are counted but not kept.
pub const MAX_KEPT_FAILURES: usize = 10_000;
