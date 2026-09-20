//! Locally saved connection profiles (desktop only — web mode has no local
//! connections; the team-server holds all credentials there, see
//! `src/shared/api/web.ts`'s doc comment).
//!
//! Metadata (host, port, user, database, kind, …) lives in a plain JSON file
//! in the app-data dir. Passwords live in the OS keychain, following the
//! same pattern `servers.rs` already established for server auth tokens —
//! including its debug-build file fallback, since every `tauri dev` rebuild
//! is a new unsigned binary and macOS would otherwise re-prompt for
//! keychain access on every single launch.
//!
//! Connections are keyed by their display `name`, matching how the frontend
//! already keyed `savedLocal` before this module existed (see
//! `src/shared/store/store.ts`) — renames are handled by moving the
//! keychain entry (delete old, create new) inside `update_local_connection`
//! rather than introducing a separate stable id.

mod model;
mod secrets;
mod ops;

pub use model::*;
pub use ops::*;

const KEYRING_SERVICE: &str = "dh-studio-connections";
