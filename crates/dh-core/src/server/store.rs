//! Server state store — PostgreSQL only (`DH_DATABASE_URL` / `DATABASE_URL`).
//! Holds users, sessions, organizations, org membership + invites, the
//! connection vault, connection-grant overrides, and the audit log.
//!
//! SQLite is deliberately not supported here: this schema is inherently a
//! hosted, multi-tenant model (organizations, OAuth sessions), and Vercel
//! (and most serverless hosts) can't persist a local file between
//! invocations anyway — self-hosters point `DH_DATABASE_URL` at any
//! Postgres, including a free Neon/Supabase instance.

use sqlx::Row;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
//  Store
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct Store {
    pub pool: sqlx::PgPool,
    pub master_key: [u8; 32],
}

pub struct StoreConfig {
    pub master_key: [u8; 32],
    /// `postgres://user:pass@host/db` — required. Accepts the pooled
    /// connection string Neon/Supabase's Vercel Marketplace integrations
    /// inject, same as any other Postgres URL.
    pub pg_url: String,
}

impl Store {
    pub async fn open(cfg: StoreConfig) -> Result<Self, sqlx::Error> {
        // Conservative pool size: on serverless hosts, many concurrent
        // function instances may each hold their own pool against the same
        // Postgres — prefer the provider's PgBouncer-pooled connection
        // string over raising this.
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(5)
            .connect(&cfg.pg_url)
            .await?;
        let store = Self { pool, master_key: cfg.master_key };
        store.migrate().await?;
        Ok(store)
    }

    async fn migrate(&self) -> Result<(), sqlx::Error> {
        // `sqlx::query()` prepares via Postgres's extended protocol, which
        // rejects multiple ;-separated commands in one string ("cannot
        // insert multiple commands into a prepared statement") — `raw_sql`
        // uses the simple query protocol instead, which Postgres allows
        // multi-statement for. DDL only, never user input, so no bind
        // parameters are needed here anyway.
        sqlx::raw_sql(PG_DDL).execute(&self.pool).await?;
        Ok(())
    }

    /// Append an audit entry (best-effort — never fail the caller's op).
    /// `org_id` is a separate parameter, not part of `AuthCtx` — a single
    /// authenticated user can belong to several organizations, so which org
    /// an action concerns is decided per-call by whoever already resolved it
    /// (usually via the connection being acted on), not by the identity
    /// extractor itself.
    pub async fn audit(
        &self,
        ctx: &crate::server::auth::AuthCtx,
        org_id: Option<&str>,
        action: &str,
        target: &str,
        detail: Option<&str>,
    ) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO audit (ts_ms, org_id, user_id, action, target, detail) VALUES ($1,$2,$3,$4,$5,$6)",
        )
        .bind(now_ms())
        .bind(org_id)
        .bind(&ctx.user_id)
        .bind(action)
        .bind(target)
        .bind(detail)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn audit_recent(&self, org_id: &str, limit: i64) -> Result<Vec<AuditEntry>, String> {
        let rows = sqlx::query(
            "SELECT ts_ms, org_id, user_id, action, target, detail FROM audit
             WHERE org_id = $1 ORDER BY id DESC LIMIT $2",
        )
        .bind(org_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|r| AuditEntry {
                ts_ms: r.get("ts_ms"),
                org_id: r.get("org_id"),
                user_id: r.get("user_id"),
                action: r.get("action"),
                target: r.get("target"),
                detail: r.get("detail"),
            })
            .collect())
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AuditEntry {
    pub ts_ms: i64,
    pub org_id: Option<String>,
    pub user_id: Option<String>,
    pub action: String,
    pub target: String,
    pub detail: Option<String>,
}

// ---------------------------------------------------------------------------
//  PostgreSQL DDL
// ---------------------------------------------------------------------------

