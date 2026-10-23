//! MySQL and MariaDB adapter (spec 0025): one adapter for both picker
//! entries, on sqlx's `mysql` driver. It reads `VERSION()` at connect and
//! branches on the detected flavor and version ([`ServerInfo`]), never on
//! the `DbKind` the user picked. MySQL has no schema level: a connection
//! holds databases, and `database` arguments target one directly.

mod params;
mod connect;
mod sql_text;
mod rows;
mod bytes;
mod filters;
mod cancel;
mod stream;
mod query;
mod edit;
mod read_only;
mod catalog;
mod objects;
mod users;
mod ddl;
mod schema_plan;
mod schema_apply;
mod import_rows;
mod graph;
mod compare;
mod explain;
mod adapter;
#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod sidebar_live_tests;
#[cfg(test)]
mod schema_live_tests;
#[cfg(test)]
mod import_live_tests;
#[cfg(test)]
mod parity_live_tests;

pub use connect::{Flavor, ServerInfo};
pub use params::MySqlParams;

use sqlx::MySqlPool;
use super::read_only::ReadOnlyGuard;

pub struct MySqlAdapter {
    /// One pool for every database on the server: a MySQL connection can
    /// reach any database it may read, so no per database pools.
    pool: MySqlPool,
    /// What `VERSION()` said at connect.
    server: ServerInfo,
    /// The connection's default database, `None` when it lands on the
    /// server.
    database: Option<String>,
    /// Kept so Stop can open its one off `KILL QUERY` connection with the
    /// same host, credentials and TLS settings.
    params: MySqlParams,
    guard: ReadOnlyGuard,
    /// Kept alive as long as the adapter: dropping it closes the tunnel.
    _ssh_tunnel: Option<crate::ssh_tunnel::LocalTunnel>,
}

impl MySqlAdapter {
    /// What the adapter detected at connect.
    pub fn server(&self) -> ServerInfo {
        self.server
    }
}
