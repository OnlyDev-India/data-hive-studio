//! Shared core for dh-studio.
//!
//! Everything that is not Tauri-specific lives here so multiple builds can
//! reuse it: the desktop shell (`src-tauri`), the deployable server binary
//! (`dh-server`, planned), and integration tests.
//!
//! - [`api`]   — wire types shared with the frontend (mirrored by `src/shared/api/types.ts`)
//! - [`db`]    — connection registry + `DbAdapter` implementations (SQLite, PostgreSQL)
//! - [`activity`] — in-memory activity ring buffer with a pluggable emitter

pub mod activity;
pub mod api;
pub mod db;
pub mod server;