const PG_DDL: &str = r#"
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    avatar_url TEXT,
    oauth_provider TEXT NOT NULL,
    oauth_subject TEXT NOT NULL,
    created_ms BIGINT NOT NULL,
    UNIQUE (oauth_provider, oauth_subject)
);
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_ms BIGINT NOT NULL,
    expires_ms BIGINT NOT NULL,
    last_used_ms BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_ms BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS org_members (
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
    joined_ms BIGINT NOT NULL,
    PRIMARY KEY (org_id, user_id)
);
CREATE TABLE IF NOT EXISTS org_invites (
    code TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
    created_by TEXT NOT NULL REFERENCES users(id),
    max_uses INTEGER,
    uses_count INTEGER NOT NULL DEFAULT 0,
    expires_ms BIGINT,
    created_ms BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'postgres',
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 5432,
    "user" TEXT NOT NULL,
    password_enc BYTEA NOT NULL,
    database TEXT NOT NULL,
    ssl_mode TEXT,
    auth_db TEXT,
    srv INTEGER NOT NULL DEFAULT 0,
    tls INTEGER NOT NULL DEFAULT 0,
    ssl_ca_file TEXT,
    ssl_client_cert_file TEXT,
    ssl_client_key_file TEXT,
    retry_writes INTEGER NOT NULL DEFAULT 0,
    replica_set TEXT,
    pool_max INTEGER,
    pool_min INTEGER,
    connect_timeout_secs INTEGER,
    idle_timeout_secs INTEGER,
    max_lifetime_secs INTEGER,
    server_selection_timeout_secs INTEGER,
    ssh_host TEXT,
    ssh_port INTEGER,
    ssh_user TEXT,
    ssh_auth_mode TEXT,
    ssh_key_file TEXT,
    ssh_host_key_fingerprint TEXT,
    ssh_secrets_enc BYTEA,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_ms BIGINT NOT NULL,
    updated_ms BIGINT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS connection_grants (
    conn_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    can_read INTEGER NOT NULL DEFAULT 0,
    can_update INTEGER NOT NULL DEFAULT 0,
    can_delete INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (conn_id, user_id)
);
CREATE TABLE IF NOT EXISTS audit (
    id BIGSERIAL PRIMARY KEY,
    ts_ms BIGINT NOT NULL,
    org_id TEXT,
    user_id TEXT,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    detail TEXT
);
"#;

// ---------------------------------------------------------------------------
//  Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
pub(crate) fn test_key() -> [u8; 32] {
    [42u8; 32]
}

/// Test Postgres URL — defaults to the throwaway local instance used for
/// this session's development; override with `DH_TEST_DATABASE_URL` for
/// CI/other environments.
#[cfg(test)]
fn test_pg_url() -> String {
    std::env::var("DH_TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres@127.0.0.1:5544/dh_server_test".to_string())
}

/// `cargo test` runs `#[tokio::test]`s concurrently in the same process, all
/// against the one Postgres instance above — so each `test_store()` call
/// gets its own randomly-named schema (via `search_path`, set on every
/// connection this pool ever opens) rather than sharing/truncating tables,
/// which would race across tests. Mirrors the isolation `:memory:` SQLite
/// used to give each test automatically.
#[cfg(test)]
pub(crate) async fn test_store() -> Store {
    let schema = format!("test_{}", hex::encode(rand::random::<[u8; 8]>()));
    let url = test_pg_url();

    {
        let admin_pool = sqlx::PgPool::connect(&url).await.expect("connect for schema setup");
        sqlx::query(&format!("CREATE SCHEMA IF NOT EXISTS {schema}"))
            .execute(&admin_pool)
            .await
            .expect("create test schema");
        admin_pool.close().await;
    }

    let search_path_sql = format!("SET search_path TO {schema}");
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .after_connect(move |conn, _meta| {
            let sql = search_path_sql.clone();
            Box::pin(async move {
                sqlx::Executor::execute(conn, sql.as_str()).await?;
                Ok(())
            })
        })
        .connect(&url)
        .await
        .expect("connect test pool");

    let store = Store { pool, master_key: test_key() };
    store.migrate().await.expect("migrate test schema");
    store
}
