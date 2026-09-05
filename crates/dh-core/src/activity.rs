//! In-memory activity log of every command the backend executes.
//!
//! The `db::` wrappers record one entry per call (operation kind, target,
//! duration, affected rows, error) into a bounded ring buffer and hand the
//! entry to a pluggable emitter, so each host can decide how entries reach
//! its UI (the desktop shell emits them as `activity://entry` Tauri events).

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// One executed backend command.
/// Full SQL text when the command is a statement (SQL console / param
/// runners). Absent for grid ops and introspection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityEntry {
    pub id: u64,
    /// Wall-clock epoch milliseconds (rendered as HH:MM:SS in the panel).
    pub ts_ms: i64,
    pub conn_id: String,
    /// Coarse operation class: select | count | distinct | insert | update |
    /// delete | drop_table | sql | ddl | duplicate | schema | connect |
    /// disconnect.
    pub kind: String,
    /// Table name, SQL snippet, or database name — what the command touched.
    pub target: String,
    pub ok: bool,
    /// Rows returned / affected when meaningful, else 0.
    pub rows: i64,
    pub duration_ms: f64,
    pub error: Option<String>,
    pub sql: Option<String>,
    /// "user" for something the user directly asked for (a console
    /// statement, a grid edit, an explicit DDL/schema action) vs "app" for
    /// everything else the app logs on its own initiative — background
    /// schema introspection for autocomplete/the sidebar tree, and
    /// connect/disconnect lifecycle events (plumbing, not a query the user
    /// ran). Explicit per call site rather than inferred from `kind` —
    /// `kind == "schema"` covers BOTH an explicit "switch active schema"
    /// (user) and a background describe-table prefetch (app), so `kind`
    /// alone can't tell them apart.
    #[serde(default = "default_origin")]
    pub origin: String,
    /// Stable identity for the connection this entry belongs to — NOT
    /// `conn_id` (a fresh id every connect, so it can never match a PAST
    /// session's entries for the same database) — see `set_conn_key_resolver`.
    /// `None` for entries logged before this field existed, or for the
    /// brief window before a brand-new connection is registered.
    #[serde(default)]
    pub conn_key: Option<String>,
}

fn default_origin() -> String {
    "user".to_string()
}

const CAP: usize = 500;

static SEQ: AtomicU64 = AtomicU64::new(0);
static LOG: Mutex<VecDeque<ActivityEntry>> = Mutex::new(VecDeque::new());

/// Host-provided sink for live entries (e.g. forwards to the Tauri event
/// system). The core stays UI-agnostic — no Tauri dependency here.
type EmitFn = Arc<dyn Fn(&ActivityEntry) + Send + Sync>;
static EMIT: OnceLock<EmitFn> = OnceLock::new();

/// Resolves a runtime `conn_id` to the STABLE identity of the target it
/// points at (e.g. a file path for SQLite, host+db for a server) — so
/// entries from different connect sessions to the SAME database can be
/// matched together. Registered once by `db::` at startup (it owns the
/// connection registry this needs; `activity` stays dependency-free of
/// `db` otherwise, same reasoning as `EmitFn`).
type ConnKeyResolver = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;
static CONN_KEY_RESOLVER: OnceLock<ConnKeyResolver> = OnceLock::new();

pub fn set_conn_key_resolver(f: ConnKeyResolver) {
    let _ = CONN_KEY_RESOLVER.set(f);
}

/// Unique across restarts: epoch-ms bucket + per-ms counter. A bare counter
/// resets to 0 on every launch, colliding with entries restored by
/// `get_activity` hydration (duplicate React keys / multi-select).
fn next_id() -> u64 {
    now_ms() as u64 * 4096 + (SEQ.fetch_add(1, Ordering::Relaxed) % 4096)
}

/// Called once during host startup so entries can be pushed to the frontend.
/// Only the first registration wins.
pub fn set_emitter(f: EmitFn) {
    let _ = EMIT.set(f);
}

/// Newest-first snapshot for hydrating the panel (window reload).
pub fn snapshot(limit: usize) -> Vec<ActivityEntry> {
    let log = LOG.lock().unwrap();
    log.iter().rev().take(limit).cloned().collect()
}

pub fn clear() {
    LOG.lock().unwrap().clear();
}

