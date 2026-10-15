use std::collections::HashMap;
use std::time::Instant;
use sqlx::Row;
use crate::api::{
    BlockEdge, CancelSource, KillAction, KillOutcome, KillRequest, KillResult, MonitorCounts, MonitorEngine,
    MonitorSnapshot, SessionRow, SessionState, Visibility, VisibilityLevel,
};
use crate::db::monitor::{finish_snapshot, outcome, KillCtx, MONITOR_UNAVAILABLE_PREFIX, SNAPSHOT_LIMIT_MS};
use crate::db::{app_name, log_monitor_kill, runs, DbError, DbResult};
use super::PgAdapter;

/// What the server answers in place of a query the user may not see.
const HIDDEN_QUERY: &str = "<insufficient privilege>";

/// SQLSTATE `insufficient_privilege`: a kill the server refused.
const PG_INSUFFICIENT_PRIVILEGE: &str = "42501";

const RIGHTS_SQL: &str = "SELECT \
    to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS taken_at, \
    current_setting('server_version') AS version, \
    current_user::text AS me, \
    COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS is_super, \
    pg_has_role('pg_read_all_stats', 'MEMBER') AS read_all, \
    pg_has_role('pg_signal_backend', 'MEMBER') AS can_signal";

/// Every client session on the server but this read's own, with whom each
/// one waits on. `now()` is the transaction's start, so every duration in
/// one snapshot is measured from the same moment. Without `pg_read_all_stats`
/// the server nulls `backend_type` on other users' rows, so a hidden row
/// counts as a client session when it has both a role and a database (AC-15);
/// background processes lack one or the other.
const ACTIVITY_SQL: &str = "SELECT \
    a.pid, a.usename::text AS usename, a.datname::text AS datname, a.state, \
    a.wait_event_type, a.wait_event, a.query, \
    (EXTRACT(EPOCH FROM now() - a.query_start) * 1000)::bigint AS query_ms, \
    (EXTRACT(EPOCH FROM now() - a.xact_start) * 1000)::bigint AS xact_ms, \
    a.backend_start::text AS backend_start, \
    host(a.client_addr) AS client_addr, a.client_port, a.application_name, \
    pg_blocking_pids(a.pid) AS blockers, \
    COALESCE(r.rolsuper, false) AS target_super \
    FROM pg_stat_activity a LEFT JOIN pg_roles r ON r.oid = a.usesysid \
    WHERE a.pid <> pg_backend_pid() AND (a.backend_type = 'client backend' \
    OR (a.backend_type IS NULL AND a.usesysid IS NOT NULL AND a.datid IS NOT NULL))";

/// The current user's rights, read once per snapshot.
struct Rights {
    me: String,
    is_super: bool,
    read_all: bool,
    can_signal: bool,
}

impl Rights {
    /// AC-15: superuser, or the session's own role, or `pg_signal_backend`;
    /// never a superuser's session unless you are one.
    fn can_kill(&self, user: Option<&str>, target_super: bool) -> bool {
        self.is_super || (!target_super && (self.can_signal || user == Some(self.me.as_str())))
    }

    fn visibility(&self) -> Visibility {
        let mut missing = Vec::new();
        if !self.is_super && !self.read_all {
            missing.push("pg_read_all_stats".to_string());
        }
        if !self.is_super && !self.can_signal {
            missing.push("pg_signal_backend".to_string());
        }
        let level = if missing.iter().any(|m| m == "pg_read_all_stats") {
            VisibilityLevel::Partial
        } else {
            VisibilityLevel::Full
        };
        Visibility { level, missing }
    }
}

/// A `pg_stat_activity` state as the monitor's four. A session the server
/// hides from the user has no state at all; it still lists (AC-15), as
/// active, since it may well be running something.
fn pg_state(state: Option<&str>, wait_event_type: Option<&str>, hidden: bool) -> SessionState {
    match state {
        Some("active") | Some("fastpath function call") => {
            if wait_event_type == Some("Lock") {
                SessionState::Waiting
            } else {
                SessionState::Active
            }
        }
        Some(s) if s.starts_with("idle in transaction") => SessionState::IdleInTx,
        None if hidden => SessionState::Active,
        _ => SessionState::Idle,
    }
}

