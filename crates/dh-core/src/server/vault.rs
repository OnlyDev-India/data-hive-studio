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

use super::crypto;
use super::store::{now_ms, Store};
use crate::api::DbKind;
use sqlx::Row;
use uuid::Uuid;

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

/// SSH password + key passphrase, encrypted together as one JSON blob
/// (mirrors how the main `password_enc` column works, just two secrets
/// instead of one so a tunnel doesn't need two more AES-GCM columns).
#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
struct SshSecrets {
    password: Option<String>,
    key_passphrase: Option<String>,
}

impl Store {
    fn encrypt_ssh_secrets(&self, password: Option<&str>, key_passphrase: Option<&str>) -> Result<Vec<u8>, String> {
        let json = serde_json::to_vec(&SshSecrets {
            password: password.map(str::to_string),
            key_passphrase: key_passphrase.map(str::to_string),
        })
        .map_err(|e| e.to_string())?;
        crypto::encrypt(&self.master_key, &json)
    }

    fn decrypt_ssh_secrets(&self, enc: &[u8]) -> Result<SshSecrets, String> {
        let json = crypto::decrypt(&self.master_key, enc)?;
        serde_json::from_slice(&json).map_err(|e| e.to_string())
    }
}

fn kind_to_str(kind: DbKind) -> &'static str {
    match kind {
        DbKind::Sqlite => "sqlite",
        DbKind::Postgres => "postgres",
        DbKind::Mysql => "mysql",
        DbKind::Mongodb => "mongodb",
    }
}

fn kind_from_str(s: &str) -> DbKind {
    match s {
        "sqlite" => DbKind::Sqlite,
        "mysql" => DbKind::Mysql,
        "mongodb" => DbKind::Mongodb,
        // Covers "postgres" and any unrecognized/legacy value — matches the
        // column's own DEFAULT 'postgres'.
        _ => DbKind::Postgres,
    }
}

pub const ERR_NOT_FOUND: &str = "connection not found";

fn parse_conn_row(r: &sqlx::postgres::PgRow) -> ConnRow {
    ConnRow {
        id: r.get("id"),
        org_id: r.get("org_id"),
        name: r.get("name"),
        kind: r.get("kind"),
        host: r.get("host"),
        // `port`/`srv`/`tls`/`archived` are `INTEGER` (32-bit) columns —
        // sqlx maps that to `i32`, not `i64`; the struct fields stay `i64`
        // for convenience, cast up here.
        port: r.get::<i32, _>("port") as i64,
        user: r.get("user"),
        password_enc: r.get("password_enc"),
        database: r.get("database"),
        ssl_mode: r.get("ssl_mode"),
        auth_db: r.get("auth_db"),
        srv: r.get::<i32, _>("srv") as i64,
        tls: r.get::<i32, _>("tls") as i64,
        ssl_ca_file: r.get("ssl_ca_file"),
        ssl_client_cert_file: r.get("ssl_client_cert_file"),
        ssl_client_key_file: r.get("ssl_client_key_file"),
        retry_writes: r.get::<i32, _>("retry_writes") as i64,
        replica_set: r.get("replica_set"),
        ssh_host: r.get("ssh_host"),
        ssh_port: r.get::<Option<i32>, _>("ssh_port").map(|p| p as u16),
        ssh_user: r.get("ssh_user"),
        ssh_auth_mode: r.get("ssh_auth_mode"),
        ssh_key_file: r.get("ssh_key_file"),
        ssh_host_key_fingerprint: r.get("ssh_host_key_fingerprint"),
        ssh_secrets_enc: r.get("ssh_secrets_enc"),
        created_by: r.get("created_by"),
        created_ms: r.get::<i64, _>("created_ms"),
        updated_ms: r.get::<i64, _>("updated_ms"),
        archived: r.get::<i32, _>("archived") as i64,
    }
}