/// Seed the in-memory log at startup from a host-persisted snapshot (see
/// `snapshot()` — same newest-first order). Host-only concern: whether/how
/// entries survive a restart lives entirely on the host side (filesystem,
/// Tauri app-data dir, …), never here — this just accepts whatever the host
/// already loaded. A no-op once the log has real entries, so it's safe to
/// call exactly once during startup before anything else logs an entry.
pub fn restore(entries: Vec<ActivityEntry>) {
    let mut log = LOG.lock().unwrap();
    if !log.is_empty() {
        return;
    }
    // `entries` is newest-first; push_back in that same order would put the
    // newest at the BACK. Walk it in reverse so push_back reproduces the
    // newest-at-front layout `push_front` normally builds.
    for entry in entries.into_iter().rev() {
        log.push_back(entry);
    }
}

fn push(mut entry: ActivityEntry) {
    entry.id = next_id();
    if let Some(resolve) = CONN_KEY_RESOLVER.get() {
        entry.conn_key = resolve(&entry.conn_id);
    }
    let mut log = LOG.lock().unwrap();
    log.push_front(entry.clone());
    if log.len() > CAP {
        log.truncate(CAP);
    }
    drop(log);
    if let Some(emit) = EMIT.get() {
        emit(&entry);
    }
}

/// Remove entries for one connection (matched by stable `conn_key` when the
/// entry has one, else by the raw `conn_id` — the fallback for entries
/// logged before `conn_key` existed, which won't match a past session's
/// `conn_id` but at least still clears the CURRENT session's own entries).
/// `None` for both clears everything.
pub fn clear_matching(conn_key: Option<&str>, conn_id: Option<&str>) {
    if conn_key.is_none() && conn_id.is_none() {
        LOG.lock().unwrap().clear();
        return;
    }
    LOG.lock().unwrap().retain(|e| {
        let matches = match (&e.conn_key, conn_key) {
            (Some(ek), Some(k)) => ek == k,
            _ => conn_id.is_some_and(|id| e.conn_id == id),
        };
        !matches
    });
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Record a successful command. `rows` is the affected/returned count when
/// meaningful (pass 0 otherwise). Always logged as user-initiated — see
/// `log_ok_origin` for the (currently rare) case where that isn't true.
pub fn log_ok(conn_id: &str, kind: &str, target: &str, started: Instant, rows: i64) {
    log_ok_origin(conn_id, kind, target, started, rows, "user");
}

/// Like `log_ok`, but lets the caller say whether this was user-initiated or
/// the app's own background work (e.g. a schema-introspection prefetch that
/// powers autocomplete, as opposed to the user explicitly opening a Schema
/// tab) — `kind` alone can't always tell (`"schema"` covers both).
pub fn log_ok_origin(conn_id: &str, kind: &str, target: &str, started: Instant, rows: i64, origin: &str) {
    push(ActivityEntry {
        id: 0,
        ts_ms: now_ms(),
        conn_id: conn_id.to_string(),
        kind: kind.to_string(),
        target: clip(target),
        ok: true,
        rows,
        duration_ms: started.elapsed().as_secs_f64() * 1000.0,
        error: None,
        sql: None,
        origin: origin.to_string(),
        conn_key: None,
    });
}

/// Record a failed command with its error message. Always user-initiated —
/// see `log_err_origin`.
pub fn log_err(conn_id: &str, kind: &str, target: &str, started: Instant, err: &crate::db::DbError) {
    log_err_origin(conn_id, kind, target, started, err, "user");
}

/// Like `log_err`, but with an explicit origin — see `log_ok_origin`.
pub fn log_err_origin(
    conn_id: &str,
    kind: &str,
    target: &str,
    started: Instant,
    err: &crate::db::DbError,
    origin: &str,
) {
    push(ActivityEntry {
        id: 0,
        ts_ms: now_ms(),
        conn_id: conn_id.to_string(),
        kind: kind.to_string(),
        target: clip(target),
        ok: false,
        rows: 0,
        duration_ms: started.elapsed().as_secs_f64() * 1000.0,
        error: Some(err.to_string()),
        sql: None,
        origin: origin.to_string(),
        conn_key: None,
    });
}

/// Record a successful statement, keeping the FULL text (multi-line,
/// comments and all) for the details tab. `kind` labels the source — "sql"
/// for console statements, "select"/"count"/… for structured grid ops. The
/// panel row shows a one-line preview; the details tab renders everything.
/// Always user-initiated — see `log_stmt_ok_origin`.
pub fn log_stmt_ok(conn_id: &str, kind: &str, sql: &str, started: Instant, rows: i64) {
    log_stmt_ok_origin(conn_id, kind, sql, started, rows, "user");
}

/// Like `log_stmt_ok`, but with an explicit origin — see `log_ok_origin`.
pub fn log_stmt_ok_origin(
    conn_id: &str,
    kind: &str,
    sql: &str,
    started: Instant,
    rows: i64,
    origin: &str,
) {
    push(ActivityEntry {
        id: 0,
        ts_ms: now_ms(),
        conn_id: conn_id.to_string(),
        kind: kind.to_string(),
        target: clip(&preview(sql)),
        ok: true,
        rows,
        duration_ms: started.elapsed().as_secs_f64() * 1000.0,
        error: None,
        sql: Some(store_sql(sql)),
        origin: origin.to_string(),
        conn_key: None,
    });
}

/// Record a failed statement with its full text + error. Always
/// user-initiated — see `log_stmt_err_origin`.
pub fn log_stmt_err(conn_id: &str, kind: &str, sql: &str, started: Instant, err: &crate::db::DbError) {
    log_stmt_err_origin(conn_id, kind, sql, started, err, "user");
}

/// Like `log_stmt_err`, but with an explicit origin — see `log_ok_origin`.
pub fn log_stmt_err_origin(
    conn_id: &str,
    kind: &str,
    sql: &str,
    started: Instant,
    err: &crate::db::DbError,
    origin: &str,
) {
    push(ActivityEntry {
        id: 0,
        ts_ms: now_ms(),
        conn_id: conn_id.to_string(),
        kind: kind.to_string(),
        target: clip(&preview(sql)),
        ok: false,
        rows: 0,
        duration_ms: started.elapsed().as_secs_f64() * 1000.0,
        error: Some(err.to_string()),
        sql: Some(store_sql(sql)),
        origin: origin.to_string(),
        conn_key: None,
    });
}

/// One-line panel preview of a statement: leading `--` comments and blank
/// lines dropped, remaining lines joined. `clip` truncates the result.
fn preview(sql: &str) -> String {
    let body: Vec<&str> = sql
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("--"))
        .collect();
    if body.is_empty() {
        // Comment-only text (odd but possible) — show whatever is there.
        return sql
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .unwrap_or("")
            .to_string();
    }
    body.join(" ")
}

