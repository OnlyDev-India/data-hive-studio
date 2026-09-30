use serde::{Deserialize, Serialize};

/// One side of a table comparison.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableRef {
    pub conn_id: String,
    #[serde(default)]
    pub conn_key: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
    pub table: String,
}

/// A canonical key value. It round trips, so a page can resume after it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", content = "v", rename_all = "snake_case")]
pub enum KeyVal {
    Int(String),
    Num(String),
    Text(String),
    /// Base64.
    Bytes(String),
    Bool(bool),
    /// UTC, RFC 3339.
    Ts(String),
    Uuid(String),
    Oid(String),
    /// Any other value, as extended JSON.
    Ejson(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompareDataRequest {
    pub left: TableRef,
    pub right: TableRef,
    pub key_columns: Vec<String>,
    /// Compared columns, key columns excluded.
    pub columns: Vec<String>,
    #[serde(default)]
    pub filter: Option<String>,
    #[serde(default)]
    pub after_key: Option<Vec<KeyVal>>,
    pub count_all: bool,
    pub page_size: usize,
    pub run_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffKind {
    LeftOnly,
    RightOnly,
    Changed,
}

/// One difference. `left`/`right` are display text parallel to
/// [`CompareDataRequest::columns`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DiffRow {
    pub kind: DiffKind,
    pub key: Vec<KeyVal>,
    pub key_display: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left: Option<Vec<Option<String>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right: Option<Vec<Option<String>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed: Option<Vec<usize>>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffCounts {
    pub identical: u64,
    pub changed: u64,
    pub left_only: u64,
    pub right_only: u64,
}

impl DiffCounts {
    pub fn differences(&self) -> u64 {
        self.changed + self.left_only + self.right_only
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RowsRead {
    pub left: u64,
    pub right: u64,
}

/// One Channel / NDJSON message of a running data diff.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CompareChunk {
    Rows { rows: Vec<DiffRow> },
    Progress { rows_read: RowsRead, counts: DiffCounts },
    /// The page is full; a first run keeps counting after this.
    PageFull { last_key: Vec<KeyVal> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompareStatus {
    Done,
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompareSummary {
    pub status: CompareStatus,
    pub counts: DiffCounts,
    pub rows_read: RowsRead,
    /// Known only when a `count_all` run read both sides to the end.
    pub total_diffs: Option<u64>,
    /// Where the next page starts; `None` on the last page.
    pub next_key: Option<Vec<KeyVal>>,
}

/// What `compare_data_to_file` writes: every difference as CSV or JSON, or a
/// script that makes the right side's rows match the left's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompareFileKind {
    Csv,
    Json,
    SyncScript,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompareFileSummary {
    pub status: CompareStatus,
    /// Differences written; a stopped run writes no file.
    pub rows_written: u64,
    pub counts: DiffCounts,
    /// Desktop only: where the file was written.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}
