//! The live server monitor (spec 0025), shared by every engine: the name this
//! launch's pools carry, the row cap and counts, the link to this launch's
//! own runs, and the front door the Tauri commands and the team server call.
//! Each engine's own read and kill live in its `monitor.rs`.

use std::sync::OnceLock;
use std::time::Instant;
use crate::api::{
    BlockEdge, KillOutcome, KillRequest, KillResult, MonitorCounts, MonitorEngine, MonitorSnapshot, SessionRow,
    SessionState,
};
use super::adapter::DbAdapter;
use super::registry::with_connection;
use super::{runs, DbResult};

/// Most sessions one snapshot carries (AC-22). Blockers past it are kept.
pub const MAX_MONITOR_ROWS: usize = 2000;

/// The server side limit on one snapshot read (AC-10).
pub const SNAPSHOT_LIMIT_MS: u64 = 2000;

/// Every refusal that means "this server cannot be monitored" starts with
/// this, so the tab shows it as a stop, not a failed refresh (AC-16).
pub const MONITOR_UNAVAILABLE_PREFIX: &str = "Server monitor unavailable:";

/// The `comment` every Mongo snapshot read carries, so it can drop itself.
pub const MONITOR_COMMENT: &str = "dh-monitor";

/// What the caller of a kill is: the connection it runs under, for the run
/// registry and the Activity log (the desktop id, or the server's handle).
pub struct KillCtx {
    pub conn_id: String,
}

/// 4 hex characters made once per process (AC-11).
pub fn instance_tag() -> &'static str {
    static TAG: OnceLock<String> = OnceLock::new();
    TAG.get_or_init(|| uuid::Uuid::new_v4().simple().to_string()[..4].to_string())
}

static APP_LABEL: OnceLock<&'static str> = OnceLock::new();

/// Name this process's pools something other than `DH Studio`. The team
/// server calls it once at startup (`DH Studio web`), before any connect.
pub fn set_app_label(label: &'static str) {
    let _ = APP_LABEL.set(label);
}

/// What every pool this process opens names itself: `DH Studio (<tag>)`.
/// Plain ASCII on purpose: Postgres swaps any other character in
/// `application_name` for `?`, which would break the match.
pub fn app_name() -> String {
    format!("{} ({})", APP_LABEL.get().copied().unwrap_or("DH Studio"), instance_tag())
}

/// The time a row has been in its current state, the way the list sorts it:
/// the transaction's age for idle in transaction, nothing for plain idle.
fn duration_ms(row: &SessionRow) -> Option<u64> {
    match row.state {
        SessionState::IdleInTx => row.xact_ms.or(row.query_ms),
        SessionState::Idle => None,
        _ => row.query_ms,
    }
}

/// Counts over every session, before the cap. `blocked` is the number of
/// sessions waiting on another one (Postgres edges), or the waiting ones
/// where the engine cannot say on whom (Mongo).
pub fn count_sessions(sessions: &[SessionRow], blocks: &[BlockEdge], engine: MonitorEngine) -> MonitorCounts {
    let mut c = MonitorCounts { total: sessions.len() as u64, ..Default::default() };
    for s in sessions {
        match s.state {
            SessionState::Active => c.active += 1,
            SessionState::Idle => c.idle += 1,
            SessionState::IdleInTx => c.idle_in_tx += 1,
            SessionState::Waiting => c.waiting += 1,
        }
        if s.state == SessionState::Active && s.query_ms.is_some_and(|ms| ms >= 5000) {
            c.slow_at_5s += 1;
        }
    }
    c.blocked = match engine {
        MonitorEngine::Postgres => {
            let mut waiters: Vec<&str> = blocks.iter().map(|b| b.waiter_id.as_str()).collect();
            waiters.sort_unstable();
            waiters.dedup();
            waiters.len() as u64
        }
        MonitorEngine::Mongodb => c.waiting,
    };
    c
}

