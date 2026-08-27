//! In-memory activity log of every command the backend executes.
//!
//! The `db::` wrappers record one entry per call (operation kind, target,
//! duration, affected rows, error) into a bounded ring buffer and hand the
//! entry to a pluggable emitter, so each host can decide how entries reach
//! its UI (the desktop shell emits them as `activity://entry` Tauri events).

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// One executed backend command.
/// Full SQL text when the command is a statement (SQL console / param
/// runners). Absent for grid ops and introspection.
#[derive(Debug, Clone, Serialize)]
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
}

const CAP: usize = 500;

static SEQ: AtomicU64 = AtomicU64::new(0);
static LOG: Mutex<VecDeque<ActivityEntry>> = Mutex::new(VecDeque::new());

/// Host-provided sink for live entries (e.g. forwards to the Tauri event
/// system). The core stays UI-agnostic — no Tauri dependency here.
type EmitFn = Arc<dyn Fn(&ActivityEntry) + Send + Sync>;
static EMIT: OnceLock<EmitFn> = OnceLock::new();

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

fn push(mut entry: ActivityEntry) {
    entry.id = next_id();
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

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Record a successful command. `rows` is the affected/returned count when
/// meaningful (pass 0 otherwise).
pub fn log_ok(conn_id: &str, kind: &str, target: &str, started: Instant, rows: i64) {
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
    });
}

/// Record a failed command with its error message.
pub fn log_err(conn_id: &str, kind: &str, target: &str, started: Instant, err: &crate::db::DbError) {
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
    });
}

/// Record a successful statement, keeping the FULL text (multi-line,
/// comments and all) for the details tab. `kind` labels the source — "sql"
/// for console statements, "select"/"count"/… for structured grid ops. The
/// panel row shows a one-line preview; the details tab renders everything.
pub fn log_stmt_ok(conn_id: &str, kind: &str, sql: &str, started: Instant, rows: i64) {
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
    });
}

/// Record a failed statement with its full text + error.
pub fn log_stmt_err(conn_id: &str, kind: &str, sql: &str, started: Instant, err: &crate::db::DbError) {
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
