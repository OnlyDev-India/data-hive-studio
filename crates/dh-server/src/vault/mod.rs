//! The connection vault's server only pieces: CRUD against Postgres, and
//! decrypting stored secrets into the params an adapter's `connect()`
//! needs. The shared shapes (`ConnMeta`, `ConnInput`) live in
//! `dh_server_client::vault` (spec 0012).

mod secrets;
mod rows;
mod crud;
mod params;
#[cfg(test)]
mod tests;

/// Decrypted connection parameters ready to hand to the matching adapter's
/// `connect()`. One variant per `DbKind` the team-server can proxy;
/// [`crate::gateway::Gateway`] matches on this to build the right
/// `Arc<dyn DbAdapter>` instead of being hardcoded to Postgres. Never
/// serialized (no client, including the desktop app, ever sees it), and it
/// wraps `dh-core`'s own adapter param types, so unlike `ConnMeta`/
/// `ConnInput` it stays server only rather than moving to
/// `dh-server-client` (spec 0012).
pub enum AdapterParams {
    Postgres(dh_core::db::PgParams),
    Mongodb(dh_core::db::MongoParams),
}

pub const ERR_NOT_FOUND: &str = "connection not found";
