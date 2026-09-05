//! Persisted workspace/session state: which connections were open, their
//! tabs and pane layout, and live query-editor text — so relaunching the
//! app resumes where the user left off. Mirrors `local_connections.rs`'s
//! pattern: one JSON file in the app-data dir, full-rewrite on save, never a
//! hard error on load (missing/corrupt file → treated as "nothing saved").
//!
//! Connections are NOT auto-reconnected on restore — that's a frontend
//! policy decision (see `src/shared/store/workspace-persistence.ts`), not
//! this module's concern. This side only stores/retrieves an opaque JSON
//! blob: the frontend owns the actual shape (it's zustand state), and
//! duplicating that shape as Rust structs here would just be two schemas to
//! keep in sync for data this module never needs to interpret — the same
//! reasoning that keeps `activity.json`'s payload type-checked (it IS
//! interpreted on this side) different from this one (it isn't).

use serde_json::Value;
use tauri::{AppHandle, Manager};

fn state_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    let _ = std::fs::create_dir_all(&dir);
    Some(dir.join("workspace_state.json"))
}

/// Load the last-saved snapshot, or `null` if there isn't one / it's
/// unreadable — same "never a hard error" philosophy as `activity_store`.
#[tauri::command]
pub fn load_workspace_state(app: AppHandle) -> Value {
    state_path(&app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null)
}

/// Overwrite the saved snapshot with `state` (a full rewrite, not a merge —
/// the frontend always sends its complete current snapshot).
#[tauri::command]
pub fn save_workspace_state(app: AppHandle, state: Value) {
    let Some(path) = state_path(&app) else { return };
    if let Ok(json) = serde_json::to_string(&state) {
        let _ = std::fs::write(path, json);
    }
}

/// Forget the saved snapshot entirely (e.g. a "reset workspace" action).
#[tauri::command]
pub fn clear_workspace_state(app: AppHandle) {
    if let Some(path) = state_path(&app) {
        let _ = std::fs::remove_file(path);
    }
}
