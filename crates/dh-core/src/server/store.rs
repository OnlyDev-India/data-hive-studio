//! Server state store — PostgreSQL only (`DH_DATABASE_URL` / `DATABASE_URL`).
//! Holds users and their provider identities, the claim state and server
//! invites, device sessions and their tokens, organizations, org membership + invites, the connection
//! vault, connection-grant overrides, and the audit log. The schema is built
//! by the numbered files in `crates/dh-core/migrations/`.
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

    /// Refuse an old-server database, then apply any new numbered migrations.
    /// sqlx takes a Postgres advisory lock while migrating, so several server
    /// copies starting at once do not clash.
    async fn migrate(&self) -> Result<(), sqlx::Error> {
        self.guard_old_database().await?;
        MIGRATOR.run(&self.pool).await?;
        Ok(())
    }

    /// The server before migrations had a `users.oauth_provider` column and
    /// no `_sqlx_migrations` table. Migrating over it would fail half way, so
    /// stop with a message first and leave the database untouched.
    async fn guard_old_database(&self) -> Result<(), sqlx::Error> {
        let old: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_schema = current_schema()
                              AND table_name = 'users' AND column_name = 'oauth_provider')
                AND NOT EXISTS (SELECT 1 FROM information_schema.tables
                                WHERE table_schema = current_schema()
                                  AND table_name = '_sqlx_migrations')",
        )
        .fetch_one(&self.pool)
        .await?;
        if old {
            return Err(sqlx::Error::Configuration(OLD_DATABASE_MESSAGE.into()));
        }
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

    /// Append an audit entry with no org, for an actor that has no `AuthCtx`
    /// yet (the claimer, a person accepting an invite). Best-effort like
    /// [`Store::audit`].
    pub async fn audit_user(
        &self,
        user_id: &str,
        action: &str,
        target: &str,
        detail: Option<&str>,
    ) -> Result<(), String> {
        audit_in(&self.pool, user_id, action, target, detail).await.map_err(|e| e.to_string())
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
//  Migrations
// ---------------------------------------------------------------------------

/// Numbered schema changes. An applied file is never edited: add a new one.
static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

const OLD_DATABASE_MESSAGE: &str = "this database was made by an older dh-server that had no versioned schema. \
This version cannot upgrade it and has left it untouched. Point DH_DATABASE_URL at an empty database, \
or keep running the older dh-server against this one.";

/// Audit insert usable on the pool or inside a transaction, so a trusted
/// action and its audit row can commit together.
pub(crate) async fn audit_in<'e, E>(
    exec: E,
    user_id: &str,
    action: &str,
    target: &str,
    detail: Option<&str>,
) -> Result<(), sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query(
        "INSERT INTO audit (ts_ms, org_id, user_id, action, target, detail) VALUES ($1,NULL,$2,$3,$4,$5)",
    )
    .bind(now_ms())
    .bind(user_id)
    .bind(action)
    .bind(target)
    .bind(detail)
    .execute(exec)
    .await?;
    Ok(())
}

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
    let store = Store { pool: test_pool_in(&new_test_schema().await).await, master_key: test_key() };
    store.migrate().await.expect("migrate test schema");
    store
}

/// Create a fresh, empty, randomly named schema and return its name.
#[cfg(test)]
async fn new_test_schema() -> String {
    let schema = format!("test_{}", hex::encode(rand::random::<[u8; 8]>()));
    let admin_pool = sqlx::PgPool::connect(&test_pg_url()).await.expect("connect for schema setup");
    sqlx::query(&format!("CREATE SCHEMA IF NOT EXISTS {schema}"))
        .execute(&admin_pool)
        .await
        .expect("create test schema");
    admin_pool.close().await;
    schema
}

/// A pool whose every connection uses `schema` as its `search_path`. Two
/// pools on one schema stand in for two server copies on one database.
#[cfg(test)]
async fn test_pool_in(schema: &str) -> sqlx::PgPool {
    let search_path_sql = format!("SET search_path TO {schema}");
    sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .after_connect(move |conn, _meta| {
            let sql = search_path_sql.clone();
            Box::pin(async move {
                sqlx::Executor::execute(conn, sql.as_str()).await?;
                Ok(())
            })
        })
        .connect(&test_pg_url())
        .await
        .expect("connect test pool")
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn table_exists(pool: &sqlx::PgPool, name: &str) -> bool {
        sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables
                            WHERE table_schema = current_schema() AND table_name = $1)",
        )
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn old_server_database_is_refused_and_left_untouched() {
        let pool = test_pool_in(&new_test_schema().await).await;
        // The shape the server had before migrations: oauth columns on users.
        sqlx::query("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, oauth_provider TEXT, oauth_subject TEXT)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO users VALUES ('u1','a@x.com','google','s1')").execute(&pool).await.unwrap();
        let store = Store { pool: pool.clone(), master_key: test_key() };

        let err = store.migrate().await.unwrap_err().to_string();
        assert!(err.contains("older dh-server"), "clear message, got: {err}");
        assert!(!table_exists(&pool, "_sqlx_migrations").await, "no migration was started");
        assert!(!table_exists(&pool, "identities").await, "no new table was made");
        let n: i64 = sqlx::query_scalar("SELECT count(*) FROM users WHERE oauth_provider='google'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 1, "the old data is intact");
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn new_database_is_built_once_even_when_copies_start_together() {
        let schema = new_test_schema().await;
        let a = Store { pool: test_pool_in(&schema).await, master_key: test_key() };
        let b = Store { pool: test_pool_in(&schema).await, master_key: test_key() };
        let (ra, rb) = tokio::join!(a.migrate(), b.migrate());
        ra.expect("first copy migrates");
        rb.expect("second copy migrates");

        let applied = || async { sqlx::query_scalar::<_, i64>("SELECT count(*) FROM _sqlx_migrations").fetch_one(&a.pool).await.unwrap() };
        let migrations = MIGRATOR.iter().count() as i64;
        assert_eq!(applied().await, migrations);
        // A restart applies nothing new, and the seeded settings row is still one row.
        a.migrate().await.expect("restart");
        assert_eq!(applied().await, migrations);
        let settings: i64 = sqlx::query_scalar("SELECT count(*) FROM server_settings").fetch_one(&a.pool).await.unwrap();
        assert_eq!(settings, 1);
        for t in [
            "users", "identities", "server_settings", "server_invites", "device_sessions", "access_tokens",
            "login_codes", "organizations", "audit",
        ] {
            assert!(table_exists(&a.pool, t).await, "{t} exists");
        }
        assert!(!table_exists(&a.pool, "sessions").await, "the old 30 day sessions table is gone");
    }
}

/// Insert a user and a Google identity (subject = email) directly, skipping
/// the sign in decision, so a test can start from any server state.
#[cfg(test)]
pub(crate) async fn test_user(store: &Store, email: &str, role: crate::server::auth::ServerRole) -> crate::server::auth::User {
    let id = uuid::Uuid::new_v4().to_string();
    let ts = now_ms();
    sqlx::query("INSERT INTO users (id, email, name, server_role, created_ms) VALUES ($1,$2,$3,$4,$5)")
        .bind(&id)
        .bind(email)
        .bind(email)
        .bind(role.as_str())
        .bind(ts)
        .execute(&store.pool)
        .await
        .expect("insert test user");
    sqlx::query("INSERT INTO identities (provider, subject, user_id, created_ms) VALUES ('google',$1,$2,$3)")
        .bind(email)
        .bind(&id)
        .bind(ts)
        .execute(&store.pool)
        .await
        .expect("insert test identity");
    store.user_get(&id).await.expect("load test user").expect("test user exists")
}
