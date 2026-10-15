use std::time::{Duration, Instant};
use bson::{doc, Bson, Document};
use futures_util::TryStreamExt;
use mongodb::error::ErrorKind;
use mongodb::Database;
use crate::api::{
    CancelSource, KillAction, KillOutcome, KillRequest, KillResult, MonitorCounts, MonitorEngine, MonitorSnapshot,
    SessionRow, SessionState, Visibility, VisibilityLevel,
};
use crate::db::monitor::{
    finish_snapshot, outcome, KillCtx, MONITOR_COMMENT, MONITOR_UNAVAILABLE_PREFIX, SNAPSHOT_LIMIT_MS,
};
use crate::db::{app_name, log_monitor_kill, mongo_json, runs, DbError, DbResult};
use super::MongoAdapter;

/// How long the user's privileges and the node's role stay cached.
const INFO_TTL: Duration = Duration::from_secs(60);

/// `Unauthorized`: the user may not list other users' operations.
const UNAUTHORIZED: i32 = 13;

/// `AtlasError`: Atlas's own refusal, sent in place of `Unauthorized` (a
/// shared or Flex tier turns down `$currentOp` even when the role lists
/// `inprog`).
const ATLAS_REFUSED: i32 = 8000;

/// Codes a server answers when it does not offer `$currentOp` at all
/// (an older server, or a hosted one that turned it off).
const UNSUPPORTED: [i32; 4] = [40324, 59, 115, 303];

/// Command fields that are driver plumbing, not the user's query.
const NOISE_FIELDS: [&str; 9] = [
    "lsid",
    "$clusterTime",
    "$db",
    "$readPreference",
    "$audit",
    "$client",
    "$configTime",
    "$topologyTime",
    "comment",
];

/// What the monitor needs to know about the user and the node, read when the
/// tab opens and cached on the adapter (spec 0025).
#[derive(Clone, Debug, PartialEq)]
pub(super) struct MonitorInfo {
    /// The user this connection authenticated as; `None` without auth.
    me: Option<String>,
    inprog: bool,
    killop: bool,
    node_note: Option<String>,
    version: String,
}

fn code_of(e: &mongodb::error::Error) -> Option<i32> {
    match e.kind.as_ref() {
        ErrorKind::Command(ce) => Some(ce.code),
        _ => None,
    }
}

/// Whether the server refused the user rather than failing the command.
fn refused(code: Option<i32>) -> bool {
    matches!(code, Some(UNAUTHORIZED | ATLAS_REFUSED))
}

fn mongo_err(e: mongodb::error::Error) -> DbError {
    DbError::InvalidOperation(format!("mongo: {e}"))
}

fn num(v: Option<&Bson>) -> Option<i64> {
    match v? {
        Bson::Int32(n) => Some(*n as i64),
        Bson::Int64(n) => Some(*n),
        Bson::Double(n) => Some(*n as i64),
        _ => None,
    }
}

/// An opid as the row key: digits on a mongod, `shard0:123` through mongos.
fn opid_text(v: &Bson) -> Option<String> {
    match v {
        Bson::String(s) => Some(s.clone()),
        other => num(Some(other)).map(|n| n.to_string()),
    }
}

/// The row key back as the opid `$currentOp` and `killOp` take.
fn opid_bson(id: &str) -> Bson {
    match id.parse::<i64>() {
        Ok(n) => match i32::try_from(n) {
            Ok(small) => Bson::Int32(small),
            Err(_) => Bson::Int64(n),
        },
        Err(_) => Bson::String(id.to_string()),
    }
}

/// Whether a privilege list grants `action` on the cluster.
fn has_cluster_action(privileges: &[Bson], action: &str) -> bool {
    privileges.iter().filter_map(Bson::as_document).any(|p| {
        let resource = p.get_document("resource").ok();
        let on_cluster = resource.is_some_and(|r| {
            r.get_bool("cluster").unwrap_or(false) || r.get_bool("anyResource").unwrap_or(false)
        });
        on_cluster
            && p
                .get_array("actions")
                .is_ok_and(|a| a.iter().any(|x| x.as_str() == Some(action)))
    })
}

