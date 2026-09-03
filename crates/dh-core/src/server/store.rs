//! Server state store — supports both SQLite (file-based) and PostgreSQL
//! (controlled by `DH_DATABASE_URL` env var). Holds connection vault,
//! grants, invites, devices, and tokens.

use sqlx::Row;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
//  Backend-agnostic pool wrapper
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub enum StorePool {
    Sqlite(sqlx::SqlitePool),
    Postgres(sqlx::PgPool),
}

impl StorePool {
    /// Return the positional placeholder for 1-based index `n`.
    pub fn ph_n(&self, n: usize) -> String {
        match self {
            StorePool::Sqlite(_) => "?".into(),
            StorePool::Postgres(_) => format!("${n}"),
        }
    }
}

// ---------------------------------------------------------------------------
//  Store
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct Store {
    pub pool: StorePool,
    pub master_key: [u8; 32],
}

pub struct StoreConfig {
    /// For SQLite: file path or `:memory:`. Ignored when `pg_url` is set.
    pub path: String,
    pub master_key: [u8; 32],
    /// Optional PostgreSQL connection URL (e.g. `postgres://user:pass@host/db`).
    /// When set, overrides `path` and uses PG for the store.
    pub pg_url: Option<String>,
}

impl Store {
    pub async fn open(cfg: StoreConfig) -> Result<Self, sqlx::Error> {
        let pool = if let Some(url) = &cfg.pg_url {
            let pool = sqlx::PgPool::connect(url).await?;
            StorePool::Postgres(pool)
        } else {
            use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
            use std::str::FromStr;
            let opts = SqliteConnectOptions::from_str(&cfg.path)?
                .create_if_missing(true)
                .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);
            let mut pool_builder = SqlitePoolOptions::new();
            if cfg.path == ":memory:" {
                pool_builder = pool_builder.max_connections(1);
            }
            StorePool::Sqlite(pool_builder.connect_with(opts).await?)
        };
        let store = Self { pool, master_key: cfg.master_key };
        store.migrate().await?;
        Ok(store)
    }

    async fn migrate(&self) -> Result<(), sqlx::Error> {
        match &self.pool {
            StorePool::Sqlite(p) => {
                sqlx::query(SQLITE_DDL).execute(p).await?;
                for (table, col, decl) in SQLITE_ALTER_COLUMNS {
                    self.add_column_if_missing_sqlite(p, table, col, decl).await?;
                }
            }
            StorePool::Postgres(p) => {
                sqlx::query(PG_DDL).execute(p).await?;
                // CREATE TABLE IF NOT EXISTS only helps fresh installs — an
                // existing store predates the `kind` column, so add it here
                // too (Postgres's IF NOT EXISTS on ADD COLUMN makes this
                // idempotent, unlike SQLite which needs the introspection
                // path above).
                sqlx::query(
                    "ALTER TABLE connections ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'postgres'",
                )
                .execute(p)
                .await?;
                // MongoDB-only connection details — see vault.rs's ConnMeta/
                // ConnInput doc comment.
                sqlx::query(
                    "ALTER TABLE connections ADD COLUMN IF NOT EXISTS auth_db TEXT",
                )
                .execute(p)
                .await?;
                sqlx::query(
                    "ALTER TABLE connections ADD COLUMN IF NOT EXISTS srv INTEGER NOT NULL DEFAULT 0",
                )
                .execute(p)
                .await?;
                sqlx::query(
                    "ALTER TABLE connections ADD COLUMN IF NOT EXISTS tls INTEGER NOT NULL DEFAULT 0",
                )
                .execute(p)
                .await?;
            }
        }
        Ok(())
    }

    async fn add_column_if_missing_sqlite(
        &self,
        pool: &sqlx::SqlitePool,
        table: &str,
        column: &str,
        decl: &str,
    ) -> Result<(), sqlx::Error> {
        let rows = sqlx::query(&format!("PRAGMA table_info({table})"))
            .fetch_all(pool)
            .await?;
        let exists = rows.iter().any(|r| r.get::<String, _>("name") == column);
        if !exists {
            sqlx::query(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"))
                .execute(pool)
                .await?;
        }
        Ok(())
    }

    /// Build a query with the correct placeholders for the active backend.
    /// Replaces each `?` in the template with the backend's placeholder.
    pub(crate) fn query_ph(&self, sql: &str) -> (String, usize) {
        let mut out = String::with_capacity(sql.len());
        let mut n = 0;
        for ch in sql.chars() {
            if ch == '?' {
                n += 1;
                out.push_str(&self.pool.ph_n(n));
            } else {
                out.push(ch);
            }
        }
        (out, n)
    }

    /// Append an audit entry (best-effort — never fail the caller's op).
    pub async fn audit(
        &self,
        ctx: &crate::server::identity::AuthCtx,
        action: &str,
        target: &str,
        detail: Option<&str>,
    ) -> Result<(), String> {
        let (sql, _) = self.query_ph(
            "INSERT INTO audit (ts_ms, user_name, action, target, detail) VALUES (?,?,?,?,?)",
        );
        match &self.pool {
            StorePool::Sqlite(p) => {
                sqlx::query(&sql)
                    .bind(now_ms())
                    .bind(&ctx.token)
                    .bind(action)
                    .bind(target)
                    .bind(detail)
                    .execute(p)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            StorePool::Postgres(p) => {
                sqlx::query(&sql)
                    .bind(now_ms())
                    .bind(&ctx.token)
                    .bind(action)
                    .bind(target)
                    .bind(detail)
                    .execute(p)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    pub async fn audit_recent(&self, limit: i64) -> Result<Vec<AuditEntry>, String> {
        let (sql, _) = self.query_ph(
            "SELECT ts_ms, user_name, action, target, detail FROM audit ORDER BY id DESC LIMIT ?",
        );
        macro_rules! parse_audit_rows {
            ($rows:expr) => {{
                let mut out = Vec::new();
                for r in $rows {
                    out.push(AuditEntry {
                        ts_ms: r.get::<i64, _>("ts_ms"),
                        user_name: r.get("user_name"),
                        action: r.get("action"),
                        target: r.get("target"),
                        detail: r.get("detail"),
                    });
                }
                out
            }};
        }
        let out = match &self.pool {
            StorePool::Sqlite(p) => {
                let rows = sqlx::query(&sql)
                    .bind(limit)
                    .fetch_all(p)
                    .await
                    .map_err(|e| e.to_string())?;
                parse_audit_rows!(rows)
            }
            StorePool::Postgres(p) => {
                let rows = sqlx::query(&sql)
                    .bind(limit)
                    .fetch_all(p)
                    .await
                    .map_err(|e| e.to_string())?;
                parse_audit_rows!(rows)
            }
        };
        Ok(out)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AuditEntry {
    pub ts_ms: i64,
    pub user_name: String,
    pub action: String,
    pub target: String,
    pub detail: Option<String>,
}

// ---------------------------------------------------------------------------
//  SQLite DDL + migrations
// ---------------------------------------------------------------------------

const SQLITE_DDL: &str = r#"
CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'postgres',
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 5432,
    "user" TEXT NOT NULL,
    password_enc BLOB NOT NULL,
    database TEXT NOT NULL,
    ssl_mode TEXT,
    auth_db TEXT,
    srv INTEGER NOT NULL DEFAULT 0,
    tls INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_ms INTEGER NOT NULL,
    updated_ms INTEGER NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS grants (
    token TEXT NOT NULL,
    conn_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    can_read INTEGER NOT NULL DEFAULT 0,
    can_update INTEGER NOT NULL DEFAULT 0,
    can_delete INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (token, conn_id)
);
CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    prefix TEXT NOT NULL CHECK (prefix IN ('adm_','tem_')),
    user_name TEXT NOT NULL,
    team_name TEXT,
    created_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL REFERENCES tokens(token),
    ip_address TEXT,
    first_seen_ms INTEGER NOT NULL,
    last_connected_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_ms INTEGER NOT NULL,
    user_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    detail TEXT
);
"#;

const SQLITE_ALTER_COLUMNS: &[(&str, &str, &str)] = &[
    // Existing sqlite-backed stores predate the `kind` column — every prior
    // row was implicitly Postgres, so the default backfills them correctly.
    ("connections", "kind", "TEXT NOT NULL DEFAULT 'postgres'"),
    // MongoDB-only connection details — see vault.rs's ConnMeta/ConnInput
    // doc comment. Defaults keep every pre-existing (Postgres) row correct.
    ("connections", "auth_db", "TEXT"),
    ("connections", "srv", "INTEGER NOT NULL DEFAULT 0"),
    ("connections", "tls", "INTEGER NOT NULL DEFAULT 0"),
];

// ---------------------------------------------------------------------------
//  PostgreSQL DDL
// ---------------------------------------------------------------------------

const PG_DDL: &str = r#"
CREATE TABLE IF NOT EXISTS connections (
    id TEXT PRIMARY KEY,
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
    created_by TEXT NOT NULL,
    created_ms BIGINT NOT NULL,
    updated_ms BIGINT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS grants (
    token TEXT NOT NULL,
    conn_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    can_read INTEGER NOT NULL DEFAULT 0,
    can_update INTEGER NOT NULL DEFAULT 0,
    can_delete INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (token, conn_id)
);
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL REFERENCES tokens(token),
    ip_address TEXT,
    first_seen_ms BIGINT NOT NULL,
    last_connected_ms BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    prefix TEXT NOT NULL CHECK (prefix IN ('adm_','tem_')),
    user_name TEXT NOT NULL,
    team_name TEXT,
    created_ms BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
    id BIGSERIAL PRIMARY KEY,
    ts_ms BIGINT NOT NULL,
    user_name TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    detail TEXT
);
"#;

// ---------------------------------------------------------------------------
//  Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn grants_table_has_can_read_after_migrate() {
    let store = Store::open(StoreConfig {
        path: ":memory:".into(),
        master_key: [1u8; 32],
        pg_url: None,
    })
    .await
    .unwrap();
    let rows = match &store.pool {
        StorePool::Sqlite(p) => sqlx::query("PRAGMA table_info(grants)")
            .fetch_all(p)
            .await
            .unwrap(),
        StorePool::Postgres(_) => panic!("PRAGMA not supported on PG"),
    };
    let names: Vec<String> = rows.iter().map(|r| r.get::<String, _>("name")).collect();
    println!("grants columns: {:?}", names);
    assert!(names.iter().any(|n| n == "can_read"), "columns: {names:?}");
    assert!(names.iter().any(|n| n == "can_update"), "columns: {names:?}");
    assert!(names.iter().any(|n| n == "can_delete"), "columns: {names:?}");
    assert!(!names.iter().any(|n| n == "data_access"), "old column data_access should not exist: {names:?}");
    assert!(!names.iter().any(|n| n == "can_edit"), "old column can_edit should not exist: {names:?}");
}

#[cfg(test)]
pub(crate) fn test_key() -> [u8; 32] {
    [42u8; 32]
}

#[cfg(test)]
pub(crate) async fn test_store() -> Store {
    Store::open(StoreConfig {
        path: ":memory:".into(),
        master_key: test_key(),
        pg_url: None,
    })
    .await
    .expect("test store")
}
