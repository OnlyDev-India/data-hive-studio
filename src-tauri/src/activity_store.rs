//! On-disk persistence for the backend activity log (query history).
//!
//! `dh_core::activity` is deliberately Tauri/filesystem-agnostic (see its
//! own doc comment), so this module owns the actual file I/O and only ever
//! talks to it through its public `snapshot`/`restore` functions. The log
//! is capped at 500 entries in memory already, so a full-snapshot rewrite
//! on every new entry stays cheap — simpler and less error-prone than
//! incremental append + separate rotation bookkeeping.

use dh_core::activity::ActivityEntry;
use tauri::Manager;

const CAP: usize = 500;

fn log_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("activity.json"))
}

/// Load the snapshot a previous run persisted. Missing or corrupt file →
/// empty, never an error — query history is a convenience, not something
/// worth blocking startup over.
pub fn load(app: &tauri::AppHandle) -> Vec<ActivityEntry> {
    let Ok(path) = log_path(app) else {
        return Vec::new();
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

/// Rewrite the on-disk snapshot from the current in-memory log. Called after
/// every newly logged entry.
pub fn persist(app: &tauri::AppHandle) {
    let Ok(path) = log_path(app) else {
        return;
    };
    let snap = dh_core::activity::snapshot(CAP);
    if let Ok(raw) = serde_json::to_string(&snap) {
        let _ = std::fs::write(path, raw);
    }
}