/// The user and their rights from `connectionStatus`. A server without auth
/// lets everyone see and kill everything.
fn rights_from(status: &Document) -> (Option<String>, bool, bool) {
    let auth = status.get_document("authInfo").ok();
    let users = auth.and_then(|a| a.get_array("authenticatedUsers").ok());
    let me = users
        .and_then(|u| u.first())
        .and_then(Bson::as_document)
        .and_then(|u| u.get_str("user").ok())
        .map(str::to_string);
    if me.is_none() {
        return (None, true, true);
    }
    let privileges = auth.and_then(|a| a.get_array("authenticatedUserPrivileges").ok());
    let privileges = privileges.map(Vec::as_slice).unwrap_or(&[]);
    (me, has_cluster_action(privileges, "inprog"), has_cluster_action(privileges, "killop"))
}

/// `Connected through mongos`, `Primary of rs0`, or nothing for a standalone.
fn node_note(hello: &Document) -> Option<String> {
    if hello.get_str("msg") == Ok("isdbgrid") {
        return Some("Connected through mongos".to_string());
    }
    let set = hello.get_str("setName").ok()?;
    if hello.get_bool("isWritablePrimary").unwrap_or(false) || hello.get_bool("ismaster").unwrap_or(false) {
        Some(format!("Primary of {set}"))
    } else if hello.get_bool("secondary").unwrap_or(false) {
        Some(format!("Secondary of {set}"))
    } else {
        Some(format!("Member of {set}"))
    }
}

/// The comment an operation carries: its own, or (for a getMore) the one of
/// the command that opened its cursor.
fn comment_of(op: &Document) -> Option<String> {
    ["command", "originatingCommand"].iter().find_map(|k| {
        op.get_document(k).ok().and_then(|c| c.get_str("comment").ok()).map(str::to_string)
    })
}

/// The query text: the command without driver plumbing, or for a getMore
/// the command that opened the cursor.
fn query_text(op: &Document) -> Option<String> {
    let is_getmore = op.get_str("op") == Ok("getmore");
    let source = if is_getmore { op.get_document("originatingCommand").ok() } else { None }
        .or_else(|| op.get_document("command").ok())?;
    let mut clean = source.clone();
    for f in NOISE_FIELDS {
        clean.remove(f);
    }
    if clean.is_empty() {
        return None;
    }
    Some(mongo_json::render(&clean))
}

/// One `$currentOp` entry as a row, or `None` for the monitor's own read.
fn map_op(op: &Document, info: &MonitorInfo) -> Option<SessionRow> {
    let comment = comment_of(op);
    if comment.as_deref() == Some(MONITOR_COMMENT) {
        return None;
    }
    let active = op.get_bool("active").unwrap_or(false);
    let opid = op.get("opid").and_then(opid_text);
    let id = match &opid {
        Some(id) => id.clone(),
        // An idle session has no operation, only its session id.
        None => format!(
            "lsid:{}",
            op.get_document("lsid")
                .ok()
                .and_then(|l| l.get("id"))
                .map(mongo_json::render_bson)
                .unwrap_or_else(|| op.get_str("connectionId").map(str::to_string).unwrap_or_default())
        ),
    };
    let user = op
        .get_array("effectiveUsers")
        .ok()
        .and_then(|u| u.first())
        .and_then(Bson::as_document)
        .and_then(|u| u.get_str("user").ok())
        .map(str::to_string);
    let waiting = op.get_bool("waitingForLock").unwrap_or(false);
    let in_tx = op.contains_key("transaction");
    let state = match (active, waiting) {
        (true, true) => SessionState::Waiting,
        (true, false) => SessionState::Active,
        (false, _) if in_tx => SessionState::IdleInTx,
        _ => SessionState::Idle,
    };
    let own = info.me.is_none() || user.is_some() && user == info.me;
    let database = op
        .get_str("ns")
        .ok()
        .and_then(|ns| ns.split('.').next())
        .filter(|d| !d.is_empty())
        .map(str::to_string);
    let xact_ms = op
        .get_document("transaction")
        .ok()
        .and_then(|t| num(t.get("timeOpenMicros")))
        .map(|us| (us.max(0) / 1000) as u64);
    Some(SessionRow {
        id,
        user,
        database,
        state,
        query_ms: if active { num(op.get("microsecs_running")).map(|us| (us.max(0) / 1000) as u64) } else { None },
        xact_ms,
        backend_start: None,
        wait: waiting.then(|| "waiting for lock".to_string()),
        op_type: op.get_str("op").ok().map(str::to_string),
        query: query_text(op),
        query_hidden: false,
        client: op.get_str("client").or_else(|_| op.get_str("client_s")).ok().map(str::to_string),
        app_name: op.get_str("appName").ok().map(str::to_string),
        is_this_app: false,
        shard: op.get_str("shard").ok().map(str::to_string),
        // Kept only when it names a run registered here (`link_runs`).
        run_id: comment,
        can_cancel: active && opid.is_some() && (info.killop || own),
        can_terminate: false,
    })
}

