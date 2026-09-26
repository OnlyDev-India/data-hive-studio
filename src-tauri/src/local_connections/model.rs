use crate::api::ConnGuard;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConnMeta {
    pub name: String,
    /// "postgres" | "mongodb" | "sqlite"
    pub kind: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub database: String,
    #[serde(default)]
    pub ssl_mode: Option<String>,
    #[serde(default)]
    pub auth_db: Option<String>,
    #[serde(default)]
    pub srv: bool,
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
    /// Max pool connections (Postgres default 12, MongoDB default 10 when unset).
    #[serde(default)]
    pub pool_max: Option<u32>,
    /// Min pool connections kept open (Postgres default 1, MongoDB default 0 when unset).
    #[serde(default)]
    pub pool_min: Option<u32>,
    /// Postgres: pool acquire timeout (default 30s). MongoDB: TCP connect
    /// timeout (default 10s).
    #[serde(default)]
    pub connect_timeout_secs: Option<u32>,
    /// Postgres default 15 minutes; MongoDB default never, when unset.
    #[serde(default)]
    pub idle_timeout_secs: Option<u32>,
    /// Postgres only (default 30 minutes when unset).
    #[serde(default)]
    pub max_lifetime_secs: Option<u32>,
    /// MongoDB only (default 30s when unset).
    #[serde(default)]
    pub server_selection_timeout_secs: Option<u32>,
    /// `Some` means this connection tunnels through SSH — no secrets here,
    /// those live in `secret_store` like the main password (see
    /// `get_local_connection_secret`).
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
    #[serde(default)]
    pub ssh_host_key_fingerprint: Option<String>,
    #[serde(default)]
    pub source_path: Option<String>,
    /// False keeps the DB and SSH passwords out of the secret store, so connect
    /// asks for them. Older entries have no key and stay remembered.
    #[serde(default = "remembered")]
    pub remember_secret: bool,
    /// Read only flag and environment label (spec 0007). A connection saved
    /// before this existed has none of the four keys and loads as not read
    /// only, no label.
    #[serde(flatten)]
    pub guard: ConnGuard,
}

/// Payload for creating/editing a saved connection.
#[derive(Debug, Clone, Deserialize)]
pub struct LocalConnInput {
    pub name: String,
    pub kind: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    /// `None` on update keeps the existing stored password. Required
    /// (non-empty) on create — `save_local_connection` rejects `None`.
    #[serde(default)]
    pub password: Option<String>,
    pub database: String,
    #[serde(default)]
    pub ssl_mode: Option<String>,
    #[serde(default)]
    pub auth_db: Option<String>,
    #[serde(default)]
    pub srv: bool,
    #[serde(default)]
    pub tls: bool,
    #[serde(default)]
    pub ssl_ca_file: Option<String>,
    #[serde(default)]
    pub ssl_client_cert_file: Option<String>,
    #[serde(default)]
    pub ssl_client_key_file: Option<String>,
    #[serde(default)]
    pub retry_writes: bool,
    #[serde(default)]
    pub replica_set: Option<String>,
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
    #[serde(default)]
    pub server_selection_timeout_secs: Option<u32>,
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
    /// `None` on update keeps the existing stored SSH password. Ignored
    /// when `ssh_host` is `None` (tunnel disabled — stored SSH secrets are
    /// deleted).
    #[serde(default)]
    pub ssh_password: Option<String>,
    /// Same "`None` on update keeps the existing one" rule as `ssh_password`.
    #[serde(default)]
    pub ssh_key_passphrase: Option<String>,
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default = "remembered")]
    pub remember_secret: bool,
    #[serde(flatten)]
    pub guard: ConnGuard,
}

fn remembered() -> bool {
    true
}

/// The saved record for `input`. Fails (before anything is written) when the
/// environment label or colour is not valid, so a bad value never reaches
/// the saved file (spec 0007).
pub(super) fn meta_from_input(input: &LocalConnInput) -> Result<LocalConnMeta, String> {
    let guard = input.guard.clone().normalized()?;
    Ok(LocalConnMeta {
        name: input.name.clone(),
        kind: input.kind.clone(),
        host: input.host.clone(),
        port: input.port,
        user: input.user.clone(),
        database: input.database.clone(),
        ssl_mode: input.ssl_mode.clone(),
        auth_db: input.auth_db.clone(),
        srv: input.srv,
        tls: input.tls,
        ssl_ca_file: input.ssl_ca_file.clone(),
        ssl_client_cert_file: input.ssl_client_cert_file.clone(),
        ssl_client_key_file: input.ssl_client_key_file.clone(),
        retry_writes: input.retry_writes,
        replica_set: input.replica_set.clone(),
        pool_max: input.pool_max,
        pool_min: input.pool_min,
        connect_timeout_secs: input.connect_timeout_secs,
        idle_timeout_secs: input.idle_timeout_secs,
        max_lifetime_secs: input.max_lifetime_secs,
        server_selection_timeout_secs: input.server_selection_timeout_secs,
        ssh_host: input.ssh_host.clone(),
        ssh_port: input.ssh_port,
        ssh_user: input.ssh_user.clone(),
        ssh_auth_mode: input.ssh_auth_mode.clone(),
        ssh_key_file: input.ssh_key_file.clone(),
        ssh_host_key_fingerprint: input.ssh_host_key_fingerprint.clone(),
        source_path: input.source_path.clone(),
        remember_secret: input.remember_secret,
        guard,
    })
}

#[derive(Debug, Serialize)]
pub struct LocalConnectionSecret {
    pub password: String,
    pub ssh_password: Option<String>,
    pub ssh_key_passphrase: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::LocalConnMeta;

    #[test]
    fn older_entries_stay_remembered() {
        let raw = r#"{"name":"a","kind":"postgres","host":"h","port":5432,"user":"u","database":"d"}"#;
        let meta: LocalConnMeta = serde_json::from_str(raw).unwrap();
        assert!(meta.remember_secret);
    }
}
