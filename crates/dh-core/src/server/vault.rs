//! Shared PostgreSQL connection details, encrypted at rest. Passwords are
//! AES-256-GCM sealed with the server master key and never included in
//! metadata listings.

use super::crypto;
use super::store::{now_ms, Store, StorePool};
use uuid::Uuid;

/// Everything a client may see about a shared connection — never the password.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConnMeta {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub database: String,
    pub ssl_mode: Option<String>,
    pub created_by: String,
    pub created_ms: i64,
    pub updated_ms: i64,
}

/// Payload for creating or editing a connection's stored details.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConnInput {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    /// `None` on update = keep the existing password.
    pub password: Option<String>,
    pub database: String,
    #[serde(default)]
    pub ssl_mode: Option<String>,
}

pub const ERR_NOT_FOUND: &str = "connection not found";

macro_rules! parse_conn_row {
    ($r:expr) => {{
        use sqlx::Row;
        ConnRow {
            id: $r.get("id"),
            name: $r.get("name"),
            host: $r.get("host"),
            port: $r.get::<i64, _>("port"),
            user: $r.get("user"),
            password_enc: $r.get("password_enc"),
            database: $r.get("database"),
            ssl_mode: $r.get("ssl_mode"),
            created_by: $r.get("created_by"),
            created_ms: $r.get::<i64, _>("created_ms"),
            updated_ms: $r.get::<i64, _>("updated_ms"),
            archived: $r.get::<i64, _>("archived"),
        }
    }};
}

