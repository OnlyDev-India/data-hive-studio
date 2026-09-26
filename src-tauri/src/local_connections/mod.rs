//! Locally saved connection profiles (desktop only; the web page keeps its own
//! saved connections in the browser).
//!
//! Metadata (host, port, user, database, kind, …) lives in a plain JSON file
//! in the app-data dir. Passwords and SSH secrets live in the encrypted
//! `secret_store`, joined to the metadata by connection name.
//!
//! Connections are keyed by their display `name`, matching how the frontend
//! already keyed `savedLocal` before this module existed (see
//! `src/shared/store/store.ts`) — renames move the secret record inside
//! `update_local_connection` rather than introducing a separate stable id.

mod model;
mod ops;

pub use model::*;
pub use ops::*;