/// Longest running first, plain idle last, at most `cap` rows, then every
/// blocker the cap dropped added back (AC-22).
pub fn cap_sessions(mut sessions: Vec<SessionRow>, blocks: &[BlockEdge], cap: usize) -> Vec<SessionRow> {
    sessions.sort_by(|a, b| {
        let key = |r: &SessionRow| (r.state == SessionState::Idle, std::cmp::Reverse(duration_ms(r)));
        key(a).cmp(&key(b))
    });
    if sessions.len() <= cap {
        return sessions;
    }
    let rest = sessions.split_off(cap);
    let blockers: std::collections::HashSet<&str> = blocks.iter().map(|b| b.blocker_id.as_str()).collect();
    sessions.extend(rest.into_iter().filter(|r| blockers.contains(r.id.as_str())));
    sessions
}

/// Fill what every engine shares: the `This app` tag, the counts over the
/// whole server, the total, and the capped list.
pub fn finish_snapshot(mut snap: MonitorSnapshot) -> MonitorSnapshot {
    for row in &mut snap.sessions {
        row.is_this_app = row.app_name.as_deref() == Some(snap.app_name_self.as_str());
    }
    snap.counts = count_sessions(&snap.sessions, &snap.blocks, snap.engine);
    snap.total_sessions = snap.sessions.len() as u64;
    let sessions = std::mem::take(&mut snap.sessions);
    snap.sessions = cap_sessions(sessions, &snap.blocks, MAX_MONITOR_ROWS);
    snap
}

/// Point rows at this launch's own registered runs on `conn_id` (AC-18).
/// Postgres matches the run's backend pid; a Mongo adapter leaves the op's
/// `comment` in `run_id`, kept only when it names a run registered here.
pub fn link_runs(conn_id: &str, snap: &mut MonitorSnapshot) {
    for row in &mut snap.sessions {
        row.run_id = match snap.engine {
            MonitorEngine::Postgres => row
                .id
                .parse::<i32>()
                .ok()
                .and_then(|pid| runs::find_by_pg_pid(conn_id, pid)),
            MonitorEngine::Mongodb => row.run_id.take().filter(|id| runs::is_registered(conn_id, id)),
        };
    }
}

/// One snapshot on an adapter the caller already holds (the team server).
/// Never logged, whatever Save app queries says (AC-19).
pub async fn monitor_snapshot_on(conn_id: &str, a: &dyn DbAdapter) -> DbResult<MonitorSnapshot> {
    let mut snap = a.monitor_snapshot().await?;
    link_runs(conn_id, &mut snap);
    Ok(snap)
}

/// One kill on an adapter the caller already holds. The engine logs every
/// outcome it reaches; a call that fails before that is logged here.
pub async fn monitor_kill_on(conn_id: &str, a: &dyn DbAdapter, req: KillRequest) -> DbResult<KillOutcome> {
    let t = Instant::now();
    let action = req.action;
    let target = req.id.clone();
    let ctx = KillCtx { conn_id: conn_id.to_string() };
    let res = a.monitor_kill(req, &ctx).await;
    if let Err(e) = &res {
        crate::activity::log_err(conn_id, "monitor", &super::kill_statement(action, &target), t, e);
    }
    res
}

pub async fn monitor_snapshot(conn_id: &str) -> DbResult<MonitorSnapshot> {
    with_connection(conn_id, |a| async move { monitor_snapshot_on(conn_id, a.as_ref()).await }).await
}

pub async fn monitor_kill(conn_id: &str, req: &KillRequest) -> DbResult<KillOutcome> {
    let req = req.clone();
    with_connection(conn_id, |a| async move { monitor_kill_on(conn_id, a.as_ref(), req).await }).await
}

