use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
use sqlx::{Executor as _, MySqlPool};
use crate::api::ConnGuard;
use crate::db::DbResult;

/// Parameters for connecting to a MySQL or MariaDB server (spec 0025). The
/// same shape serves both picker entries.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct MySqlParams {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub user: String,
    pub password: String,
    /// The database unqualified statements target. Empty or missing means
    /// the connection lands on the server with no default database.
    #[serde(default, deserialize_with = "empty_as_none")]
    pub database: Option<String>,
    /// DISABLED | PREFERRED | REQUIRED | VERIFY_CA | VERIFY_IDENTITY
    /// (defaults to PREFERRED, like the mysql CLI).
    #[serde(default)]
    pub ssl_mode: Option<String>,
    #[serde(default)]
    pub ssl_ca_file: Option<String>,
    #[serde(default)]
    pub ssl_client_cert_file: Option<String>,
    #[serde(default)]
    pub ssl_client_key_file: Option<String>,
    #[serde(default)]
    pub ssh: Option<crate::ssh_tunnel::SshConfig>,
    /// Pool settings, with the same defaults as Postgres.
    #[serde(default)]
    pub pool_max: Option<u32>,
    #[serde(default)]
    pub pool_min: Option<u32>,
    #[serde(default)]
    pub connect_timeout_secs: Option<u32>,
    #[serde(default)]
    pub idle_timeout_secs: Option<u32>,
    #[serde(default)]
    pub max_lifetime_secs: Option<u32>,
    #[serde(flatten)]
    pub guard: ConnGuard,
}

fn default_port() -> u16 {
    3306
}

fn empty_as_none<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    let v: Option<String> = serde::Deserialize::deserialize(d)?;
    Ok(v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()))
}

fn ssl_mode(v: Option<&str>) -> MySqlSslMode {
    match v.unwrap_or("PREFERRED").to_ascii_uppercase().replace('-', "_").as_str() {
        "DISABLED" => MySqlSslMode::Disabled,
        "REQUIRED" => MySqlSslMode::Required,
        "VERIFY_CA" => MySqlSslMode::VerifyCa,
        "VERIFY_IDENTITY" => MySqlSslMode::VerifyIdentity,
        _ => MySqlSslMode::Preferred,
    }
}

/// Connect options for `host:port` (the SSH tunnel's local end when there is
/// one). The app never changes `sql_mode` or `time_zone` (spec 0025 key
/// invariants), so the driver's own additions to both are switched off (the
/// one it can't switch off is undone in [`session_setup`]), and
/// `SET NAMES` is sent by [`session_setup`] instead of the driver, which
/// would also pin a collation.
pub(super) fn mysql_connect_options(host: &str, port: u16, params: &MySqlParams) -> MySqlConnectOptions {
    let mut options = MySqlConnectOptions::new()
        .host(host)
        .port(port)
        .username(&params.user)
        .password(&params.password)
        .ssl_mode(ssl_mode(params.ssl_mode.as_deref()))
        .charset("utf8mb4")
        .pipes_as_concat(false)
        .no_engine_substitution(false)
        .timezone(None)
        .set_names(false);
    if let Some(db) = &params.database {
        options = options.database(db);
    }
    if let Some(ca) = &params.ssl_ca_file {
        options = options.ssl_ca(ca);
    }
    if let Some(cert) = &params.ssl_client_cert_file {
        options = options.ssl_client_cert(cert);
    }
    if let Some(key) = &params.ssl_client_key_file {
        options = options.ssl_client_key(key);
    }
    options
}

/// sqlx always asks for `CLIENT_IGNORE_SPACE` in the handshake, and the
/// server answers by adding `IGNORE_SPACE` to the session's `sql_mode`
/// (so `CREATE TABLE count (i INT)` fails with 1064). This takes it off
/// again, unless the server's own default has it.
const UNDO_IGNORE_SPACE: &str = "SET SESSION sql_mode = IF(FIND_IN_SET('IGNORE_SPACE', @@global.sql_mode), \
     @@session.sql_mode, \
     TRIM(BOTH ',' FROM REPLACE(CONCAT(',', @@session.sql_mode, ','), ',IGNORE_SPACE,', ',')))";