async fn current_ops(admin: &Database, all_users: bool, extra: Option<Document>) -> mongodb::error::Result<Vec<Document>> {
    let mut pipeline = vec![doc! { "$currentOp": {
        "allUsers": all_users, "idleConnections": false, "idleSessions": true, "localOps": false,
    } }];
    pipeline.extend(extra);
    admin
        .aggregate(pipeline)
        .max_time(Duration::from_millis(SNAPSHOT_LIMIT_MS))
        .comment(Bson::String(MONITOR_COMMENT.to_string()))
        .await?
        .try_collect()
        .await
}

fn unavailable() -> DbError {
    DbError::InvalidOperation(format!(
        "{MONITOR_UNAVAILABLE_PREFIX} This server does not let DH Studio read current operations."
    ))
}

impl MongoAdapter {
    /// The user's rights and the node's role, cached for a minute.
    async fn monitor_info(&self) -> DbResult<MonitorInfo> {
        if let Some((at, info)) = self.monitor_cache.lock().unwrap().as_ref() {
            if at.elapsed() < INFO_TTL {
                return Ok(info.clone());
            }
        }
        let admin = self.client.database("admin");
        let status = admin
            .run_command(doc! { "connectionStatus": 1, "showPrivileges": true })
            .await
            .map_err(mongo_err)?;
        let hello = admin.run_command(doc! { "hello": 1 }).await.map_err(mongo_err)?;
        let version = admin
            .run_command(doc! { "buildInfo": 1 })
            .await
            .ok()
            .and_then(|b| b.get_str("version").ok().map(|v| format!("MongoDB {v}")))
            .unwrap_or_else(|| "MongoDB".to_string());
        let (me, inprog, killop) = rights_from(&status);
        let info = MonitorInfo { me, inprog, killop, node_note: node_note(&hello), version };
        *self.monitor_cache.lock().unwrap() = Some((Instant::now(), info.clone()));
        Ok(info)
    }

    /// One whole server snapshot from `$currentOp` (spec 0025). Without the
    /// `inprog` action it falls back to the user's own operations.
    pub(super) async fn monitor_snapshot(&self) -> DbResult<MonitorSnapshot> {
        let info = self.monitor_info().await?;
        let admin = self.client.database("admin");
        let mut partial = !info.inprog;
        let ops = match current_ops(&admin, info.inprog, None).await {
            Err(e) if refused(code_of(&e)) && info.inprog => {
                partial = true;
                current_ops(&admin, false, None).await
            }
            other => other,
        };
        let ops = ops.map_err(|e| match code_of(&e) {
            c if refused(c) || c.is_some_and(|c| UNSUPPORTED.contains(&c)) => unavailable(),
            _ => mongo_err(e),
        })?;

        let mut missing = Vec::new();
        if partial {
            missing.push("inprog".to_string());
        }
        if !info.killop {
            missing.push("killop".to_string());
        }
        Ok(finish_snapshot(MonitorSnapshot {
            taken_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            engine: MonitorEngine::Mongodb,
            server_version: info.version.clone(),
            node_note: info.node_note.clone(),
            app_name_self: app_name(),
            visibility: Visibility {
                level: if partial { VisibilityLevel::Partial } else { VisibilityLevel::Full },
                missing,
            },
            counts: MonitorCounts::default(),
            total_sessions: 0,
            sessions: ops.iter().filter_map(|op| map_op(op, &info)).collect(),
            blocks: Vec::new(),
        }))
    }

