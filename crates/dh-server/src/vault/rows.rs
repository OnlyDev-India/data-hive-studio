use sqlx::Row;
use crate::store::Store;
use dh_core::api::DbKind;
use dh_server_client::vault::ConnMeta;

pub(super) fn kind_to_str(kind: DbKind) -> &'static str {
    match kind {
        DbKind::Sqlite => "sqlite",
        DbKind::Postgres => "postgres",
        DbKind::Mysql => "mysql",
        DbKind::Mongodb => "mongodb",
        DbKind::DocumentDb => "documentdb",
    }
}

pub(super) fn kind_from_str(s: &str) -> DbKind {
    match s {
        "sqlite" => DbKind::Sqlite,
        "mysql" => DbKind::Mysql,
        "mongodb" => DbKind::Mongodb,
        "documentdb" => DbKind::DocumentDb,
        // Covers "postgres" and any unrecognized/legacy value — matches the
        // column's own DEFAULT 'postgres'.
        _ => DbKind::Postgres,
    }
}

pub(super) fn parse_conn_row(r: &sqlx::postgres::PgRow) -> ConnRow {
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
        pool_max: r.get("pool_max"),
        pool_min: r.get("pool_min"),
        connect_timeout_secs: r.get("connect_timeout_secs"),
        idle_timeout_secs: r.get("idle_timeout_secs"),
        max_lifetime_secs: r.get("max_lifetime_secs"),
        server_selection_timeout_secs: r.get("server_selection_timeout_secs"),
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
    pub(super) async fn conn_get_row(&self, id: &str) -> Result<Option<ConnRow>, String> {
        let rec = sqlx::query("SELECT * FROM connections WHERE id=$1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(rec.as_ref().map(parse_conn_row))
    }

    pub(super) fn row_to_meta(r: ConnRow) -> Result<ConnMeta, String> {
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
            pool_max: r.pool_max.map(|v| v as u32),
            pool_min: r.pool_min.map(|v| v as u32),
            connect_timeout_secs: r.connect_timeout_secs.map(|v| v as u32),
            idle_timeout_secs: r.idle_timeout_secs.map(|v| v as u32),
            max_lifetime_secs: r.max_lifetime_secs.map(|v| v as u32),
            server_selection_timeout_secs: r.server_selection_timeout_secs.map(|v| v as u32),
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
pub(super) struct ConnRow {
    pub(super) id: String,
    pub(super) org_id: String,
    pub(super) name: String,
    pub(super) kind: String,
    pub(super) host: String,
    pub(super) port: i64,
    pub(super) user: String,
    pub(super) password_enc: Vec<u8>,
    pub(super) database: String,
    pub(super) ssl_mode: Option<String>,
    pub(super) auth_db: Option<String>,
    pub(super) srv: i64,
    pub(super) tls: i64,
    pub(super) ssl_ca_file: Option<String>,
    pub(super) ssl_client_cert_file: Option<String>,
    pub(super) ssl_client_key_file: Option<String>,
    pub(super) retry_writes: i64,
    pub(super) replica_set: Option<String>,
    pub(super) pool_max: Option<i32>,
    pub(super) pool_min: Option<i32>,
    pub(super) connect_timeout_secs: Option<i32>,
    pub(super) idle_timeout_secs: Option<i32>,
    pub(super) max_lifetime_secs: Option<i32>,
    pub(super) server_selection_timeout_secs: Option<i32>,
    pub(super) ssh_host: Option<String>,
    pub(super) ssh_port: Option<u16>,
    pub(super) ssh_user: Option<String>,
    pub(super) ssh_auth_mode: Option<String>,
    pub(super) ssh_key_file: Option<String>,
    pub(super) ssh_host_key_fingerprint: Option<String>,
    pub(super) ssh_secrets_enc: Option<Vec<u8>>,
    pub(super) created_by: String,
    pub(super) created_ms: i64,
    pub(super) updated_ms: i64,
    #[allow(dead_code)]
    archived: i64,
}
