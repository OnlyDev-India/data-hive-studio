//! Shared between the desktop app (`src-tauri`) and the team server
//! (`dh-server`): the wire types both sides serialize, the HTTP client the
//! desktop uses to talk to a remote server, crypto helpers, and saved
//! server profiles. Zero `sqlx`, `axum`, or `tower-http` — anything needing
//! those belongs in `dh-server` instead (see spec 0012).

pub mod crypto;
