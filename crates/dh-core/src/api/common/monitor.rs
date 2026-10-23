//! The live server monitor (spec 0025): one whole server snapshot per
//! refresh, and the kill request and its answer.

use serde::{Deserialize, Serialize};

/// Which engine took a snapshot.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MonitorEngine {
    Postgres,
    Mongodb,
}

/// What a session is doing right now. `Waiting` is an active session stuck
/// on a lock.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Active,
    #[default]
    Idle,
    IdleInTx,
    Waiting,
}

/// One session (Postgres backend) or operation (Mongo op) on the server.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct SessionRow {
    /// Postgres pid, or Mongo opid as relaxed extended JSON text (a string
    /// like `shard0:123` through mongos). The row key in the UI.
    pub id: String,
    pub user: Option<String>,
    pub database: Option<String>,
    pub state: SessionState,
    /// Time since the current query started. `None` for idle sessions.
    pub query_ms: Option<u64>,
    /// Age of the open transaction, when there is one.
    pub xact_ms: Option<u64>,
    /// Postgres: the server's own text for `backend_start`, so the kill guard
    /// matches it exactly. `None` on Mongo.
    pub backend_start: Option<String>,
    /// Postgres wait event (`Lock: relation`), Mongo `waitingForLock`.
    pub wait: Option<String>,
    /// Mongo `op` (`query`, `command`, `getmore`, ...).
    pub op_type: Option<String>,
    pub query: Option<String>,
    /// The server hid this session's query text from the current user.
    pub query_hidden: bool,
    pub client: Option<String>,
    pub app_name: Option<String>,
    /// The session belongs to this app launch (its `application_name` /
    /// `appName` is `app_name_self`).
    pub is_this_app: bool,
    /// Mongo through mongos: the shard running the op.
    pub shard: Option<String>,
    /// One of this launch's own registered editor runs (spec 0006).
    pub run_id: Option<String>,
    pub can_cancel: bool,
    /// Always false on Mongo.
    pub can_terminate: bool,
}

/// `waiter_id` waits on a lock `blocker_id` holds. Postgres only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BlockEdge {
    pub waiter_id: String,
    pub blocker_id: String,
    pub lock_mode: Option<String>,
    pub relation: Option<String>,
    pub wait_ms: u64,
}

/// Counts over the WHOLE server, even when `sessions` is capped.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct MonitorCounts {
    pub total: u64,
    pub active: u64,
    pub idle: u64,
    pub idle_in_tx: u64,
    pub waiting: u64,
    pub blocked: u64,
    pub slow_at_5s: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VisibilityLevel {
    Full,
    Partial,
}

/// What the current user cannot see or do, by privilege name
/// (`pg_read_all_stats`, `pg_signal_backend`, `inprog`, `killop`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Visibility {
    pub level: VisibilityLevel,
    pub missing: Vec<String>,
}

/// One refresh of the monitor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MonitorSnapshot {
    /// ISO text, server clock where the engine gives one.
    pub taken_at: String,
    pub engine: MonitorEngine,
    pub server_version: String,
    /// `Primary of rs0`, `Connected through mongos`.
    pub node_note: Option<String>,
    /// The name this launch's pools carry: `DH Studio (<tag>)`.
    pub app_name_self: String,
    pub visibility: Visibility,
    pub counts: MonitorCounts,
    /// Every session on the server, before the row cap.
    pub total_sessions: u64,
    pub sessions: Vec<SessionRow>,
    pub blocks: Vec<BlockEdge>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KillAction {
    /// Postgres `pg_cancel_backend`.
    Cancel,
    /// Postgres `pg_terminate_backend`.
    Terminate,
    /// Mongo `killOp`.
    KillOp,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KillRequest {
    pub action: KillAction,
    pub id: String,
    /// Required on Postgres: the kill fires only while it still matches.
    #[serde(default)]
    pub backend_start: Option<String>,
    #[serde(default)]
    pub run_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KillResult {
    Done,
    /// The session ended (or is no longer the one picked): nothing killed.
    Gone,
    /// The server said no; `message` carries its words.
    Refused,
    /// An own editor run, stopped through the Stop registry.
    StoppedRun,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct KillOutcome {
    pub result: KillResult,
    pub message: Option<String>,
}

/// Who stopped a run, when it was not the run's own Stop button.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CancelSource {
    Monitor,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_names_are_snake_case() {
        let row = SessionRow { state: SessionState::IdleInTx, ..Default::default() };
        let v = serde_json::to_value(&row).unwrap();
        assert_eq!(v["state"], "idle_in_tx");
        let req: KillRequest =
            serde_json::from_value(serde_json::json!({"action": "kill_op", "id": "7"})).unwrap();
        assert_eq!(req.action, KillAction::KillOp);
        assert_eq!(req.backend_start, None);
        let out = KillOutcome { result: KillResult::StoppedRun, message: None };
        assert_eq!(serde_json::to_value(out).unwrap()["result"], "stopped_run");
        assert_eq!(serde_json::to_value(CancelSource::Monitor).unwrap(), "monitor");
    }
}
