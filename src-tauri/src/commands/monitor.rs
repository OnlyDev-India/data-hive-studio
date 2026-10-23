use crate::api::{KillOutcome, KillRequest, MonitorSnapshot};
use super::to_err;

forward_cmd! {
    /// One whole server snapshot for the server monitor tab (spec 0025).
    /// Never logged.
    monitor_snapshot(conn_id: String) -> MonitorSnapshot => monitor_snapshot
}

forward_cmd! {
    /// Cancel, terminate or kill the session `req` names, only while it is
    /// still that session. Logs one Activity entry.
    monitor_kill(conn_id: String, req: KillRequest) -> KillOutcome => monitor_kill
}
