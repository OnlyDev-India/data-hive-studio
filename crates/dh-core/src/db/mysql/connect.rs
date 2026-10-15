use sqlx::mysql::MySqlConnectOptions;
use std::sync::Arc;
use crate::db::read_only::ReadOnlyGuard;
use crate::db::{DbError, DbResult};
use super::MySqlAdapter;
use super::params::{build_pool, mysql_connect_options, MySqlParams};
use super::rows::fetch_text;

/// Which server the adapter reached, read from `VERSION()` at connect.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flavor {
    Mysql,
    Mariadb,
}

/// What the adapter learns at connect (spec 0025 AC-2). Behavior branches on
/// this, never on the picker entry (`DbKind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServerInfo {
    pub flavor: Flavor,
    pub version: (u16, u16, u16),
}

/// The supported floors: MySQL 8.0 and MariaDB 10.6.
pub(super) const MYSQL_FLOOR: (u16, u16, u16) = (8, 0, 0);
pub(super) const MARIADB_FLOOR: (u16, u16, u16) = (10, 6, 0);

impl ServerInfo {
    /// Read `VERSION()` text: `8.4.3`, `10.6.18-MariaDB-log`,
    /// `11.4.4-MariaDB-ubu2404`. A `-MariaDB` marker means MariaDB.
    pub fn parse(version: &str) -> Self {
        let flavor = if version.to_ascii_lowercase().contains("mariadb") {
            Flavor::Mariadb
        } else {
            Flavor::Mysql
        };
        // Older MariaDB proxies report `5.5.5-10.6.18-MariaDB`.
        let text = match flavor {
            Flavor::Mariadb => version.strip_prefix("5.5.5-").unwrap_or(version),
            Flavor::Mysql => version,
        };
        let mut parts = text
            .split(|c: char| !c.is_ascii_digit())
            .take(3)
            .map(|p| p.parse::<u16>().unwrap_or(0));
        let version = (
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
            parts.next().unwrap_or(0),
        );
        Self { flavor, version }
    }

    /// `Err` with the message the user sees when the server is below the
    /// floor, naming the version found and the minimum.
    pub fn check_floor(self) -> Result<(), String> {
        let (name, floor) = match self.flavor {
            Flavor::Mysql => ("MySQL", MYSQL_FLOOR),
            Flavor::Mariadb => ("MariaDB", MARIADB_FLOOR),
        };
        if self.version >= floor {
            return Ok(());
        }
        let (a, b, c) = self.version;
        Err(format!(
            "This server runs {name} {a}.{b}.{c}. DH Studio supports {name} {}.{} and newer.",
            floor.0, floor.1
        ))
    }
}

/// The plugins sqlx can speak for us. Any other one gets a named error.
const SUPPORTED_PLUGINS: &str = "mysql_native_password or caching_sha2_password";

/// Turn a connect failure into the message AC-3 asks for: an auth plugin the
/// driver can't speak is named, with what to switch the user to. Everything
/// else (access denied, TLS, network) stays the server's or driver's own.
pub(super) fn connect_error(e: sqlx::Error) -> DbError {
    let text = e.to_string();
    if let Some(plugin) = text.split("unknown authentication plugin: ").nth(1) {
        let plugin = plugin.split_whitespace().next().unwrap_or(plugin);
        return DbError::InvalidOperation(format!(
            "This user signs in with the {plugin} authentication plugin, which DH Studio can't use. \
             Switch the user to {SUPPORTED_PLUGINS}."
        ));
    }
    if text.contains("authentication plugin") || text.contains("auth plugin") {
        return DbError::InvalidOperation(format!(
            "The server asked for an authentication plugin DH Studio can't use. \
             Switch the user to {SUPPORTED_PLUGINS}."
        ));
    }
    DbError::SqlEngine(e)
}

