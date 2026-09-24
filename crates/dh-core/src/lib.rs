//! Shared core for dh-studio.
//!
//! Everything that both the desktop shell (`src-tauri`) and the proxy server
//! (`dh-server`) need lives here: database adapters, the frontend facing
//! wire API types, the activity log, and the SSH tunnel. The server's own
//! code (the Axum router, the handle registry, the request guards) lives in
//! `dh-server` — see spec 0010.
//!
//! - [`api`]   — wire types shared with the frontend (mirrored by `src/shared/api/types.ts`)
//! - [`db`]    — connection registry + `DbAdapter` implementations (SQLite, PostgreSQL)
//! - [`activity`] — in-memory activity ring buffer with a pluggable emitter

pub mod activity;
pub mod api;
pub mod db;
pub mod ssh_tunnel;
