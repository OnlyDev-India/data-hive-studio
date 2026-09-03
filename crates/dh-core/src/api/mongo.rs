//! MongoDB-only wire types. Split out of the generic wire types in
//! [`super::common`] since these have no meaning on SQL-shaped connections.

use serde::{Deserialize, Serialize};

/// Result for MongoDB document listing with pagination.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MongoDocumentsResult {
    pub documents: Vec<serde_json::Value>,
    pub total: u64,
}

/// Result for the type-aware MongoDB document listing (MQL extended JSON text).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MongoExtDocumentsResult {
    pub documents: Vec<String>,
    pub total: u64,
}

/// Result of running a single MongoDB console command (a JSON find/aggregate,
/// or a shell-subset statement). Carries both a flat grid projection (columns +
/// rows, renderable by the shared query grid) and the raw JSON documents for a
/// JSON view.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct MongoRunResult {
    /// The canonical operation, e.g. `db.users.find({"age": {"$gte": 18}})`.
    pub command: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub documents: Vec<serde_json::Value>,
    pub rows_affected: u64,
    pub is_select: bool,
    /// Non-table feedback, e.g. rows affected / a shell notice.
    pub message: Option<String>,
    /// Error text (a run may return a shaped result with an error embedded).
    pub error: Option<String>,
    /// Set by `use <db>` so the console updates its current-database context.
    pub switch_db: Option<String>,
    pub elapsed_ms: u128,
}
