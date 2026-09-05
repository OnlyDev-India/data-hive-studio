//! "Open with DH Studio" / default-app support for `.db`/`.sqlite`/
//! `.sqlite3` files (registered via `tauri.conf.json`'s
//! `bundle.fileAssociations`).
//!
//! The OS hands us the file path two different ways depending on platform
//! and whether the app was already running:
//! - Windows/Linux, cold start: the path arrives as a plain CLI argument.
//! - macOS (any start), and a warm second-open on any platform: as a
//!   `tauri::RunEvent::Opened` event (see `lib.rs`'s `run()`).
//!
//! Either way, if this fires before the frontend has mounted its listener
//! (the common cold-start case — `RunEvent::Opened`/`setup()` both run long
//! before the webview finishes loading React), a plain Tauri event would
//! simply be lost: events aren't queued for listeners that don't exist yet.
//! So every path is written into this buffer, and the frontend also polls
//! it once via `take_pending_open_path` right after it mounts.

use std::sync::Mutex;

static PENDING_OPEN_PATH: Mutex<Option<String>> = Mutex::new(None);

pub fn set_pending(path: String) {
    *PENDING_OPEN_PATH.lock().unwrap() = Some(path);
}

/// Cold-start-only: the OS may pass the file path as a plain CLI argument
/// (`argv[1]`) rather than a `RunEvent::Opened` — reliable on Windows/Linux,
/// not on macOS (Launch Services uses the Apple Event mechanism instead,
/// surfaced separately as `RunEvent::Opened`). Harmless to check
/// unconditionally; a flag-looking or missing argument just means this
/// launch wasn't a file-open.
pub fn check_argv() {
    if let Some(path) = std::env::args().nth(1) {
        if !path.starts_with('-') && !path.is_empty() {
            set_pending(path);
        }
    }
}

/// One-shot fetch — clears the buffer so a later call (there shouldn't be
/// one in the same session) doesn't replay a stale path.
#[tauri::command]
pub fn take_pending_open_path() -> Option<String> {
    PENDING_OPEN_PATH.lock().unwrap().take()
}