impl Store {
    pub async fn conn_add(
        &self,
        org_id: &str,
        input: &ConnInput,
        created_by: &str,
    ) -> Result<ConnMeta, String> {
        let password = input.password.clone().unwrap_or_default();
        let enc = crypto::encrypt(&self.master_key, password.as_bytes())?;
        // SSH secrets only get encrypted/stored when a tunnel is actually
        // configured (`ssh_host` set) — otherwise NULL, same as "no tunnel".
        let ssh_secrets_enc = match &input.ssh_host {
            Some(_) => Some(self.encrypt_ssh_secrets(
                input.ssh_password.as_deref(),
                input.ssh_key_passphrase.as_deref(),
            )?),
            None => None,
        };
        let id = Uuid::new_v4().to_string();
        let ts = now_ms();
        let kind_str = kind_to_str(input.kind);
        sqlx::query(
            r#"INSERT INTO connections
               (id, org_id, name, kind, host, port, "user", password_enc, database, ssl_mode, auth_db, srv, tls, ssl_ca_file, ssl_client_cert_file, ssl_client_key_file, retry_writes, replica_set, ssh_host, ssh_port, ssh_user, ssh_auth_mode, ssh_key_file, ssh_host_key_fingerprint, ssh_secrets_enc, created_by, created_ms, updated_ms)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)"#,
        )
        .bind(&id)
        .bind(org_id)
        .bind(&input.name)
        .bind(kind_str)
        .bind(&input.host)
        .bind(input.port as i64)
        .bind(&input.user)
        .bind(&enc)
        .bind(&input.database)
        .bind(&input.ssl_mode)
        .bind(&input.auth_db)
        .bind(input.srv as i64)
        .bind(input.tls as i64)
        .bind(&input.ssl_ca_file)
        .bind(&input.ssl_client_cert_file)
        .bind(&input.ssl_client_key_file)
        .bind(input.retry_writes as i64)
        .bind(&input.replica_set)
        .bind(&input.ssh_host)
        .bind(input.ssh_port.map(|p| p as i64))
        .bind(&input.ssh_user)
        .bind(&input.ssh_auth_mode)
        .bind(&input.ssh_key_file)
        .bind(&input.ssh_host_key_fingerprint)
        .bind(&ssh_secrets_enc)
        .bind(created_by)
        .bind(ts)
        .bind(ts)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(ConnMeta {
            id,
            org_id: org_id.to_string(),
            name: input.name.clone(),
            kind: input.kind,
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
            ssh_host: input.ssh_host.clone(),
            ssh_port: input.ssh_port,
            ssh_user: input.ssh_user.clone(),
            ssh_auth_mode: input.ssh_auth_mode.clone(),
            ssh_key_file: input.ssh_key_file.clone(),
            ssh_host_key_fingerprint: input.ssh_host_key_fingerprint.clone(),
            created_by: created_by.to_string(),
            created_ms: ts,
            updated_ms: ts,
        })
    }

    /// Edit stored details. Requires edit access (checked by callers).
    /// A `None` password in the input keeps the current one.
    pub async fn conn_update(&self, id: &str, input: &ConnInput) -> Result<ConnMeta, String> {
        let existing = self.conn_get_row(id).await?.ok_or(ERR_NOT_FOUND)?;
        let enc = match &input.password {
            Some(p) => crypto::encrypt(&self.master_key, p.as_bytes())?,
            None => existing.password_enc,
        };
        // Disabling the tunnel (no ssh_host) drops any stored SSH secrets.
        // Otherwise, only re-encrypt the secret(s) actually provided —
        // `None` for either one keeps whatever was already stored for it.
        let ssh_secrets_enc = match &input.ssh_host {
            None => None,
            Some(_) => {
                let existing_secrets = existing
                    .ssh_secrets_enc
                    .as_ref()
                    .and_then(|enc| self.decrypt_ssh_secrets(enc).ok())
                    .unwrap_or_default();
                let password = input.ssh_password.clone().or(existing_secrets.password);
                let key_passphrase =
                    input.ssh_key_passphrase.clone().or(existing_secrets.key_passphrase);
                Some(self.encrypt_ssh_secrets(password.as_deref(), key_passphrase.as_deref())?)
            }
        };
        let ts = now_ms();
        sqlx::query(
            r#"UPDATE connections
               SET name=$1, host=$2, port=$3, "user"=$4, password_enc=$5, database=$6, ssl_mode=$7, auth_db=$8, srv=$9, tls=$10, ssl_ca_file=$11, ssl_client_cert_file=$12, ssl_client_key_file=$13, retry_writes=$14, replica_set=$15, ssh_host=$16, ssh_port=$17, ssh_user=$18, ssh_auth_mode=$19, ssh_key_file=$20, ssh_host_key_fingerprint=$21, ssh_secrets_enc=$22, updated_ms=$23
               WHERE id=$24"#,
        )
        .bind(&input.name)
        .bind(&input.host)
        .bind(input.port as i64)
        .bind(&input.user)
        .bind(&enc)
        .bind(&input.database)
        .bind(&input.ssl_mode)
        .bind(&input.auth_db)
        .bind(input.srv as i64)
        .bind(input.tls as i64)
        .bind(&input.ssl_ca_file)
        .bind(&input.ssl_client_cert_file)
        .bind(&input.ssl_client_key_file)
        .bind(input.retry_writes as i64)
        .bind(&input.replica_set)
        .bind(&input.ssh_host)
        .bind(input.ssh_port.map(|p| p as i64))
        .bind(&input.ssh_user)
        .bind(&input.ssh_auth_mode)
        .bind(&input.ssh_key_file)
        .bind(&input.ssh_host_key_fingerprint)
        .bind(&ssh_secrets_enc)
        .bind(ts)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        self.conn_get(id).await?.ok_or_else(|| ERR_NOT_FOUND.into())
    }

    pub async fn conn_archive(&self, id: &str) -> Result<(), String> {
        let n = sqlx::query("UPDATE connections SET archived=1 WHERE id=$1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?
            .rows_affected();
        if n == 0 {
            Err(ERR_NOT_FOUND.into())
        } else {
            Ok(())
        }
    }

    /// Metadata only — safe to send to any granted client.
    pub async fn conn_get(&self, id: &str) -> Result<Option<ConnMeta>, String> {
        let row = self.conn_get_row(id).await?;
        row.map(Self::row_to_meta).transpose()
    }

    pub async fn conn_list_active(&self, org_id: &str) -> Result<Vec<ConnMeta>, String> {
        let rows = sqlx::query(
            "SELECT * FROM connections WHERE org_id=$1 AND archived=0 ORDER BY created_ms DESC",
        )
        .bind(org_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        rows.iter().map(parse_conn_row).map(Self::row_to_meta).collect()
    }

    /// Decrypt the password and build the params for whichever adapter this
    /// connection's `kind` needs. Gateway-internal; never serialize this type.
    pub async fn conn_secret_params(&self, id: &str) -> Result<AdapterParams, String> {
        let row = self.conn_get_row(id).await?.ok_or(ERR_NOT_FOUND)?;
        let password = String::from_utf8(crypto::decrypt(&self.master_key, &row.password_enc)?)
            .map_err(|_| "stored password is not utf-8".to_string())?;
        let ssh = match &row.ssh_host {
            None => None,
            Some(host) => {
                let secrets = match &row.ssh_secrets_enc {
                    Some(enc) => self.decrypt_ssh_secrets(enc)?,
                    None => SshSecrets::default(),
                };
                Some(crate::ssh_tunnel::SshConfig {
                    host: host.clone(),
                    port: row.ssh_port.unwrap_or(22),
                    user: row.ssh_user.clone().unwrap_or_default(),
                    auth_mode: row.ssh_auth_mode.clone().unwrap_or_else(|| "password".into()),
                    password: secrets.password,
                    key_file: row.ssh_key_file.clone(),
                    key_passphrase: secrets.key_passphrase,
                    host_key_fingerprint: row.ssh_host_key_fingerprint.clone(),
                })
            }
        };
        Ok(match kind_from_str(&row.kind) {
            DbKind::Mongodb => AdapterParams::Mongodb(crate::db::MongoParams {
                host: row.host,
                port: row.port as u16,
                user: row.user,
                password,
                database: row.database,
                auth_db: row.auth_db,
                srv: row.srv != 0,
                tls: row.tls != 0,
                ssl_ca_file: row.ssl_ca_file,
                ssl_client_cert_file: row.ssl_client_cert_file,
                retry_writes: if row.retry_writes != 0 { Some(false) } else { None },
                replica_set: row.replica_set,
                ssh,
            }),
            // Postgres, and every other kind until it gets its own adapter
            // params shape — matches the column's own default.
            _ => AdapterParams::Postgres(crate::db::PgParams {
                host: row.host,
                port: row.port as u16,
                user: row.user,
                password,
                database: row.database,
                ssl_mode: row.ssl_mode,
                ssl_ca_file: row.ssl_ca_file,
                ssl_client_cert_file: row.ssl_client_cert_file,
                ssl_client_key_file: row.ssl_client_key_file,
                ssh,
            }),
        })
    }

    async fn conn_get_row(&self, id: &str) -> Result<Option<ConnRow>, String> {
        let rec = sqlx::query("SELECT * FROM connections WHERE id=$1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(rec.as_ref().map(parse_conn_row))
    }

    fn row_to_meta(r: ConnRow) -> Result<ConnMeta, String> {
        Ok(ConnMeta {
            id: r.id.clone(),
            org_id: r.org_id.clone(),
            name: r.name.clone(),
            kind: kind_from_str(&r.kind),
            host: r.host.clone(),
            port: r.port as u16,
            user: r.user.clone(),
            database: r.database.clone(),
            ssl_mode: r.ssl_mode.clone(),
            auth_db: r.auth_db.clone(),
            srv: r.srv != 0,
            tls: r.tls != 0,
            ssl_ca_file: r.ssl_ca_file.clone(),
            ssl_client_cert_file: r.ssl_client_cert_file.clone(),
            ssl_client_key_file: r.ssl_client_key_file.clone(),
            retry_writes: r.retry_writes != 0,
            replica_set: r.replica_set.clone(),
            ssh_host: r.ssh_host.clone(),
            ssh_port: r.ssh_port,
            ssh_user: r.ssh_user.clone(),
            ssh_auth_mode: r.ssh_auth_mode.clone(),
            ssh_key_file: r.ssh_key_file.clone(),
            ssh_host_key_fingerprint: r.ssh_host_key_fingerprint.clone(),
            created_by: r.created_by.clone(),
            created_ms: r.created_ms,
            updated_ms: r.updated_ms,
        })
    }
}

#[derive(Debug)]
struct ConnRow {
    id: String,
    org_id: String,
    name: String,
    kind: String,
    host: String,
    port: i64,
    user: String,
    password_enc: Vec<u8>,
    database: String,
    ssl_mode: Option<String>,
    auth_db: Option<String>,
    srv: i64,
    tls: i64,
    ssl_ca_file: Option<String>,
    ssl_client_cert_file: Option<String>,
    ssl_client_key_file: Option<String>,
    retry_writes: i64,
    replica_set: Option<String>,
    ssh_host: Option<String>,
    ssh_port: Option<u16>,
    ssh_user: Option<String>,
    ssh_auth_mode: Option<String>,
    ssh_key_file: Option<String>,
    ssh_host_key_fingerprint: Option<String>,
    ssh_secrets_enc: Option<Vec<u8>>,
    created_by: String,
    created_ms: i64,
    updated_ms: i64,
    #[allow(dead_code)]
    archived: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, pw: &str) -> ConnInput {
        ConnInput {
            name: name.into(),
            kind: DbKind::Postgres,
            host: "db.internal".into(),
            port: 5432,
            user: "alice".into(),
            password: Some(pw.into()),
            database: "appdb".into(),
            ssl_mode: Some("require".into()),
            auth_db: None,
            srv: false,
            tls: false,
            ssl_ca_file: None,
            ssl_client_cert_file: None,
            ssl_client_key_file: None,
            retry_writes: false,
            replica_set: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_auth_mode: None,
            ssh_key_file: None,
            ssh_host_key_fingerprint: None,
            ssh_password: None,
            ssh_key_passphrase: None,
        }
    }

    /// Sets up a store with one org + one user, returning `(store, org_id, user_id)`.
    async fn org_and_user(store: &Store) -> (String, String) {
        let user = store.user_upsert_oauth("google", "sub-1", "a@x.com", "Alice", None).await.unwrap();
        let org = store.org_create("Acme", &user.id).await.unwrap();
        (org.id, user.id)
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn add_list_update_archive() {
        let store = super::super::store::test_store().await;
        let (org_id, user_id) = org_and_user(&store).await;
        let meta = store.conn_add(&org_id, &input("prod", "s3cret"), &user_id).await.unwrap();

        // Metadata must never contain the secret.
        let listed = store.conn_list_active(&org_id).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, meta.id);
        assert!(!serde_json::to_string(&listed).unwrap().contains("s3cret"));

        // Secret roundtrips through encryption with correct params.
        let params = pg_password_and_host(&store, &meta.id).await;
        assert_eq!(params.0, "s3cret");
        assert_eq!(params.1, "db.internal");

        // Update without password keeps the stored one.
        let mut edit = input("prod-renamed", "");
        edit.password = None;
        let updated = store.conn_update(&meta.id, &edit).await.unwrap();
        assert_eq!(updated.name, "prod-renamed");
        assert_eq!(updated.kind, DbKind::Postgres);
        assert!(pg_password_and_host(&store, &meta.id).await.0 == "s3cret");

        // Update WITH password rotates it.
        let mut rotate = edit.clone();
        rotate.password = Some("newpw".into());
        store.conn_update(&meta.id, &rotate).await.unwrap();
        assert!(pg_password_and_host(&store, &meta.id).await.0 == "newpw");

        // Archive hides from listing but secret stays intact internally.
        store.conn_archive(&meta.id).await.unwrap();
        assert!(store.conn_list_active(&org_id).await.unwrap().is_empty());
        assert_eq!(pg_password_and_host(&store, &meta.id).await.0, "newpw");
        assert_eq!(store.conn_get(&meta.id).await.unwrap().unwrap().name, "prod-renamed");
    }

    /// Unwrap `conn_secret_params`'s Postgres variant (every test connection
    /// here is Postgres) into (password, host) for easy assertions.
    async fn pg_password_and_host(store: &Store, id: &str) -> (String, String) {
        match store.conn_secret_params(id).await.unwrap() {
            AdapterParams::Postgres(p) => (p.password, p.host),
            AdapterParams::Mongodb(_) => panic!("expected Postgres params"),
        }
    }

    /// Mongo's auth_db/srv/tls/retry_writes/replica_set must round-trip
    /// through storage — these are the fields `conn_secret_params` used to
    /// hardcode to None/false/false for every Mongo shared connection
    /// regardless of what was stored. `retry_writes`/`replica_set` are the
    /// two fields a real Amazon DocumentDB cluster needs set.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn mongo_auth_db_srv_tls_round_trip() {
        let store = super::super::store::test_store().await;
        let (org_id, user_id) = org_and_user(&store).await;
        let input = ConnInput {
            name: "mongo-prod".into(),
            kind: DbKind::Mongodb,
            host: "cluster0.mongodb.net".into(),
            port: 27017,
            user: "mongo-user".into(),
            password: Some("mongo-pw".into()),
            database: "app".into(),
            ssl_mode: None,
            auth_db: Some("admin".into()),
            srv: true,
            tls: true,
            ssl_ca_file: None,
            ssl_client_cert_file: None,
            ssl_client_key_file: None,
            retry_writes: true,
            replica_set: Some("rs0".into()),
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_auth_mode: None,
            ssh_key_file: None,
            ssh_host_key_fingerprint: None,
            ssh_password: None,
            ssh_key_passphrase: None,
        };
        let meta = store.conn_add(&org_id, &input, &user_id).await.unwrap();
        assert_eq!(meta.kind, DbKind::Mongodb);
        assert_eq!(meta.auth_db.as_deref(), Some("admin"));
        assert!(meta.srv);
        assert!(meta.tls);
        assert!(meta.retry_writes);
        assert_eq!(meta.replica_set.as_deref(), Some("rs0"));

        match store.conn_secret_params(&meta.id).await.unwrap() {
            AdapterParams::Mongodb(p) => {
                assert_eq!(p.password, "mongo-pw");
                assert_eq!(p.auth_db.as_deref(), Some("admin"));
                assert!(p.srv);
                assert!(p.tls);
                assert_eq!(p.retry_writes, Some(false));
                assert_eq!(p.replica_set.as_deref(), Some("rs0"));
            }
            AdapterParams::Postgres(_) => panic!("expected Mongodb params"),
        }

        // conn_get (metadata-only path) also carries the flags.
        let fetched = store.conn_get(&meta.id).await.unwrap().unwrap();
        assert!(fetched.srv && fetched.tls);
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn missing_and_wrong_key() {
        let store = super::super::store::test_store().await;
        assert_eq!(
            store.conn_secret_params("nope").await.err().unwrap(),
            super::ERR_NOT_FOUND
        );

        let other = super::super::store::test_store().await;
        let (org_id, user_id) = org_and_user(&other).await;
        // Same store instance, but with a different in-memory master_key —
        // simulates a mismatched DH_MASTER_KEY deployment.
        let mut other = other;
        other.master_key = [9u8; 32];
        let meta = other.conn_add(&org_id, &input("x", "pw"), &user_id).await.unwrap();

        let raw: Vec<u8> = sqlx::query("SELECT password_enc FROM connections WHERE id=$1")
            .bind(&meta.id)
            .fetch_one(&other.pool)
            .await
            .unwrap()
            .get("password_enc");
        assert!(crypto::decrypt(&[1u8; 32], &raw).is_err());
    }

    /// SSH secrets (password + key passphrase) round-trip through storage,
    /// a "keep existing" update leaves an un-provided one intact, and
    /// disabling the tunnel (ssh_host: None) clears both.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn ssh_secrets_round_trip_and_clear() {
        let store = super::super::store::test_store().await;
        let (org_id, user_id) = org_and_user(&store).await;

        let mut with_ssh = input("via-bastion", "dbpw");
        with_ssh.ssh_host = Some("bastion.internal".into());
        with_ssh.ssh_port = Some(2222);
        with_ssh.ssh_user = Some("tunnel".into());
        with_ssh.ssh_auth_mode = Some("password".into());
        with_ssh.ssh_password = Some("sshpw".into());
        let meta = store.conn_add(&org_id, &with_ssh, &user_id).await.unwrap();
        assert_eq!(meta.ssh_host.as_deref(), Some("bastion.internal"));
        assert_eq!(meta.ssh_port, Some(2222));

        let ssh_of = |ap: AdapterParams| match ap {
            AdapterParams::Postgres(p) => p.ssh.expect("ssh config"),
            AdapterParams::Mongodb(_) => panic!("expected Postgres params"),
        };
        let ssh = ssh_of(store.conn_secret_params(&meta.id).await.unwrap());
        assert_eq!(ssh.host, "bastion.internal");
        assert_eq!(ssh.password.as_deref(), Some("sshpw"));
        assert_eq!(ssh.key_passphrase, None);

        // Update without touching ssh_password keeps the stored one.
        let mut keep = with_ssh.clone();
        keep.ssh_password = None;
        keep.ssh_key_file = Some("/home/me/.ssh/id_ed25519".into());
        store.conn_update(&meta.id, &keep).await.unwrap();
        let ssh = ssh_of(store.conn_secret_params(&meta.id).await.unwrap());
        assert_eq!(ssh.password.as_deref(), Some("sshpw"));
        assert_eq!(ssh.key_file.as_deref(), Some("/home/me/.ssh/id_ed25519"));

        // Disabling the tunnel drops the stored secrets entirely.
        let mut disabled = keep.clone();
        disabled.ssh_host = None;
        let updated = store.conn_update(&meta.id, &disabled).await.unwrap();
        assert_eq!(updated.ssh_host, None);
        match store.conn_secret_params(&meta.id).await.unwrap() {
            AdapterParams::Postgres(p) => assert!(p.ssh.is_none()),
            AdapterParams::Mongodb(_) => panic!("expected Postgres params"),
        }
    }
}