/// An outcome with no message.
pub(super) fn outcome(result: KillResult) -> KillOutcome {
    KillOutcome { result, message: None }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::{Visibility, VisibilityLevel};

    fn row(id: &str, state: SessionState, query_ms: Option<u64>) -> SessionRow {
        SessionRow { id: id.into(), state, query_ms, ..Default::default() }
    }

    fn edge(waiter: &str, blocker: &str) -> BlockEdge {
        BlockEdge { waiter_id: waiter.into(), blocker_id: blocker.into(), lock_mode: None, relation: None, wait_ms: 0 }
    }

    fn snapshot(sessions: Vec<SessionRow>, blocks: Vec<BlockEdge>) -> MonitorSnapshot {
        MonitorSnapshot {
            taken_at: "now".into(),
            engine: MonitorEngine::Postgres,
            server_version: "16".into(),
            node_note: None,
            app_name_self: "DH Studio (ab12)".into(),
            visibility: Visibility { level: VisibilityLevel::Full, missing: vec![] },
            counts: MonitorCounts::default(),
            total_sessions: 0,
            sessions,
            blocks,
        }
    }

    #[test]
    fn the_tag_is_four_hex_characters_and_stays_the_same() {
        let tag = instance_tag();
        assert_eq!(tag.len(), 4);
        assert!(tag.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(instance_tag(), tag);
        assert!(app_name().ends_with(&format!("({tag})")));
        assert!(app_name().is_ascii());
    }

    /// AC-22: longest running first, idle last, blockers past the cap kept,
    /// and the counts cover the whole server.
    #[test]
    fn the_cap_keeps_the_longest_and_every_blocker() {
        let sessions = vec![
            row("1", SessionState::Active, Some(10)),
            row("2", SessionState::Idle, None),
            row("3", SessionState::Active, Some(9000)),
            row("4", SessionState::Waiting, Some(500)),
            row("5", SessionState::Active, Some(1)),
        ];
        let blocks = vec![edge("4", "5")];
        let capped = cap_sessions(sessions.clone(), &blocks, 2);
        let ids: Vec<&str> = capped.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, ["3", "4", "5"]);

        let snap = finish_snapshot(snapshot(sessions, blocks));
        assert_eq!(snap.total_sessions, 5);
        assert_eq!(snap.counts.total, 5);
        assert_eq!(snap.counts.active, 3);
        assert_eq!(snap.counts.idle, 1);
        assert_eq!(snap.counts.waiting, 1);
        assert_eq!(snap.counts.blocked, 1);
        assert_eq!(snap.counts.slow_at_5s, 1);
    }

    /// AC-5: an idle in transaction row sorts by its transaction's age.
    #[test]
    fn idle_in_transaction_sorts_by_transaction_age() {
        let mut tx = row("tx", SessionState::IdleInTx, Some(5));
        tx.xact_ms = Some(60_000);
        let capped = cap_sessions(vec![row("a", SessionState::Active, Some(1000)), tx], &[], 10);
        assert_eq!(capped[0].id, "tx");
    }

    /// AC-11: only rows carrying this launch's name get the tag.
    #[test]
    fn only_this_launchs_name_gets_the_tag() {
        let mut mine = row("1", SessionState::Active, Some(1));
        mine.app_name = Some("DH Studio (ab12)".into());
        let mut other = row("2", SessionState::Active, Some(1));
        other.app_name = Some("DH Studio (ff00)".into());
        let snap = finish_snapshot(snapshot(vec![mine, other], vec![]));
        let tagged: Vec<bool> = snap.sessions.iter().map(|r| r.is_this_app).collect();
        assert_eq!(tagged, [true, false]);
    }

    #[test]
    fn a_mongo_comment_is_kept_only_for_a_run_registered_here() {
        let run = runs::register("conn-mon", "run-mon-1");
        let mut a = row("1", SessionState::Active, Some(1));
        a.run_id = Some("run-mon-1".into());
        let mut b = row("2", SessionState::Active, Some(1));
        b.run_id = Some("someone-elses".into());
        let mut snap = snapshot(vec![a, b], vec![]);
        snap.engine = MonitorEngine::Mongodb;
        link_runs("conn-mon", &mut snap);
        assert_eq!(snap.sessions[0].run_id.as_deref(), Some("run-mon-1"));
        assert_eq!(snap.sessions[1].run_id, None);
        drop(run);
    }
}