impl MySqlAdapter {
    pub async fn connect(params: &MySqlParams) -> DbResult<Self> {
        let tunnel = match &params.ssh {
            Some(ssh) => Some(
                crate::ssh_tunnel::open_tunnel(ssh, &params.host, params.port)
                    .await
                    .map_err(DbError::InvalidOperation)?,
            ),
            None => None,
        };
        let (host, port) = match &tunnel {
            Some(t) => ("127.0.0.1", t.local_port),
            None => (params.host.as_str(), params.port),
        };
        let pool = build_pool(host, port, params).await?;

        let version = fetch_text(&pool, "SELECT VERSION()", &[]).await?;
        let version = version
            .first()
            .and_then(|r| r.first().cloned().flatten())
            .unwrap_or_default();
        let server = ServerInfo::parse(&version);
        if let Err(msg) = server.check_floor() {
            pool.close().await;
            return Err(DbError::InvalidOperation(msg));
        }

        Ok(Self {
            pool,
            server,
            database: params.database.clone(),
            params: params.clone(),
            guard: ReadOnlyGuard::new(params.guard.read_only),
            _ssh_tunnel: tunnel,
        })
    }

    /// Connect options for a one off connection to this server: the same
    /// host and port (the tunnel's local end when there is one), credentials
    /// and TLS settings the pool uses. Stop opens its `KILL QUERY` connection
    /// with these, so the cancel never waits for a pool slot.
    pub(super) fn one_off_options(&self) -> MySqlConnectOptions {
        let (host, port) = match &self._ssh_tunnel {
            Some(t) => ("127.0.0.1".to_string(), t.local_port),
            None => (self.params.host.clone(), self.params.port),
        };
        mysql_connect_options(&host, port, &self.params)
    }

    /// The database an operation targets: the one asked for, else this
    /// connection's own default, else none (the server level).
    pub(super) fn target<'a>(&'a self, database: Option<&'a str>) -> Option<&'a str> {
        database.filter(|d| !d.is_empty()).or(self.database.as_deref())
    }

    /// Like [`Self::target`], for catalog reads that need a database.
    pub(super) fn require_target<'a>(&'a self, database: Option<&'a str>) -> DbResult<&'a str> {
        self.target(database).ok_or_else(|| {
            DbError::InvalidOperation("pick a database first: this connection has no default database".into())
        })
    }

    pub(super) async fn close(self: Arc<Self>) {
        self.pool.close().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mysql_and_mariadb_versions_parse() {
        assert_eq!(
            ServerInfo::parse("8.4.3"),
            ServerInfo { flavor: Flavor::Mysql, version: (8, 4, 3) }
        );
        assert_eq!(
            ServerInfo::parse("8.0.36-0ubuntu0.22.04.1"),
            ServerInfo { flavor: Flavor::Mysql, version: (8, 0, 36) }
        );
        assert_eq!(
            ServerInfo::parse("11.4.4-MariaDB-ubu2404"),
            ServerInfo { flavor: Flavor::Mariadb, version: (11, 4, 4) }
        );
        assert_eq!(
            ServerInfo::parse("5.5.5-10.6.18-MariaDB-log"),
            ServerInfo { flavor: Flavor::Mariadb, version: (10, 6, 18) }
        );
    }

    #[test]
    fn servers_below_the_floor_are_refused_with_both_versions_named() {
        let old_mysql = ServerInfo::parse("5.7.44").check_floor().unwrap_err();
        assert!(old_mysql.contains("MySQL 5.7.44") && old_mysql.contains("MySQL 8.0"), "{old_mysql}");
        let old_maria = ServerInfo::parse("10.5.27-MariaDB").check_floor().unwrap_err();
        assert!(old_maria.contains("MariaDB 10.5.27") && old_maria.contains("MariaDB 10.6"), "{old_maria}");
        assert!(ServerInfo::parse("8.0.0").check_floor().is_ok());
        assert!(ServerInfo::parse("10.6.0-MariaDB").check_floor().is_ok());
    }

    #[test]
    fn an_unknown_auth_plugin_is_named() {
        let e = connect_error(sqlx::Error::Protocol("unknown authentication plugin: client_ed25519".into()));
        let msg = e.to_string();
        assert!(msg.contains("client_ed25519"), "{msg}");
        assert!(msg.contains("mysql_native_password") && msg.contains("caching_sha2_password"), "{msg}");
    }

    #[test]
    fn other_connect_errors_pass_through() {
        let e = connect_error(sqlx::Error::PoolTimedOut);
        assert!(matches!(e, DbError::SqlEngine(_)));
    }
}