/// What every new session runs before anything else: undo the driver's
/// `IGNORE_SPACE`, `NAMES utf8mb4`, plus `TRANSACTION READ ONLY` on a read
/// only connection (the second guard under the statement check, AC-17).
/// Separate statements: `SET TRANSACTION` can't share a `SET` list.
pub(super) fn session_setup(read_only: bool) -> &'static [&'static str] {
    if read_only {
        &[UNDO_IGNORE_SPACE, "SET NAMES utf8mb4", "SET SESSION TRANSACTION READ ONLY"]
    } else {
        &[UNDO_IGNORE_SPACE, "SET NAMES utf8mb4"]
    }
}

pub(super) async fn build_pool(host: &str, port: u16, params: &MySqlParams) -> DbResult<MySqlPool> {
    let options = mysql_connect_options(host, port, params);
    let setup = session_setup(params.guard.read_only);
    let mut pool_opts = MySqlPoolOptions::new()
        .max_connections(params.pool_max.unwrap_or(12))
        .min_connections(params.pool_min.unwrap_or(1))
        .acquire_timeout(std::time::Duration::from_secs(
            params.connect_timeout_secs.unwrap_or(30) as u64,
        ))
        .idle_timeout(std::time::Duration::from_secs(
            params.idle_timeout_secs.unwrap_or(15 * 60) as u64,
        ))
        .after_connect(move |conn, _meta| {
            Box::pin(async move {
                for statement in setup {
                    conn.execute(*statement).await?;
                }
                Ok(())
            })
        });
    if let Some(secs) = params.max_lifetime_secs {
        pool_opts = pool_opts.max_lifetime(std::time::Duration::from_secs(secs as u64));
    }
    pool_opts
        .connect_with(options)
        .await
        .map_err(super::connect::connect_error)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(extra: serde_json::Value) -> MySqlParams {
        let mut base = serde_json::json!({ "host": "h", "user": "u", "password": "p" });
        base.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        serde_json::from_value(base).unwrap()
    }

    #[test]
    fn port_defaults_to_3306_and_database_is_optional() {
        let p = params(serde_json::json!({}));
        assert_eq!(p.port, 3306);
        assert_eq!(p.database, None);
        assert_eq!(params(serde_json::json!({ "database": "  " })).database, None);
        assert_eq!(params(serde_json::json!({ "database": "shop" })).database.as_deref(), Some("shop"));
    }

    #[test]
    fn ssl_modes_follow_the_mysql_names_and_default_to_preferred() {
        assert!(matches!(ssl_mode(None), MySqlSslMode::Preferred));
        assert!(matches!(ssl_mode(Some("DISABLED")), MySqlSslMode::Disabled));
        assert!(matches!(ssl_mode(Some("required")), MySqlSslMode::Required));
        assert!(matches!(ssl_mode(Some("VERIFY_CA")), MySqlSslMode::VerifyCa));
        assert!(matches!(ssl_mode(Some("verify-identity")), MySqlSslMode::VerifyIdentity));
    }

    #[test]
    fn options_never_touch_sql_mode_or_time_zone() {
        let o = mysql_connect_options("h", 3306, &params(serde_json::json!({})));
        let debug = format!("{o:?}");
        assert!(debug.contains("pipes_as_concat: false"), "{debug}");
        assert!(debug.contains("no_engine_substitution: false"), "{debug}");
        assert!(debug.contains("timezone: None"), "{debug}");
        assert!(debug.contains("set_names: false"), "{debug}");
        assert_eq!(o.get_database(), None);
    }

    #[test]
    fn a_read_only_session_starts_read_only() {
        assert_eq!(session_setup(false), [UNDO_IGNORE_SPACE, "SET NAMES utf8mb4"]);
        assert_eq!(
            session_setup(true),
            [UNDO_IGNORE_SPACE, "SET NAMES utf8mb4", "SET SESSION TRANSACTION READ ONLY"]
        );
    }
}
