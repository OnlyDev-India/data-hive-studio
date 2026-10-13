use serde::{Deserialize, Serialize};

/// One query builder card's preview query.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SqlPreviewTarget {
    pub clause_id: String,
    pub sql: String,
}

/// One query builder refresh: every card from the edited one on, run read
/// only on the first `cap` rows of the FROM table.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SqlBuilderPreviewRequest {
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
    pub targets: Vec<SqlPreviewTarget>,
    /// Counts the FROM table's rows up to `cap + 1`, for the sampled badge.
    #[serde(default)]
    pub probe_sql: Option<String>,
    /// The FROM table and the cap, for the activity entry.
    pub table: String,
    pub cap: u64,
    pub time_ms: u64,
    pub concurrency: u32,
    #[serde(default)]
    pub run_id: Option<String>,
}

/// One card's preview, sent as soon as its query finishes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SqlPreviewChunk {
    pub clause_id: String,
    /// Every row the clause put out, from the `__dh_count` column.
    pub count: u64,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub elapsed_ms: u128,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// The error is the preview's time limit, not the clause itself.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub timed_out: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SqlPreviewSummary {
    pub cancelled: bool,
    /// The probe's count, at most `cap + 1`.
    pub source_rows: Option<u64>,
}