    /// `killOp` one operation, only while its opid is still in `$currentOp`
    /// (AC-13). One of this launch's own console runs goes through the Stop
    /// registry instead (AC-18).
    pub(super) async fn monitor_kill(&self, req: KillRequest, ctx: &KillCtx) -> DbResult<KillOutcome> {
        let t = Instant::now();
        if req.action != KillAction::KillOp {
            return Err(DbError::InvalidOperation("MongoDB only offers Kill operation".into()));
        }
        let info = self.monitor_info().await?;
        let admin = self.client.database("admin");
        let opid = opid_bson(&req.id);
        let pick = Some(doc! { "$match": { "opid": opid.clone() } });
        let found = match current_ops(&admin, info.inprog, pick.clone()).await {
            Err(e) if refused(code_of(&e)) => current_ops(&admin, false, pick).await,
            other => other,
        }
        .map_err(mongo_err)?;
        let log = |user: Option<&str>, db: Option<&str>, out: &KillOutcome| {
            log_monitor_kill(&ctx.conn_id, req.action, &req.id, user, db, out, t)
        };
        let Some(op) = found.first() else {
            let out = outcome(KillResult::Gone);
            log(None, None, &out);
            return Ok(out);
        };
        let row = map_op(op, &info);
        let user = row.as_ref().and_then(|r| r.user.clone());
        let db = row.as_ref().and_then(|r| r.database.clone());

        if let Some(run_id) = comment_of(op).filter(|c| runs::is_registered(&ctx.conn_id, c)) {
            let stopped = runs::cancel_with_source(&ctx.conn_id, &run_id, CancelSource::Monitor).await;
            let out = if stopped.state == runs::CancelState::NotRunning {
                outcome(KillResult::Gone)
            } else {
                outcome(KillResult::StoppedRun)
            };
            log(user.as_deref(), db.as_deref(), &out);
            return Ok(out);
        }

        let out = match admin.run_command(doc! { "killOp": 1, "op": opid }).await {
            Ok(_) => outcome(KillResult::Done),
            Err(e) if refused(code_of(&e)) => KillOutcome {
                result: KillResult::Refused,
                message: Some(match e.kind.as_ref() {
                    ErrorKind::Command(ce) => ce.message.clone(),
                    _ => e.to_string(),
                }),
            },
            Err(e) => return Err(mongo_err(e)),
        };
        log(user.as_deref(), db.as_deref(), &out);
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(me: Option<&str>, inprog: bool, killop: bool) -> MonitorInfo {
        MonitorInfo { me: me.map(str::to_string), inprog, killop, node_note: None, version: "MongoDB 7.0".into() }
    }

    fn running_find() -> Document {
        doc! {
            "opid": 4821_i32, "active": true, "op": "query", "ns": "shop.orders",
            "microsecs_running": 6_500_000_i64, "client": "10.0.0.5:51234", "appName": "DH Studio (ab12)",
            "effectiveUsers": [{ "user": "app", "db": "admin" }],
            "command": { "find": "orders", "filter": { "x": 1 }, "comment": "run-7", "$db": "shop",
                         "lsid": { "id": 1 } },
        }
    }

    /// AC-4: the field mapping of a running operation.
    #[test]
    fn a_running_op_maps_to_a_row() {
        let row = map_op(&running_find(), &info(Some("app"), true, false)).unwrap();
        assert_eq!(row.id, "4821");
        assert_eq!(row.user.as_deref(), Some("app"));
        assert_eq!(row.database.as_deref(), Some("shop"));
        assert_eq!(row.state, SessionState::Active);
        assert_eq!(row.query_ms, Some(6500));
        assert_eq!(row.op_type.as_deref(), Some("query"));
        assert_eq!(row.client.as_deref(), Some("10.0.0.5:51234"));
        assert_eq!(row.run_id.as_deref(), Some("run-7"));
        let q = row.query.unwrap();
        assert!(q.contains("orders") && !q.contains("$db") && !q.contains("lsid") && !q.contains("run-7"), "{q}");
        // Own op, so killable without the killop action.
        assert!(row.can_cancel);
        assert!(!row.can_terminate);
    }

    /// Atlas refuses `$currentOp` with 8000 `AtlasError`, not 13; both must
    /// take the fallback path instead of surfacing the raw error.
    #[test]
    fn atlas_refusal_counts_as_unauthorized() {
        assert!(refused(Some(UNAUTHORIZED)));
        assert!(refused(Some(ATLAS_REFUSED)));
        assert!(!refused(Some(59)));
        assert!(!refused(None));
    }

    #[test]
    fn the_monitors_own_read_is_dropped() {
        let own = doc! { "opid": 1_i32, "active": true, "command": { "aggregate": 1, "comment": MONITOR_COMMENT } };
        assert!(map_op(&own, &info(None, true, true)).is_none());
    }

    /// AC-5, AC-7: idle sessions, open transactions and lock waits.
    #[test]
    fn idle_transactions_and_lock_waits_get_their_states() {
        let i = info(None, true, true);
        let idle = doc! { "active": false, "lsid": { "id": 1 } };
        assert_eq!(map_op(&idle, &i).unwrap().state, SessionState::Idle);
        let tx = doc! { "active": false, "transaction": { "timeOpenMicros": 90_000_000_i64 } };
        let tx = map_op(&tx, &i).unwrap();
        assert_eq!(tx.state, SessionState::IdleInTx);
        assert_eq!(tx.xact_ms, Some(90_000));
        assert!(!tx.can_cancel, "an idle session has no operation to kill");
        let wait = doc! { "opid": 9_i32, "active": true, "waitingForLock": true };
        let wait = map_op(&wait, &i).unwrap();
        assert_eq!(wait.state, SessionState::Waiting);
        assert_eq!(wait.wait.as_deref(), Some("waiting for lock"));
    }

    /// AC-15, AC-17: another user's op needs killop; through mongos the
    /// opid is a string and the row carries its shard.
    #[test]
    fn others_ops_need_killop_and_mongos_opids_are_strings() {
        let mut op = running_find();
        op.insert("effectiveUsers", vec![Bson::Document(doc! { "user": "bob" })]);
        op.insert("opid", "shard0:123");
        op.insert("shard", "shard0");
        let row = map_op(&op, &info(Some("app"), true, false)).unwrap();
        assert!(!row.can_cancel);
        assert_eq!(row.id, "shard0:123");
        assert_eq!(row.shard.as_deref(), Some("shard0"));
        assert!(map_op(&op, &info(Some("app"), true, true)).unwrap().can_cancel);
        assert_eq!(opid_bson("shard0:123"), Bson::String("shard0:123".into()));
        assert_eq!(opid_bson("4821"), Bson::Int32(4821));
        assert_eq!(opid_bson("9999999999"), Bson::Int64(9_999_999_999));
    }

    #[test]
    fn a_getmore_shows_the_command_that_opened_its_cursor() {
        let op = doc! {
            "opid": 5_i32, "active": true, "op": "getmore",
            "command": { "getMore": 77_i64, "collection": "orders" },
            "originatingCommand": { "find": "orders", "filter": { "big": true }, "comment": "run-9" },
        };
        let row = map_op(&op, &info(None, true, true)).unwrap();
        assert!(row.query.unwrap().contains("big"));
        assert_eq!(row.run_id.as_deref(), Some("run-9"));
    }

    #[test]
    fn rights_come_from_cluster_privileges() {
        let status = doc! { "authInfo": {
            "authenticatedUsers": [{ "user": "app", "db": "admin" }],
            "authenticatedUserPrivileges": [
                { "resource": { "cluster": true }, "actions": ["inprog", "serverStatus"] },
                { "resource": { "db": "shop", "collection": "" }, "actions": ["killop"] },
            ],
        } };
        assert_eq!(rights_from(&status), (Some("app".into()), true, false));
        let no_auth = doc! { "authInfo": { "authenticatedUsers": [], "authenticatedUserPrivileges": [] } };
        assert_eq!(rights_from(&no_auth), (None, true, true));
    }

    #[test]
    fn the_node_note_names_mongos_and_replica_sets() {
        assert_eq!(node_note(&doc! { "msg": "isdbgrid" }).as_deref(), Some("Connected through mongos"));
        assert_eq!(
            node_note(&doc! { "setName": "rs0", "isWritablePrimary": true }).as_deref(),
            Some("Primary of rs0")
        );
        assert_eq!(node_note(&doc! { "setName": "rs0", "secondary": true }).as_deref(), Some("Secondary of rs0"));
        assert_eq!(node_note(&doc! { "isWritablePrimary": true }), None);
    }
}
