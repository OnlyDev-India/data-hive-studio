use sqlx::PgPool;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use crate::api::ConnGuard;
use crate::db::{DbError, DbResult};

/// Parameters for connecting to a PostgreSQL server.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PgParams {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    /// disable | prefer | require | verify-ca | verify-full (defaults to prefer).
    #[serde(default)]
    pub ssl_mode: Option<String>,
    /// Path to a CA certificate file used to verify the server's
    /// certificate — required for `ssl_mode` "verify-ca"/"verify-full" to
    /// actually verify anything (otherwise there's nothing to check
    /// against). Read from disk wherever the connection is made: the
    /// desktop app's own filesystem for a local connection, or the
    /// team-server's filesystem for a shared one.
    #[serde(default)]
    pub ssl_ca_file: Option<String>,
    /// Path to a client certificate file, for mutual TLS (mTLS). Paired
    /// with `ssl_client_key_file`.
    #[serde(default)]
    pub ssl_client_cert_file: Option<String>,
    /// Path to the client certificate's private key file (unencrypted —
    /// this app doesn't support an encrypted client key's passphrase).
    #[serde(default)]
    pub ssl_client_key_file: Option<String>,
    /// Reach the database through an SSH tunnel (a local port-forward to
    /// `host:port` through this jump host) instead of connecting directly.
    #[serde(default)]
    pub ssh: Option<crate::ssh_tunnel::SshConfig>,
    /// Max pool connections (default 12 when unset).
    #[serde(default)]
    pub pool_max: Option<u32>,
    /// Min pool connections kept open (default 1 when unset).
    #[serde(default)]
    pub pool_min: Option<u32>,
    /// How long to wait for a pooled connection — including opening a new
    /// one if the pool isn't full — before giving up (default 30s when
    /// unset). sqlx has no separate raw-socket connect timeout; this is the
    /// closest real equivalent.
    #[serde(default)]
    pub connect_timeout_secs: Option<u32>,
    /// How long a connection can sit idle in the pool before being closed
    /// (default 15 minutes when unset).
    #[serde(default)]
    pub idle_timeout_secs: Option<u32>,
    /// Max lifetime of a pooled connection regardless of activity, after
    /// which it's closed and replaced (sqlx's own default — currently 30
    /// minutes — applies when unset).
    #[serde(default)]
    pub max_lifetime_secs: Option<u32>,
    /// Read only flag and environment label (spec 0007). The adapter reads
    /// only `read_only`; the rest passes through to `ConnectionInfo`.
    #[serde(flatten)]
    pub guard: ConnGuard,
}

fn ssl_mode(v: Option<&str>) -> sqlx::postgres::PgSslMode {
    use sqlx::postgres::PgSslMode::*;
    match v.unwrap_or("prefer").to_lowercase().as_str() {
        "disable" => Disable,
        "require" => Require,
        "verify-ca" => VerifyCa,
        "verify-full" => VerifyFull,
        _ => Prefer,
    }
}

fn default_port() -> u16 {
    5432
}

/// The part of `PgAdapter::connect` that builds the actual pool, factored out
/// so a secondary pool to a SIBLING database on the same server (see
/// `PgAdapter::pool_for`) can share it instead of duplicating the
/// options/pool-settings wiring.
pub(super) fn pg_connect_options(
    connect_host: &str,
    connect_port: u16,
    params: &PgParams,
    database: &str,
) -> PgConnectOptions {
    let mut options = PgConnectOptions::new()
        // PgBouncer (transaction mode) compatibility: sqlx caches named
        // prepared statements per connection; pooled proxies break that.
        .statement_cache_capacity(0)
        .host(connect_host)
        .port(connect_port)
        .username(&params.user)
        .password(&params.password)
        .database(database)
        .ssl_mode(ssl_mode(params.ssl_mode.as_deref()));
    if let Some(ca) = &params.ssl_ca_file {
        options = options.ssl_root_cert(ca);
    }
    if let Some(cert) = &params.ssl_client_cert_file {
        options = options.ssl_client_cert(cert);
    }
    if let Some(key) = &params.ssl_client_key_file {
        options = options.ssl_client_key(key);
    }
    // Read only lock (spec 0007): every pooled session, secondary pools and
    // the short lived Stop connection included, opens with new transactions
    // read only. The SQL check refuses the statements that could switch it
    // back off; this refuses the writes the check cannot see (a data changing
    // CTE, a writing function). Only set when asked, so a normal connection's
    // startup is unchanged.
    if params.guard.read_only {
        options = options.options([("default_transaction_read_only", "on")]);
    }
    options
}

pub(super) async fn build_pool(
    connect_host: &str,
    connect_port: u16,
    params: &PgParams,
    database: &str,
) -> DbResult<PgPool> {
    let options = pg_connect_options(connect_host, connect_port, params, database);

    // ONE pool, ONE awaited connection: `connect_with` returns as soon as
    // the database answers — same as every other SQL client. Extra
    // connections are opened lazily by sqlx when queries need them (each
    // one gets its own forwarded SSH channel automatically, since the
    // tunnel's local listener accepts however many connections the pool
    // opens over its lifetime).
    let mut pool_opts = PgPoolOptions::new()
        .max_connections(params.pool_max.unwrap_or(12))
        .min_connections(params.pool_min.unwrap_or(1))
        .acquire_timeout(std::time::Duration::from_secs(
            params.connect_timeout_secs.unwrap_or(30) as u64,
        ))
        .idle_timeout(std::time::Duration::from_secs(
            params.idle_timeout_secs.unwrap_or(15 * 60) as u64,
        ));
    if let Some(secs) = params.max_lifetime_secs {
        pool_opts = pool_opts.max_lifetime(std::time::Duration::from_secs(secs as u64));
    }
    pool_opts
        .connect_with(options)
        .await
        .map_err(DbError::SqlEngine)
}

#[cfg(test)]
mod read_only_tests {
    use super::*;

    fn params(read_only: bool) -> PgParams {
        serde_json::from_value(serde_json::json!({
            "host": "db.example", "user": "u", "password": "p", "database": "d",
            "read_only": read_only,
        }))
        .unwrap()
    }

    /// AC-3: a read only connection starts every session with new
    /// transactions read only.
    #[test]
    fn read_only_connection_opens_sessions_read_only() {
        let p = params(true);
        assert!(p.guard.read_only);
        let options = pg_connect_options("db.example", 5432, &p, "d");
        assert_eq!(options.get_options(), Some("-c default_transaction_read_only=on"));
    }

    /// A normal connection's startup is untouched (PgBouncer and friends
    /// never see an `options` startup parameter they did not get before).
    #[test]
    fn normal_connection_sends_no_startup_options() {
        let p = params(false);
        assert!(!p.guard.read_only);
        let options = pg_connect_options("db.example", 5432, &p, "d");
        assert_eq!(options.get_options(), None);
    }

    /// AC-1: params without any of the four keys default to not read only.
    #[test]
    fn params_without_guard_fields_default_to_not_read_only() {
        let p: PgParams = serde_json::from_value(serde_json::json!({
            "host": "h", "user": "u", "password": "p", "database": "d",
        }))
        .unwrap();
        assert_eq!(p.guard, ConnGuard::default());
    }
}
