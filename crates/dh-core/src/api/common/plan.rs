use serde::{Deserialize, Serialize};

/// Which engine's explain produced a plan.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlanDialect {
    Postgres,
    Sqlite,
    Mongodb,
}

/// `Estimate` never runs the statement; `Analyze` runs it for real timings.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PlanMode {
    Estimate,
    Analyze,
}

/// One step of a plan, the same shape for every engine. A value the engine
/// does not give stays `None` and shows as a dash.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct PlanNode {
    /// Unique within its tree, assigned in Rust. The row key in the UI.
    pub id: u32,
    pub label: String,
    /// Table, index or collection the step reads. Empty when there is none.
    pub target: String,
    /// Filters and join conditions, one per line, each with its name.
    pub condition: String,
    pub startup_cost: Option<f64>,
    pub total_cost: Option<f64>,
    pub est_rows: Option<f64>,
    /// Analyze only.
    pub actual_rows: Option<f64>,
    /// Analyze only. Total across loops, children included.
    pub actual_time_ms: Option<f64>,
    /// Analyze only.
    pub loops: Option<f64>,
    pub children: Vec<PlanNode>,
}

/// The answer to one Explain call: one Plan tab.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlanResult {
    pub dialect: PlanDialect,
    pub mode: PlanMode,
    /// Exactly the text that was explained. The tab compares it with the
    /// editor to decide whether the plan is stale.
    pub statement: String,
    /// Empty when `error`, `unsupported` or `cancelled` is set.
    pub root: Option<PlanNode>,
    pub elapsed_ms: u64,
    #[serde(default)]
    pub cancelled: bool,
    /// The tree was cut at [`crate::db::MAX_PLAN_NODES`].
    #[serde(default)]
    pub truncated: bool,
    /// The database's own message.
    pub error: Option<String>,
    /// Why this statement was not sent to the database at all.
    pub unsupported: Option<String>,
}

impl PlanResult {
    fn empty(dialect: PlanDialect, mode: PlanMode, statement: &str) -> Self {
        Self {
            dialect,
            mode,
            statement: statement.to_string(),
            root: None,
            elapsed_ms: 0,
            cancelled: false,
            truncated: false,
            error: None,
            unsupported: None,
        }
    }

    pub fn planned(
        dialect: PlanDialect,
        mode: PlanMode,
        statement: &str,
        root: Option<PlanNode>,
        truncated: bool,
        elapsed_ms: u64,
    ) -> Self {
        Self { root, truncated, elapsed_ms, ..Self::empty(dialect, mode, statement) }
    }

    pub fn failed(dialect: PlanDialect, mode: PlanMode, statement: &str, error: String) -> Self {
        Self { error: Some(error), ..Self::empty(dialect, mode, statement) }
    }

    /// The user pressed Stop and the database (or the 3 second cap) ended it.
    pub fn stopped(dialect: PlanDialect, mode: PlanMode, statement: &str, elapsed_ms: u64) -> Self {
        Self { cancelled: true, elapsed_ms, ..Self::empty(dialect, mode, statement) }
    }

    pub fn unsupported(dialect: PlanDialect, mode: PlanMode, statement: &str, message: String) -> Self {
        Self { unsupported: Some(message), ..Self::empty(dialect, mode, statement) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SQL: &str = "select 1";

    #[test]
    fn a_planned_result_carries_the_tree_and_no_message() {
        let root = PlanNode { id: 1, label: "SCAN".into(), ..Default::default() };
        let res = PlanResult::planned(
            PlanDialect::Sqlite,
            PlanMode::Estimate,
            SQL,
            Some(root.clone()),
            true,
            12,
        );
        assert_eq!(res.statement, SQL);
        assert_eq!(res.root, Some(root));
        assert!(res.truncated);
        assert_eq!(res.elapsed_ms, 12);
        assert!(res.error.is_none() && res.unsupported.is_none() && !res.cancelled);
    }

    #[test]
    fn a_failed_result_has_the_database_message_and_no_tree() {
        let res = PlanResult::failed(PlanDialect::Postgres, PlanMode::Analyze, SQL, "boom".into());
        assert_eq!(res.error.as_deref(), Some("boom"));
        assert!(res.root.is_none() && res.unsupported.is_none() && !res.cancelled);
    }

    #[test]
    fn a_stopped_result_is_cancelled_with_its_elapsed_time() {
        let res = PlanResult::stopped(PlanDialect::Mongodb, PlanMode::Analyze, SQL, 3000);
        assert!(res.cancelled);
        assert_eq!(res.elapsed_ms, 3000);
        assert!(res.root.is_none() && res.error.is_none());
    }

    #[test]
    fn an_unsupported_result_never_reached_the_database() {
        let res = PlanResult::unsupported(PlanDialect::Sqlite, PlanMode::Estimate, SQL, "no".into());
        assert_eq!(res.unsupported.as_deref(), Some("no"));
        assert!(res.root.is_none() && res.error.is_none());
    }

    #[test]
    fn dialect_and_mode_serialize_lowercase_for_the_frontend() {
        let res = PlanResult::stopped(PlanDialect::Mongodb, PlanMode::Analyze, SQL, 0);
        let json = serde_json::to_value(&res).unwrap();
        assert_eq!(json["dialect"], "mongodb");
        assert_eq!(json["mode"], "analyze");
    }

    #[test]
    fn an_older_payload_without_cancelled_or_truncated_still_reads() {
        let json = r#"{"dialect":"postgres","mode":"estimate","statement":"select 1",
            "root":null,"elapsed_ms":5,"error":null,"unsupported":null}"#;
        let res: PlanResult = serde_json::from_str(json).unwrap();
        assert!(!res.cancelled && !res.truncated);
    }
}
