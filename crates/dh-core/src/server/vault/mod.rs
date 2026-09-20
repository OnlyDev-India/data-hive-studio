//! Shared connection details, encrypted at rest. Passwords are AES-256-GCM
//! sealed with the server master key and never included in metadata
//! listings.
//!
//! Every shared connection predates the `kind` column and was implicitly
//! Postgres, so the column defaults to `'postgres'` and the common
//! host/port/user/password/database/ssl_mode shape below covers it exactly.
//! MongoDB (see [`AdapterParams`]) reuses the same common columns plus three
//! Mongo-only ones (`auth_db`/`srv`/`tls`, all optional/defaulted so Postgres
//! rows are unaffected).

mod secrets;
mod rows;
mod crud;
mod params;
#[cfg(test)]
mod tests;

use crate::api::DbKind;

/// Everything a client may see about a shared connection — never the password.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConnMeta {
    pub id: String,
    pub org_id: String,
    pub name: String,
    #[serde(default)]
    pub kind: DbKind,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub database: String,
    pub ssl_mode: Option<String>,
    /// MongoDB only: auth source database.
    #[serde(default)]
    pub auth_db: Option<String>,
    /// MongoDB only: use mongodb+srv:// (DNS seedlist).
    #[serde(default)]
    pub srv: bool,
    /// MongoDB only: require TLS on a plain mongodb:// connection.
    #[serde(default)]
    pub tls: bool,
    /// Path (on whichever machine makes the connection — the team-server,
    /// for a shared connection) to a CA certificate verifying the server.
    #[serde(default)]
    pub ssl_ca_file: Option<String>,
    /// Path to a client certificate for mutual TLS (mTLS). Postgres: paired
    /// with `ssl_client_key_file`. MongoDB: a single PEM with both the
    /// certificate and its (unencrypted) private key — `ssl_client_key_file`
    /// is ignored for MongoDB.
    #[serde(default)]
    pub ssl_client_cert_file: Option<String>,
    /// Postgres only: path to the client certificate's private key file.
    #[serde(default)]
    pub ssl_client_key_file: Option<String>,
    /// MongoDB only: disable retryable writes (`retryWrites=false`) —
    /// required for Amazon DocumentDB.
    #[serde(default)]
    pub retry_writes: bool,
    /// MongoDB only: replica set name (`replicaSet=...`) — required by a
    /// real Amazon DocumentDB cluster, typically `rs0`.
    #[serde(default)]
    pub replica_set: Option<String>,
    /// Reach this connection through an SSH tunnel — `None`/absent host
    /// means no tunnel. Never carries secrets (password/key passphrase);
    /// those only ever appear in [`ConnInput`] going in, or decrypted
    /// inside [`AdapterParams`] on the way to an adapter's `connect()`.
    #[serde(default)]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_user: Option<String>,
    /// "password" | "key".
    #[serde(default)]
    pub ssh_auth_mode: Option<String>,
    #[serde(default)]
    pub ssh_key_file: Option<String>,
    /// Trust-on-first-use host key pin — see `ssh_tunnel::SshConfig`.
    #[serde(default)]
    pub ssh_host_key_fingerprint: Option<String>,
    /// Max pool connections (Postgres default 12, MongoDB default 10 when unset).
    #[serde(default)]
    pub pool_max: Option<u32>,
    /// Min pool connections kept open (Postgres default 1, MongoDB default 0 when unset).
    #[serde(default)]
    pub pool_min: Option<u32>,
    /// How long to wait for a connection before giving up (Postgres: pool
    /// acquire timeout, default 30s. MongoDB: TCP connect timeout, default 10s).
    #[serde(default)]
    pub connect_timeout_secs: Option<u32>,
    /// How long a pooled connection can sit idle before being closed
    /// (Postgres default 15 minutes; MongoDB default never, when unset).
    #[serde(default)]
    pub idle_timeout_secs: Option<u32>,
    /// Postgres only: max lifetime of a pooled connection regardless of
    /// activity (default 30 minutes when unset).
    #[serde(default)]
    pub max_lifetime_secs: Option<u32>,
    /// MongoDB only: how long to keep trying to find a usable server before
    /// giving up on an operation (default 30s when unset).
    #[serde(default)]
    pub server_selection_timeout_secs: Option<u32>,
    pub created_by: String,
    pub created_ms: i64,
    pub updated_ms: i64,
}

/// Payload for creating or editing a connection's stored details.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConnInput {
    pub name: String,
    /// Immutable after creation — `conn_update` never changes it.
    #[serde(default)]
    pub kind: DbKind,
    pub host: String,
    pub port: u16,
    pub user: String,
    /// `None` on update = keep the existing password.
    pub password: Option<String>,
    pub database: String,
    #[serde(default)]
    pub ssl_mode: Option<String>,
    /// MongoDB only: auth source database (defaults to "admin" when None).
    #[serde(default)]
    pub auth_db: Option<String>,
    /// MongoDB only: use mongodb+srv:// (DNS seedlist) instead of mongodb://.
    #[serde(default)]
    pub srv: bool,
    /// MongoDB only: require TLS on a plain mongodb:// connection.
    #[serde(default)]
    pub tls: bool,
    #[serde(default)]
    pub ssl_ca_file: Option<String>,
    #[serde(default)]
    pub ssl_client_cert_file: Option<String>,
    /// Postgres only.
    #[serde(default)]
    pub ssl_client_key_file: Option<String>,
    /// MongoDB only: disable retryable writes — required for Amazon
    /// DocumentDB.
    #[serde(default)]
    pub retry_writes: bool,
    /// MongoDB only: replica set name — required by a real Amazon
    /// DocumentDB cluster, typically `rs0`.
    #[serde(default)]
    pub replica_set: Option<String>,
    #[serde(default)]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_user: Option<String>,
    #[serde(default)]
    pub ssh_auth_mode: Option<String>,
    #[serde(default)]
    pub ssh_key_file: Option<String>,
    #[serde(default)]
    pub ssh_host_key_fingerprint: Option<String>,
    #[serde(default)]
    pub pool_max: Option<u32>,
    #[serde(default)]
    pub pool_min: Option<u32>,
    #[serde(default)]
    pub connect_timeout_secs: Option<u32>,
    #[serde(default)]
    pub idle_timeout_secs: Option<u32>,
    /// Postgres only.
    #[serde(default)]
    pub max_lifetime_secs: Option<u32>,
    /// MongoDB only.
    #[serde(default)]
    pub server_selection_timeout_secs: Option<u32>,
    /// `None` on update keeps the existing stored SSH password (if any).
    /// Ignored when `ssh_host` is `None` (tunnel disabled — any stored SSH
    /// secrets are cleared).
    #[serde(default)]
    pub ssh_password: Option<String>,
    /// Same "`None` on update keeps the existing one" rule as `ssh_password`.
    #[serde(default)]
    pub ssh_key_passphrase: Option<String>,
}

/// Decrypted connection parameters ready to hand to the matching adapter's
/// `connect()`. One variant per [`DbKind`] the team-server can proxy;
/// [`super::gateway::Gateway`] matches on this to build the right
/// `Arc<dyn DbAdapter>` instead of being hardcoded to Postgres.
pub enum AdapterParams {
    Postgres(crate::db::PgParams),
    Mongodb(crate::db::MongoParams),
}

pub const ERR_NOT_FOUND: &str = "connection not found";
