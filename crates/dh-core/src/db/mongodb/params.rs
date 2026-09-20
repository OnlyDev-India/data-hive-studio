use bson::doc;
use mongodb::options::ClientOptions;
use mongodb::Client;
use std::sync::Arc;
use crate::db::read_only::ReadOnlyGuard;
use crate::db::{DbError, DbResult};
use crate::api::ConnGuard;
use super::MongoAdapter;

/// Parameters for connecting to a MongoDB server.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct MongoParams {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    /// Auth source database (defaults to "admin" when None).
    #[serde(default)]
    pub auth_db: Option<String>,
    /// Use mongodb+srv:// (DNS seedlist) instead of mongodb:// (single host).
    /// When true, `port` is ignored.
    #[serde(default)]
    pub srv: bool,
    /// Require TLS on a plain `mongodb://` connection. `mongodb+srv://`
    /// (`srv: true`) gets TLS by default regardless of this flag — this only
    /// matters for direct single-host connections.
    #[serde(default)]
    pub tls: bool,
    /// Path to a CA certificate file used to verify the server's
    /// certificate (`tlsCAFile`).
    #[serde(default)]
    pub ssl_ca_file: Option<String>,
    /// Path to a client certificate file for mutual TLS (mTLS) —
    /// MongoDB's `tlsCertificateKeyFile`, a single PEM containing BOTH the
    /// certificate and its (unencrypted) private key.
    #[serde(default)]
    pub ssl_client_cert_file: Option<String>,
    /// Disable retryable writes (`retryWrites=false`). Required for Amazon
    /// DocumentDB, which doesn't support the driver's retryable-writes
    /// protocol — omitted (driver default `true`) unless explicitly set to
    /// `Some(false)`.
    #[serde(default)]
    pub retry_writes: Option<bool>,
    /// Replica set name (`replicaSet=...`). A real Amazon DocumentDB cluster
    /// needs this set (typically `rs0`) for the driver to select a valid
    /// read topology; plain MongoDB and the single-node DocumentDB local
    /// emulator don't need it.
    #[serde(default)]
    pub replica_set: Option<String>,
    /// Reach the database through an SSH tunnel instead of connecting
    /// directly. Incompatible with `srv: true` — SRV/TXT lookup resolves to
    /// however many replica-set hosts the DNS records list, which a single
    /// local port-forward to ONE target can't transparently stand in for;
    /// `connect()` rejects that combination rather than silently ignoring it.
    #[serde(default)]
    pub ssh: Option<crate::ssh_tunnel::SshConfig>,
    /// Max connections per server in the pool (driver default: 10).
    #[serde(default)]
    pub pool_max: Option<u32>,
    /// Min connections per server kept open (driver default: 0).
    #[serde(default)]
    pub pool_min: Option<u32>,
    /// TCP connect timeout for each connection the driver opens (driver
    /// default: 10s). Note: the driver has no working `socketTimeoutMS`
    /// equivalent — `socket_timeout` exists on `ClientOptions` but is
    /// explicitly unimplemented ("the Rust driver does not support
    /// socketTimeoutMS"), so it isn't exposed here.
    #[serde(default)]
    pub connect_timeout_secs: Option<u32>,
    /// How long to keep trying to find a usable server before giving up on
    /// an operation (driver default: 30s).
    #[serde(default)]
    pub server_selection_timeout_secs: Option<u32>,
    /// How long a pooled connection can sit idle before being closed
    /// (driver default: never).
    #[serde(default)]
    pub max_idle_time_secs: Option<u32>,
    /// Read only flag and environment label (spec 0007). The adapter reads
    /// only `read_only`; the rest passes through to `ConnectionInfo`.
    #[serde(flatten)]
    pub guard: ConnGuard,
}

fn default_port() -> u16 {
    27017
}

