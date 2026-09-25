//! MongoDB adapter: connects over TCP, lists databases/collections, serves
//! document browsing/editing and the MongoDB console (find/aggregate/shell
//! subset), and — per `MONGODB_SUPPORT.md` Phase 4 — runs a `SELECT`-only SQL
//! subset (see `mongo_sql.rs`) translated to `find()`. Writes/DDL via SQL
//! remain unsupported; use the grid or the MongoDB console for those.

mod params;
mod filter;
mod cancel;
mod console_parse;
mod console_guard;
pub use console_guard::mongo_script_class;
mod convert;
mod field_tree;
mod schema;
mod indexes;
mod documents;
mod stream;
#[cfg(test)]
mod stream_live_tests;
mod console;
mod console_bare;
mod edit;
mod import_docs;
mod import_rows;
#[cfg(test)]
mod import_tests;
mod ddl;
mod explain;
mod adapter;
#[cfg(test)]
mod tests;

pub use params::MongoParams;

use mongodb::Client;
use super::read_only::ReadOnlyGuard;
use super::{CatalogOverview, SchemaObject, SchemaObjectKind, inline_placeholders, mongo_json, mongo_sql};

pub struct MongoAdapter {
    client: Client,
    /// Database unqualified collection operations resolve against. Starts as
    /// the database the connection was opened with, but the user can switch
    /// it (a Mongo connection spans every database on the server) — see
    /// `set_active_schema`. A sync `RwLock` is fine: it's only ever held for
    /// a clone/assign, never across an `.await`.
    database: std::sync::RwLock<String>,
    /// Refuses writes on a read only connection (spec 0007). Fixed for the
    /// life of the adapter. Mongo has no session lock underneath, so this
    /// guard plus the console's parsed method is all there is: a guardrail,
    /// not a wall.
    guard: ReadOnlyGuard,
    /// Kept alive for as long as this adapter is — dropping it tears the
    /// tunnel down out from under the client. `None` when this connection
    /// doesn't go through SSH.
    _ssh_tunnel: Option<crate::ssh_tunnel::LocalTunnel>,
}