impl Store {
    pub async fn conn_add(
        &self,
        input: &ConnInput,
        created_by: &str,
    ) -> Result<ConnMeta, String> {
        let password = input.password.clone().unwrap_or_default();
        let enc = crypto::encrypt(&self.master_key, password.as_bytes())?;
        let id = Uuid::new_v4().to_string();
        let ts = now_ms();
        let (sql, _) = self.query_ph(
            r#"INSERT INTO connections
               (id, name, host, port, user, password_enc, database, ssl_mode, created_by, created_ms, updated_ms)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)"#,
        );
        match &self.pool {
            StorePool::Sqlite(p) => {
                sqlx::query(&sql)
                    .bind(&id)
                    .bind(&input.name)
                    .bind(&input.host)
                    .bind(input.port as i64)
                    .bind(&input.user)
                    .bind(&enc)
                    .bind(&input.database)
                    .bind(&input.ssl_mode)
                    .bind(created_by)
                    .bind(ts)
                    .bind(ts)
                    .execute(p)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            StorePool::Postgres(p) => {
                sqlx::query(&sql)
                    .bind(&id)
                    .bind(&input.name)
                    .bind(&input.host)
                    .bind(input.port as i64)
                    .bind(&input.user)
                    .bind(&enc)
                    .bind(&input.database)
                    .bind(&input.ssl_mode)
                    .bind(created_by)
                    .bind(ts)
                    .bind(ts)
                    .execute(p)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(ConnMeta {
            id,
            name: input.name.clone(),
            host: input.host.clone(),
            port: input.port,
            user: input.user.clone(),
            database: input.database.clone(),
            ssl_mode: input.ssl_mode.clone(),
            created_by: created_by.to_string(),
            created_ms: ts,
            updated_ms: ts,
        })
    }

    /// Edit stored details. Requires edit access (checked by callers).
    /// A `None` password in the input keeps the current one.
    pub async fn conn_update(
        &self,
        id: &str,
        input: &ConnInput,
    ) -> Result<ConnMeta, String> {
        let existing = self.conn_get_row(id).await?.ok_or(ERR_NOT_FOUND)?;
        let enc = match &input.password {
            Some(p) => crypto::encrypt(&self.master_key, p.as_bytes())?,
            None => existing.password_enc,
        };
        let ts = now_ms();
        let (sql, _) = self.query_ph(
            r#"UPDATE connections
               SET name=?, host=?, port=?, user=?, password_enc=?, database=?, ssl_mode=?, updated_ms=?
               WHERE id=?"#,
        );
        match &self.pool {
            StorePool::Sqlite(p) => {
                sqlx::query(&sql)
                    .bind(&input.name)
                    .bind(&input.host)
                    .bind(input.port as i64)
                    .bind(&input.user)
                    .bind(&enc)
                    .bind(&input.database)
                    .bind(&input.ssl_mode)
                    .bind(ts)
                    .bind(id)
                    .execute(p)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            StorePool::Postgres(p) => {
                sqlx::query(&sql)
                    .bind(&input.name)
                    .bind(&input.host)
                    .bind(input.port as i64)
                    .bind(&input.user)
                    .bind(&enc)
                    .bind(&input.database)
                    .bind(&input.ssl_mode)
                    .bind(ts)
                    .bind(id)
                    .execute(p)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
        self.conn_get(id).await?.ok_or_else(|| ERR_NOT_FOUND.into())
    }

    pub async fn conn_archive(&self, id: &str) -> Result<(), String> {
        let (sql, _) = self.query_ph("UPDATE connections SET archived=1 WHERE id=?");
        let n = match &self.pool {
            StorePool::Sqlite(p) => {
                sqlx::query(&sql)
                    .bind(id)
                    .execute(p)
                    .await
                    .map_err(|e| e.to_string())?
                    .rows_affected()
            }
            StorePool::Postgres(p) => {
                sqlx::query(&sql)
                    .bind(id)
                    .execute(p)
                    .await
                    .map_err(|e| e.to_string())?
                    .rows_affected()
            }
        };
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

    pub async fn conn_list_active(&self) -> Result<Vec<ConnMeta>, String> {
        let (sql, _) = self.query_ph(
            "SELECT * FROM connections WHERE archived=0 ORDER BY created_ms DESC",
        );
        let rows = match &self.pool {
            StorePool::Sqlite(p) => sqlx::query(&sql)
                .fetch_all(p)
                .await
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|r| parse_conn_row!(r))
                .collect::<Vec<_>>(),
            StorePool::Postgres(p) => sqlx::query(&sql)
                .fetch_all(p)
                .await
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|r| parse_conn_row!(r))
                .collect::<Vec<_>>(),
        };
        rows.into_iter()
            .map(Self::row_to_meta)
            .collect()
    }

    /// Decrypt the password. Gateway-internal; never serialize this type.
    pub async fn conn_secret_params(
        &self,
        id: &str,
    ) -> Result<crate::db::PgParams, String> {
        let row = self.conn_get_row(id).await?.ok_or(ERR_NOT_FOUND)?;
        let password = String::from_utf8(
            crypto::decrypt(&self.master_key, &row.password_enc)?,
        )
        .map_err(|_| "stored password is not utf-8".to_string())?;
        Ok(crate::db::PgParams {
            host: row.host,
            port: row.port as u16,
            user: row.user,
            password,
            database: row.database,
            ssl_mode: row.ssl_mode,
        })
    }

    async fn conn_get_row(&self, id: &str) -> Result<Option<ConnRow>, String> {
        let (sql, _) = self.query_ph("SELECT * FROM connections WHERE id=?");
        let rec = match &self.pool {
            StorePool::Sqlite(p) => sqlx::query(&sql)
                .bind(id)
                .fetch_optional(p)
                .await
                .map_err(|e| e.to_string())?
                .map(|r| parse_conn_row!(r)),
            StorePool::Postgres(p) => sqlx::query(&sql)
                .bind(id)
                .fetch_optional(p)
                .await
                .map_err(|e| e.to_string())?
                .map(|r| parse_conn_row!(r)),
        };
        Ok(rec)
    }

    fn row_to_meta(r: ConnRow) -> Result<ConnMeta, String> {
        Ok(ConnMeta {
            id: r.id.clone(),
            name: r.name.clone(),
            host: r.host.clone(),
            port: r.port as u16,
            user: r.user.clone(),
            database: r.database.clone(),
            ssl_mode: r.ssl_mode.clone(),
            created_by: r.created_by.clone(),
            created_ms: r.created_ms,
            updated_ms: r.updated_ms,
        })
    }
}

#[derive(Debug)]
struct ConnRow {
    id: String,
    name: String,
    host: String,
    port: i64,
    user: String,
    #[allow(dead_code)]
    password_enc: Vec<u8>,
    database: String,
    ssl_mode: Option<String>,
    created_by: String,
    created_ms: i64,
    updated_ms: i64,
    #[allow(dead_code)]
    archived: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;

    fn input(name: &str, pw: &str) -> ConnInput {
        ConnInput {
            name: name.into(),
            host: "db.internal".into(),
            port: 5432,
            user: "alice".into(),
            password: Some(pw.into()),
            database: "appdb".into(),
            ssl_mode: Some("require".into()),
        }
    }

    #[tokio::test]
    async fn add_list_update_archive() {
        let store = super::super::store::test_store().await;
        let meta = store.conn_add(&input("prod", "s3cret"), "dev1").await.unwrap();

        // Metadata must never contain the secret.
        let listed = store.conn_list_active().await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, meta.id);
        assert!(!serde_json::to_string(&listed).unwrap().contains("s3cret"));

        // Secret roundtrips through encryption with correct params.
        let params = store.conn_secret_params(&meta.id).await.unwrap();
        assert_eq!(params.password, "s3cret");
        assert_eq!(params.host, "db.internal");

        // Update without password keeps the stored one.
        let mut edit = input("prod-renamed", "");
        edit.password = None;
        let updated = store.conn_update(&meta.id, &edit).await.unwrap();
        assert_eq!(updated.name, "prod-renamed");
        assert!(store.conn_secret_params(&meta.id).await.unwrap().password == "s3cret");

        // Update WITH password rotates it.
        let mut rotate = edit.clone();
        rotate.password = Some("newpw".into());
        store.conn_update(&meta.id, &rotate).await.unwrap();
        assert!(store.conn_secret_params(&meta.id).await.unwrap().password == "newpw");

        // Archive hides from listing but secret stays intact internally.
        store.conn_archive(&meta.id).await.unwrap();
        assert!(store.conn_list_active().await.unwrap().is_empty());
        assert_eq!(store.conn_secret_params(&meta.id).await.unwrap().password, "newpw");
        assert_eq!(store.conn_get(&meta.id).await.unwrap().unwrap().name, "prod-renamed");
    }

    #[tokio::test]
    async fn missing_and_wrong_key() {
        let store = super::super::store::test_store().await;
        assert_eq!(
            store.conn_secret_params("nope").await.err().unwrap(),
            super::ERR_NOT_FOUND
        );

        let other = Store::open(super::super::store::StoreConfig {
            path: ":memory:".into(),
            master_key: [9u8; 32],
            pg_url: None,
        })
        .await
        .unwrap();
        let meta = other.conn_add(&input("x", "pw"), "d").await.unwrap();

        // Same logical db content under a different key must fail to decrypt.
        let (sql, _) = other.query_ph("SELECT password_enc FROM connections WHERE id=?");
        let raw: Vec<u8> = match &other.pool {
            StorePool::Sqlite(p) => sqlx::query(&sql)
                .bind(&meta.id)
                .fetch_one(p)
                .await
                .unwrap()
                .get("password_enc"),
            StorePool::Postgres(p) => sqlx::query(&sql)
                .bind(&meta.id)
                .fetch_one(p)
                .await
                .unwrap()
                .get("password_enc"),
        };
        assert!(crypto::decrypt(&[1u8; 32], &raw).is_err());
    }
}