/// `10.0.0.5:51234`, or the socket for a local connection.
fn client_text(addr: Option<String>, port: Option<i32>) -> Option<String> {
    match (addr, port) {
        (Some(a), Some(p)) if p > 0 => Some(format!("{a}:{p}")),
        (Some(a), _) => Some(a),
        (None, Some(-1)) => Some("local socket".to_string()),
        _ => None,
    }
}

fn ms(v: Option<i64>) -> Option<u64> {
    v.map(|n| n.max(0) as u64)
}

impl PgAdapter {
    /// One whole server snapshot (spec 0025): a single transaction with a 2
    /// second limit on the primary pool, since the views are server wide.
    pub(super) async fn monitor_snapshot(&self) -> DbResult<MonitorSnapshot> {
        let pool = self.pool_for(None).await?;
        let mut tx = pool.begin().await.map_err(DbError::SqlEngine)?;
        let read = async {
            sqlx::query(&format!("SET LOCAL statement_timeout = '{SNAPSHOT_LIMIT_MS}ms'"))
                .execute(&mut *tx)
                .await?;
            let version_num: i32 = sqlx::query_scalar("SELECT current_setting('server_version_num')::int")
                .fetch_one(&mut *tx)
                .await?;
            if version_num < 100_000 {
                return Ok(None);
            }
            let head = sqlx::query(RIGHTS_SQL).fetch_one(&mut *tx).await?;
            let rows = sqlx::query(ACTIVITY_SQL).fetch_all(&mut *tx).await?;
            let waiters: Vec<i32> = rows
                .iter()
                .filter(|r| r.try_get::<Vec<i32>, _>("blockers").is_ok_and(|b| !b.is_empty()))
                .filter_map(|r| r.try_get::<i32, _>("pid").ok())
                .collect();
            let locks = if waiters.is_empty() {
                Vec::new()
            } else {
                // `waitstart` arrived in Postgres 14.
                let wait = if version_num >= 140_000 {
                    "(EXTRACT(EPOCH FROM now() - l.waitstart) * 1000)::bigint"
                } else {
                    "NULL::bigint"
                };
                sqlx::query(&format!(
                    "SELECT l.pid, l.mode, l.relation::regclass::text AS relation, {wait} AS wait_ms \
                     FROM pg_locks l WHERE NOT l.granted AND l.pid = ANY($1)"
                ))
                .bind(&waiters)
                .fetch_all(&mut *tx)
                .await?
            };
            Ok::<_, sqlx::Error>(Some((head, rows, locks)))
        };
        let res = read.await;
        let _ = tx.rollback().await;
        let Some((head, rows, locks)) = res.map_err(DbError::SqlEngine)? else {
            return Err(DbError::InvalidOperation(format!(
                "{MONITOR_UNAVAILABLE_PREFIX} the server monitor needs PostgreSQL 10 or newer."
            )));
        };

        let get = |e: sqlx::Error| DbError::SqlEngine(e);
        let rights = Rights {
            me: head.try_get("me").map_err(get)?,
            is_super: head.try_get("is_super").map_err(get)?,
            read_all: head.try_get("read_all").map_err(get)?,
            can_signal: head.try_get("can_signal").map_err(get)?,
        };
        let mut lock_by_pid: HashMap<i32, (Option<String>, Option<String>, Option<i64>)> = HashMap::new();
        for l in &locks {
            let pid: i32 = l.try_get("pid").map_err(get)?;
            lock_by_pid
                .entry(pid)
                .or_insert((l.try_get("mode").ok(), l.try_get("relation").ok(), l.try_get("wait_ms").ok().flatten()));
        }

        let mut sessions = Vec::with_capacity(rows.len());
        let mut blocks = Vec::new();
        for r in &rows {
            let pid: i32 = r.try_get("pid").map_err(get)?;
            let user: Option<String> = r.try_get("usename").map_err(get)?;
            let query: Option<String> = r.try_get("query").map_err(get)?;
            let hidden = query.as_deref() == Some(HIDDEN_QUERY);
            let wait_type: Option<String> = r.try_get("wait_event_type").map_err(get)?;
            let wait_event: Option<String> = r.try_get("wait_event").map_err(get)?;
            let state = pg_state(r.try_get::<Option<String>, _>("state").map_err(get)?.as_deref(), wait_type.as_deref(), hidden);
            let query_ms = ms(r.try_get("query_ms").map_err(get)?);
            let backend_start: Option<String> = r.try_get("backend_start").map_err(get)?;
            let target_super: bool = r.try_get("target_super").map_err(get)?;
            // The kill guard needs the start time; a session whose start the
            // server hides cannot be killed safely from here.
            let can_kill = backend_start.is_some() && rights.can_kill(user.as_deref(), target_super);
            let blockers: Vec<i32> = r.try_get("blockers").unwrap_or_default();
            if !blockers.is_empty() {
                let (mode, relation, wait_ms) = lock_by_pid.get(&pid).cloned().unwrap_or((None, None, None));
                for b in blockers {
                    blocks.push(BlockEdge {
                        waiter_id: pid.to_string(),
                        blocker_id: b.to_string(),
                        lock_mode: mode.clone(),
                        relation: relation.clone(),
                        wait_ms: ms(wait_ms).or(query_ms).unwrap_or(0),
                    });
                }
            }
            sessions.push(SessionRow {
                id: pid.to_string(),
                user,
                database: r.try_get("datname").map_err(get)?,
                state,
                query_ms: if state == SessionState::Idle { None } else { query_ms },
                xact_ms: ms(r.try_get("xact_ms").map_err(get)?),
                backend_start,
                wait: match (wait_type, wait_event) {
                    (Some(t), Some(e)) => Some(format!("{t}: {e}")),
                    (t, e) => t.or(e),
                },
                op_type: None,
                query: if hidden { None } else { query },
                query_hidden: hidden,
                client: client_text(r.try_get("client_addr").map_err(get)?, r.try_get("client_port").map_err(get)?),
                app_name: r.try_get::<Option<String>, _>("application_name").map_err(get)?.filter(|a| !a.is_empty()),
                is_this_app: false,
                shard: None,
                run_id: None,
                can_cancel: can_kill,
                can_terminate: can_kill,
            });
        }

        Ok(finish_snapshot(MonitorSnapshot {
            taken_at: head.try_get("taken_at").map_err(get)?,
            engine: MonitorEngine::Postgres,
            server_version: head.try_get("version").map_err(get)?,
            node_note: None,
            app_name_self: app_name(),
            visibility: rights.visibility(),
            counts: MonitorCounts::default(),
            total_sessions: 0,
            sessions,
            blocks,
        }))
    }

