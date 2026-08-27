//! Per-device grant model: three boolean columns per (token, connection):
//! `can_read`, `can_update`, `can_delete`.

use super::store::{Store, StorePool};
use sqlx::Row;

/// Effective data-access level derived from grant booleans.
/// Returned by `Gateway::authorize()` so callers know what they can do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DataAccess {
    Readonly,
    Readwrite,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Grant {
    pub token: String,
    pub conn_id: String,
    pub can_read: bool,
    pub can_update: bool,
    pub can_delete: bool,
}

pub const ERR_NO_GRANT: &str = "no access to this connection";

macro_rules! parse_grant_row {
    ($r:expr) => {{
        use sqlx::Row;
        Grant {
            token: $r.get("token"),
            conn_id: $r.get("conn_id"),
            can_read: $r.get::<i64, _>("can_read") != 0,
            can_update: $r.get::<i64, _>("can_update") != 0,
            can_delete: $r.get::<i64, _>("can_delete") != 0,
        }
    }};
}

impl Store {
    pub async fn grant_upsert(
        &self,
        token: &str,
        conn_id: &str,
        can_read: bool,
        can_update: bool,
        can_delete: bool,
    ) -> Result<(), String> {
        let (sql, _) = self.query_ph(
            r#"INSERT INTO grants (token, conn_id, can_read, can_update, can_delete)
               VALUES (?,?,?,?,?)
               ON CONFLICT(token, conn_id)
               DO UPDATE SET can_read=excluded.can_read,
                             can_update=excluded.can_update,
                             can_delete=excluded.can_delete"#,
        );
        match &self.pool {
            StorePool::Sqlite(p) => {
                sqlx::query(&sql)
                    .bind(token)
                    .bind(conn_id)
                    .bind(can_read as i64)
                    .bind(can_update as i64)
                    .bind(can_delete as i64)
                    .execute(p)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            StorePool::Postgres(p) => {
                sqlx::query(&sql)
                    .bind(token)
                    .bind(conn_id)
                    .bind(can_read as i64)
                    .bind(can_update as i64)
                    .bind(can_delete as i64)
                    .execute(p)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    pub async fn grant_revoke(&self, token: &str, conn_id: &str) -> Result<(), String> {
        let (sql, _) = self.query_ph("DELETE FROM grants WHERE token=? AND conn_id=?");
        match &self.pool {
            StorePool::Sqlite(p) => {
                sqlx::query(&sql)
                    .bind(token)
                    .bind(conn_id)
                    .execute(p)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            StorePool::Postgres(p) => {
                sqlx::query(&sql)
                    .bind(token)
                    .bind(conn_id)
                    .execute(p)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    /// All grants for one connection (admin views / revoke cascades).
    pub async fn grants_for_conn(&self, conn_id: &str) -> Result<Vec<Grant>, String> {
        let (sql, _) = self.query_ph("SELECT * FROM grants WHERE conn_id=?");
        let rows = match &self.pool {
            StorePool::Sqlite(p) => sqlx::query(&sql)
                .bind(conn_id)
                .fetch_all(p)
                .await
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|r| parse_grant_row!(r))
                .collect(),
            StorePool::Postgres(p) => sqlx::query(&sql)
                .bind(conn_id)
                .fetch_all(p)
                .await
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|r| parse_grant_row!(r))
                .collect(),
        };
        Ok(rows)
    }

    pub async fn grants_for_device(&self, token: &str) -> Result<Vec<Grant>, String> {
        let (sql, _) = self.query_ph("SELECT * FROM grants WHERE token=?");
        let rows = match &self.pool {
            StorePool::Sqlite(p) => sqlx::query(&sql)
                .bind(token)
                .fetch_all(p)
                .await
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|r| parse_grant_row!(r))
                .collect(),
            StorePool::Postgres(p) => sqlx::query(&sql)
                .bind(token)
                .fetch_all(p)
                .await
                .map_err(|e| e.to_string())?
                .into_iter()
                .map(|r| parse_grant_row!(r))
                .collect(),
        };
        Ok(rows)
    }

    pub async fn grant_can_read(&self, token: &str, conn_id: &str) -> Result<bool, String> {
        let (sql, _) =
            self.query_ph("SELECT can_read FROM grants WHERE token=? AND conn_id=?");
        let result = match &self.pool {
            StorePool::Sqlite(p) => sqlx::query(&sql)
                .bind(token)
                .bind(conn_id)
                .fetch_optional(p)
                .await
                .map_err(|e| e.to_string())?
                .map(|r| r.get::<i64, _>("can_read") != 0)
                .unwrap_or(false),
            StorePool::Postgres(p) => sqlx::query(&sql)
                .bind(token)
                .bind(conn_id)
                .fetch_optional(p)
                .await
                .map_err(|e| e.to_string())?
                .map(|r| r.get::<i64, _>("can_read") != 0)
                .unwrap_or(false),
        };
        Ok(result)
    }

    pub async fn grant_can_update(&self, token: &str, conn_id: &str) -> Result<bool, String> {
        let (sql, _) =
            self.query_ph("SELECT can_update FROM grants WHERE token=? AND conn_id=?");
        let result = match &self.pool {
            StorePool::Sqlite(p) => sqlx::query(&sql)
                .bind(token)
                .bind(conn_id)
                .fetch_optional(p)
                .await
                .map_err(|e| e.to_string())?
                .map(|r| r.get::<i64, _>("can_update") != 0)
                .unwrap_or(false),
            StorePool::Postgres(p) => sqlx::query(&sql)
                .bind(token)
                .bind(conn_id)
                .fetch_optional(p)
                .await
                .map_err(|e| e.to_string())?
                .map(|r| r.get::<i64, _>("can_update") != 0)
                .unwrap_or(false),
        };
        Ok(result)
    }

    pub async fn grant_can_delete(&self, token: &str, conn_id: &str) -> Result<bool, String> {
        let (sql, _) =
            self.query_ph("SELECT can_delete FROM grants WHERE token=? AND conn_id=?");
        let result = match &self.pool {
            StorePool::Sqlite(p) => sqlx::query(&sql)
                .bind(token)
                .bind(conn_id)
                .fetch_optional(p)
                .await
                .map_err(|e| e.to_string())?
                .map(|r| r.get::<i64, _>("can_delete") != 0)
                .unwrap_or(false),
            StorePool::Postgres(p) => sqlx::query(&sql)
                .bind(token)
                .bind(conn_id)
                .fetch_optional(p)
                .await
                .map_err(|e| e.to_string())?
                .map(|r| r.get::<i64, _>("can_delete") != 0)
                .unwrap_or(false),
        };
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use crate::server::vault::ConnInput;

    #[tokio::test]
    async fn grant_lifecycle_and_checks() {
        let store = crate::server::store::test_store().await;
        let meta = store
            .conn_add(&ConnInput { name: "c".into(), host: "h".into(), port: 5432, user: "u".into(), password: Some("p".into()), database: "d".into(), ssl_mode: None }, "creator")
            .await
            .unwrap();
        // Mint a team token — grants are per-token now.
        let token = store
            .mint_team_token("phone-user", "acme", &[])
            .await
            .unwrap();
        let dev = token.clone();

        // Default: nothing granted.
        assert!(!store.grant_can_read(&dev, &meta.id).await.unwrap());
        assert!(!store.grant_can_update(&dev, &meta.id).await.unwrap());

        // Grant read + update; both dimensions are independent.
        store.grant_upsert(&dev, &meta.id, true, true, false).await.unwrap();
        assert!(store.grant_can_read(&dev, &meta.id).await.unwrap());
        assert!(store.grant_can_update(&dev, &meta.id).await.unwrap());
        assert_eq!(store.grants_for_conn(&meta.id).await.unwrap().len(), 1);

        // Escalate to include delete.
        store.grant_upsert(&dev, &meta.id, true, true, true).await.unwrap();
        assert!(store.grant_can_delete(&dev, &meta.id).await.unwrap());

        // Revoke removes everything.
        store.grant_revoke(&dev, &meta.id).await.unwrap();
        assert_eq!(store.grants_for_device(&dev).await.unwrap().len(), 0);
    }
}