/// Cap stored SQL so a pasted 2 MB script can't balloon the ring buffer.
fn store_sql(sql: &str) -> String {
    const MAX: usize = 8192;
    if sql.len() <= MAX {
        return sql.to_string();
    }
    let mut cut = MAX;
    while !sql.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}\n… (truncated)", &sql[..cut])
}

/// Keep targets readable in the panel — long SQL collapses to one line.
fn clip(target: &str) -> String {
    let mut out = target.split_whitespace().collect::<Vec<_>>().join(" ");
    if out.len() > 160 {
        out.truncate(160);
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A whole `activity.json` written by a pre-`origin` build must still
    /// load — the field is new, so every entry on disk from before this
    /// change is missing it. If this ever stopped deserializing, the entire
    /// saved history would silently vanish on the next launch (activity_store
    /// ::load() treats any parse failure as "nothing saved").
    #[test]
    fn deserializes_pre_origin_entries_as_user() {
        let old_json = r#"[{
            "id": 1,
            "ts_ms": 1700000000000,
            "conn_id": "c1",
            "kind": "sql",
            "target": "SELECT 1",
            "ok": true,
            "rows": 1,
            "duration_ms": 2.5,
            "error": null,
            "sql": "SELECT 1"
        }]"#;
        let entries: Vec<ActivityEntry> =
            serde_json::from_str(old_json).expect("old-format entries must still parse");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].origin, "user");
    }

    #[test]
    fn round_trips_entries_with_origin() {
        let json = serde_json::to_string(&vec![ActivityEntry {
            id: 1,
            ts_ms: 0,
            conn_id: "c1".into(),
            kind: "schema".into(),
            target: "describe t".into(),
            ok: true,
            rows: 0,
            duration_ms: 1.0,
            error: None,
            sql: None,
            origin: "app".into(),
            conn_key: Some("sqlite:/tmp/x.db".into()),
        }])
        .unwrap();
        let back: Vec<ActivityEntry> = serde_json::from_str(&json).unwrap();
        assert_eq!(back[0].origin, "app");
        assert_eq!(back[0].conn_key.as_deref(), Some("sqlite:/tmp/x.db"));
    }
}
