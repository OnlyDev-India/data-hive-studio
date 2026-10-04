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
    /// The user stopped this run (spec 0006). Not an error. Documents a
    /// stopped write already changed stay changed (MongoDB has no rollback
    /// here). Absent from an older server's reply.
    #[serde(default)]
    pub cancelled: bool,
}

/// An aggregation builder pipeline, the cards in order.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct PipelineSpec {
    pub stages: Vec<StageSpec>,
}

/// One card. `body` is the stage value as relaxed extended JSON text, the
/// way the console accepts it (`{ status: "A" }`, `10`, `"$items"`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StageSpec {
    pub id: String,
    pub op: String,
    pub body: String,
    pub enabled: bool,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    /// The side chains of a main chain `$facet`, `$lookup` or `$unionWith`,
    /// spliced back into the stage on compose. A side chain card has none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub branches: Vec<BranchSpec>,
}

/// One side chain: a `$facet` output, or the `pipeline` of a `$lookup` or
/// `$unionWith`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BranchSpec {
    pub key: String,
    pub stages: Vec<StageSpec>,
}

/// Pipeline text read back into cards: the collection a shell call names,
/// and every stage as a card with no id yet.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ParsedPipeline {
    pub collection: Option<String>,
    pub stages: Vec<StageDraft>,
}

/// One card read from text. `body` is relaxed extended JSON text, the way
/// a card holds it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StageDraft {
    pub op: String,
    pub body: String,
    pub enabled: bool,
    pub title: Option<String>,
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub branches: Vec<BranchDraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BranchDraft {
    pub key: String,
    pub stages: Vec<StageDraft>,
}

/// A stage that could not be composed, named by its card.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StageError {
    pub stage_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_key: Option<String>,
    pub message: String,
}

/// The pipeline in every text form the builder hands out. `canonical` is the
/// canonical extended JSON array that driver code is generated from.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ComposedPipeline {
    pub canonical: serde_json::Value,
    pub shell: String,
    pub json: String,
    pub file: String,
    pub errors: Vec<StageError>,
}

/// The card a preview refresh starts at.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StageRef {
    pub stage_id: String,
    #[serde(default)]
    pub branch_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipelinePreviewRequest {
    pub database: String,
    pub collection: String,
    pub spec: PipelineSpec,
    /// `None` refreshes every card.
    #[serde(default)]
    pub from: Option<StageRef>,
    pub cap: u64,
    pub time_ms: u64,
    pub show: u32,
    pub concurrency: u32,
    #[serde(default)]
    pub run_id: Option<String>,
}

/// One card's preview, sent as soon as its query finishes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct PreviewChunk {
    pub stage_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_key: Option<String>,
    pub count: u64,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub documents: Vec<serde_json::Value>,
    pub elapsed_ms: u128,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// The error is the preview's time limit, not the stage itself.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub timed_out: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct PreviewSummary {
    pub cancelled: bool,
    /// The collection's estimated size, to tell whether the cap cut it.
    pub source_estimate: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PipelineRunRequest {
    pub database: String,
    pub collection: String,
    pub spec: PipelineSpec,
    #[serde(default)]
    pub allow_disk_use: bool,
    #[serde(default)]
    pub run_id: Option<String>,
}
