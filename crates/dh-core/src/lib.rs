//! Shared core for dh-studio.
//!
//! Everything that both the desktop shell (`src-tauri`) and the team server
//! (`dh-server`) need lives here: database adapters, the frontend facing
//! wire API types, the activity log, and the SSH tunnel. The team server's
//! own execution engine (the Axum router, the connection gateway, the
//! Postgres backed store) lives in `dh-server`, and the wire types/HTTP
//! client shared between the desktop app and that server live in
//! `dh-server-client` — see spec 0012.
//!
//! - [`api`]   — wire types shared with the frontend (mirrored by `src/shared/api/types.ts`)
//! - [`db`]    — connection registry + `DbAdapter` implementations (SQLite, PostgreSQL)
//! - [`activity`] — in-memory activity ring buffer with a pluggable emitter

pub mod activity;
pub mod api;
pub mod db;
pub mod ssh_tunnel;
