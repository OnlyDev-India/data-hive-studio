//! Shared between the desktop app (`src-tauri`) and the team server
//! (`dh-server`): the wire types both sides serialize, the HTTP client the
//! desktop uses to talk to a remote server, crypto helpers, and saved
//! server profiles. Zero `sqlx`, `axum`, or `tower-http` — anything needing
//! those belongs in `dh-server` instead (see spec 0012).

pub mod auth;
pub mod client;
pub mod crypto;
pub mod gateway;
pub mod grants;
pub mod orgs;
pub mod profiles;
pub mod store;
pub mod vault;