    /// Cancel or terminate one backend, only while its pid AND backend start
    /// still match the row the user picked (AC-13). A Cancel on one of this
    /// launch's own editor runs goes through the Stop registry instead
    /// (AC-18), so the editor shows its normal Stopped state.
    pub(super) async fn monitor_kill(&self, req: KillRequest, ctx: &KillCtx) -> DbResult<KillOutcome> {
        let t = Instant::now();
        let func = match req.action {
            KillAction::Cancel => "pg_cancel_backend",
            KillAction::Terminate => "pg_terminate_backend",
            KillAction::KillOp => {
                return Err(DbError::InvalidOperation("Kill operation is a MongoDB action".into()))
            }
        };
        let pid: i32 = req
            .id
            .parse()
            .map_err(|_| DbError::InvalidOperation(format!("{} is not a Postgres session id", req.id)))?;
        let Some(start) = req.backend_start.as_deref() else {
            return Err(DbError::InvalidOperation("a Postgres kill needs the session's backend start".into()));
        };
        let pool = self.pool_for(None).await?;
        let log = |user: Option<&str>, db: Option<&str>, out: &KillOutcome| {
            log_monitor_kill(&ctx.conn_id, req.action, &req.id, user, db, out, t)
        };

        if req.action == KillAction::Cancel {
            if let Some(run_id) = runs::find_by_pg_pid(&ctx.conn_id, pid) {
                let who = sqlx::query(
                    "SELECT usename::text AS usename, datname::text AS datname FROM pg_stat_activity \
                     WHERE pid = $1 AND backend_start::text = $2",
                )
                .bind(pid)
                .bind(start)
                .fetch_optional(&pool)
                .await
                .map_err(DbError::SqlEngine)?;
                let Some(who) = who else {
                    let out = outcome(KillResult::Gone);
                    log(None, None, &out);
                    return Ok(out);
                };
                let user: Option<String> = who.try_get("usename").ok().flatten();
                let db: Option<String> = who.try_get("datname").ok().flatten();
                let stopped = runs::cancel_with_source(&ctx.conn_id, &run_id, CancelSource::Monitor).await;
                let out = if stopped.state == runs::CancelState::NotRunning {
                    outcome(KillResult::Gone)
                } else {
                    outcome(KillResult::StoppedRun)
                };
                log(user.as_deref(), db.as_deref(), &out);
                return Ok(out);
            }
        }

        let sql = format!(
            "SELECT {func}(pid) AS ok, usename::text AS usename, datname::text AS datname \
             FROM pg_stat_activity WHERE pid = $1 AND backend_start::text = $2"
        );
        match sqlx::query(&sql).bind(pid).bind(start).fetch_optional(&pool).await {
            Ok(None) => {
                let out = outcome(KillResult::Gone);
                log(None, None, &out);
                Ok(out)
            }
            Ok(Some(row)) => {
                let ok: bool = row.try_get("ok").unwrap_or(false);
                let user: Option<String> = row.try_get("usename").ok().flatten();
                let db: Option<String> = row.try_get("datname").ok().flatten();
                // `false`: the backend vanished between the match and the signal.
                let out = outcome(if ok { KillResult::Done } else { KillResult::Gone });
                log(user.as_deref(), db.as_deref(), &out);
                Ok(out)
            }
            Err(e) => {
                let refused = e
                    .as_database_error()
                    .filter(|d| d.code().is_some_and(|c| c == PG_INSUFFICIENT_PRIVILEGE))
                    .map(|d| d.message().to_string());
                match refused {
                    Some(message) => {
                        let out = KillOutcome { result: KillResult::Refused, message: Some(message) };
                        log(None, None, &out);
                        Ok(out)
                    }
                    None => Err(DbError::SqlEngine(e)),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rights(is_super: bool, read_all: bool, can_signal: bool) -> Rights {
        Rights { me: "app".into(), is_super, read_all, can_signal }
    }

    #[test]
    fn states_map_to_the_monitors_four() {
        assert_eq!(pg_state(Some("active"), None, false), SessionState::Active);
        assert_eq!(pg_state(Some("active"), Some("Lock"), false), SessionState::Waiting);
        assert_eq!(pg_state(Some("active"), Some("IO"), false), SessionState::Active);
        assert_eq!(pg_state(Some("idle in transaction"), None, false), SessionState::IdleInTx);
        assert_eq!(pg_state(Some("idle in transaction (aborted)"), None, false), SessionState::IdleInTx);
        assert_eq!(pg_state(Some("idle"), None, false), SessionState::Idle);
        assert_eq!(pg_state(Some("disabled"), None, false), SessionState::Idle);
        // AC-15: a hidden session still lists.
        assert_eq!(pg_state(None, None, true), SessionState::Active);
    }

    /// AC-15: who may cancel or terminate whom.
    #[test]
    fn kill_rights_follow_the_server_rules() {
        let me = Some("app");
        let other = Some("bob");
        assert!(rights(true, false, false).can_kill(other, true));
        assert!(rights(false, false, false).can_kill(me, false));
        assert!(!rights(false, false, false).can_kill(other, false));
        assert!(rights(false, false, true).can_kill(other, false));
        assert!(!rights(false, false, true).can_kill(other, true));
    }

    #[test]
    fn visibility_names_what_is_missing() {
        let plain = rights(false, false, false).visibility();
        assert_eq!(plain.level, VisibilityLevel::Partial);
        assert_eq!(plain.missing, ["pg_read_all_stats", "pg_signal_backend"]);
        let stats = rights(false, true, false).visibility();
        assert_eq!(stats.level, VisibilityLevel::Full);
        assert_eq!(stats.missing, ["pg_signal_backend"]);
        assert!(rights(true, false, false).visibility().missing.is_empty());
    }

    #[test]
    fn client_text_shows_address_and_port() {
        assert_eq!(client_text(Some("10.0.0.5".into()), Some(51234)).as_deref(), Some("10.0.0.5:51234"));
        assert_eq!(client_text(None, Some(-1)).as_deref(), Some("local socket"));
        assert_eq!(client_text(None, None), None);
    }
}

#[cfg(test)]
mod live_tests {
    use super::*;
    use crate::db::postgres::params::PgParams;
    use std::time::Duration;

    fn params() -> PgParams {
        let url = std::env::var("DH_TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgres://postgres@127.0.0.1:5544/dh_server_test".to_string());
        let rest = url.strip_prefix("postgres://").expect("a postgres:// url");
        let (auth, tail) = rest.split_once('@').expect("user@host in the url");
        let (user, password) = auth.split_once(':').unwrap_or((auth, ""));
        let (hostport, database) = tail.split_once('/').expect("/database in the url");
        let (host, port) = hostport.split_once(':').unwrap_or((hostport, "5432"));
        serde_json::from_value(serde_json::json!({
            "host": host, "port": port.parse::<u16>().unwrap(), "user": user,
            "password": password, "database": database, "ssl_mode": "disable", "pool_max": 4,
        }))
        .unwrap()
    }

    /// AC-4, AC-11, AC-13: a sleeping session lists as active with this
    /// launch's tag, the snapshot never lists itself, a kill with a stale
    /// start time finds nothing, and Cancel with the right one stops it.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_monitor_lists_and_cancels_a_sleeping_session() {
        let a = std::sync::Arc::new(PgAdapter::connect(&params()).await.unwrap());
        let sleeper = a.clone();
        let task = tokio::spawn(async move { sleeper.run_sql(None, None, "SELECT pg_sleep(20)").await });
        tokio::time::sleep(Duration::from_millis(500)).await;

        let snap = a.monitor_snapshot().await.unwrap();
        let row = snap
            .sessions
            .iter()
            .find(|r| r.query.as_deref() == Some("SELECT pg_sleep(20)"))
            .expect("the sleeping session lists");
        assert_eq!(row.state, SessionState::Active);
        assert!(row.is_this_app);
        assert!(!snap.sessions.iter().any(|r| r.query.as_deref().is_some_and(|q| q.contains("pg_blocking_pids"))));

        let ctx = KillCtx { conn_id: "pg-monitor-live".into() };
        let stale = KillRequest {
            action: KillAction::Cancel,
            id: row.id.clone(),
            backend_start: Some("1999-01-01 00:00:00+00".into()),
            run_id: None,
        };
        assert_eq!(a.monitor_kill(stale, &ctx).await.unwrap().result, KillResult::Gone);

        let real = KillRequest {
            action: KillAction::Cancel,
            id: row.id.clone(),
            backend_start: row.backend_start.clone(),
            run_id: None,
        };
        assert_eq!(a.monitor_kill(real, &ctx).await.unwrap().result, KillResult::Done);
        // The sleep ends early instead of running its 20 seconds.
        let _ = tokio::time::timeout(Duration::from_secs(5), task).await.expect("the sleep was cancelled");
    }
}
