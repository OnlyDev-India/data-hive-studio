use serde::{Deserialize, Serialize};

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