async fn build_options(params: &MongoParams) -> DbResult<ClientOptions> {
    let mut query: Vec<String> = vec![format!(
        "authSource={}",
        percent_encode(params.auth_db.as_deref().unwrap_or("admin"))
    )];
    // mongodb+srv:// implies TLS by default; a plain mongodb:// connection
    // needs it requested explicitly to get the driver's TLS transport
    // (backed by the `rustls-tls` feature on the `mongodb` crate) — setting
    // a CA/client cert implies the same intent, so that alone is enough
    // without ALSO having to remember to check the TLS box.
    let wants_tls = params.tls || params.ssl_ca_file.is_some() || params.ssl_client_cert_file.is_some();
    if wants_tls && !params.srv {
        query.push("tls=true".to_string());
    }
    if let Some(ca) = &params.ssl_ca_file {
        query.push(format!("tlsCAFile={}", percent_encode(ca)));
    }
    if let Some(cert) = &params.ssl_client_cert_file {
        query.push(format!("tlsCertificateKeyFile={}", percent_encode(cert)));
    }
    if params.retry_writes == Some(false) {
        query.push("retryWrites=false".to_string());
    }
    if let Some(rs) = &params.replica_set {
        query.push(format!("replicaSet={}", percent_encode(rs)));
    }
    let query = query.join("&");
    let uri = if params.srv {
        // mongodb+srv:// requires a seedlist hostname (no port)
        format!(
            "mongodb+srv://{}:{}@{}/{}?{}",
            params.user,
            percent_encode(&params.password),
            params.host,
            params.database,
            query,
        )
    } else {
        // mongodb:// — `host` may be a single hostname or a comma-separated
        // replica-set member list (each optionally carrying its own port,
        // e.g. "a.example.com:27017,b.example.com:27018"); any entry
        // without one falls back to the `port` field. This is also the
        // escape hatch for the DNS-seedlist resolver bug below: a user who
        // can't use mongodb+srv:// can list the same hosts here instead.
        let hosts: Vec<String> = params
            .host
            .split(',')
            .map(str::trim)
            .filter(|h| !h.is_empty())
            .map(|h| if h.contains(':') { h.to_string() } else { format!("{h}:{}", params.port) })
            .collect();
        format!(
            "mongodb://{}:{}@{}/{}?{}",
            params.user,
            percent_encode(&params.password),
            hosts.join(","),
            params.database,
            query,
        )
    };
    let mut options = ClientOptions::parse(uri).await.map_err(|e| {
        let msg = e.to_string();
        // The `mongodb` crate (as of 3.8) exposes no public way to override
        // the DNS resolver used for mongodb+srv://'s SRV/TXT lookup — it
        // always reads the OS's system resolver config, and on some
        // machines (commonly behind a VPN, or with an unusual network
        // adapter) that config has an entry the driver's resolver can't
        // parse, so SRV lookups fail hard with exactly this error. There is
        // no way to fix that from here; the real fix is to stop needing it.
        if params.srv && msg.contains("DNS resolution") {
            DbError::InvalidOperation(format!(
                "mongo: {msg} — this is a known issue where the DNS seedlist (mongodb+srv://) \
                 lookup can't read your system's DNS configuration (often caused by a VPN or an \
                 unusual network adapter). Workaround: turn off \"DNS seedlist\" for this \
                 connection and list your replica set members directly in the Host field \
                 instead, e.g. host1:27017,host2:27017,host3:27017."
            ))
        } else {
            DbError::InvalidOperation(format!("mongo: {msg}"))
        }
    })?;
    // Pool/timeout knobs: set directly on the parsed options rather than as
    // URI query params — `ClientOptions`' fields are all public, and this
    // sidesteps needing a `*MS` query-string name for each one.
    if let Some(v) = params.pool_max {
        options.max_pool_size = Some(v);
    }
    if let Some(v) = params.pool_min {
        options.min_pool_size = Some(v);
    }
    if let Some(secs) = params.connect_timeout_secs {
        options.connect_timeout = Some(std::time::Duration::from_secs(secs as u64));
    }
    if let Some(secs) = params.server_selection_timeout_secs {
        options.server_selection_timeout = Some(std::time::Duration::from_secs(secs as u64));
    }
    if let Some(secs) = params.max_idle_time_secs {
        options.max_idle_time = Some(std::time::Duration::from_secs(secs as u64));
    }
    Ok(options)
}

/// Minimal percent-encoding for the password/authSource in a connection URI
/// (reserves + the `@:/?#` separators users commonly include).
fn percent_encode(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u32),
        })
        .collect()
}

impl MongoAdapter {
    pub async fn connect(params: &MongoParams) -> DbResult<Self> {
        let tunnel = match &params.ssh {
            Some(_) if params.srv => {
                return Err(DbError::InvalidOperation(
                    "mongo: an SSH tunnel can't be combined with mongodb+srv:// — turn off \
                     \"DNS seedlist\" and list the replica set members directly in the Host \
                     field instead."
                        .into(),
                ));
            }
            Some(ssh) => Some(
                crate::ssh_tunnel::open_tunnel(ssh, &params.host, params.port)
                    .await
                    .map_err(DbError::InvalidOperation)?,
            ),
            None => None,
        };
        // Through a tunnel, `build_options` needs to see the local forwarded
        // address instead of the real one — everything else about `params`
        // (auth, database, TLS) stays the same.
        let effective_params;
        let params = match &tunnel {
            Some(t) => {
                effective_params = MongoParams {
                    host: "127.0.0.1".to_string(),
                    port: t.local_port,
                    ssh: None,
                    ..params.clone()
                };
                &effective_params
            }
            None => params,
        };

        let options = build_options(params).await?;
        let client = Client::with_options(options)
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        // Force a real round trip so a bad host/credentials fail here, at
        // connect time, instead of surfacing as a confusing first-query error.
        client
            .database(&params.database)
            .run_command(bson::doc! { "ping": 1 })
            .await
            .map_err(|e| {
                DbError::InvalidOperation(format!(
                    "mongo connect {}:{}: {}",
                    params.host, params.port, e
                ))
            })?;
        Ok(Self {
            client,
            database: std::sync::RwLock::new(params.database.clone()),
            guard: ReadOnlyGuard::new(params.guard.read_only),
            _ssh_tunnel: tunnel,
        })
    }

    /// The database unqualified collection operations currently target.
    pub(super) fn cur_database(&self) -> String {
        self.database.read().unwrap().clone()
    }

    pub(super) async fn close(self: Arc<Self>) {}
}
