//! Per-connection grant OVERRIDES: `(connection, user)` → three booleans
//! (`can_read`/`can_update`/`can_delete`). Unlike the old per-token grant
//! table, this is no longer the ONLY access-control mechanism — it's an
//! exception list layered on top of the caller's `OrgRole` default (see
//! `orgs.rs::OrgRole::default_access` and `gateway.rs::Gateway::authorize`).
//! A row here means "this specific user's access to this specific
//! connection is different from what their org role would normally give
//! them" — restrict a member, or grant a viewer extra access to one
//! connection.

use super::store::Store;
use sqlx::Row;

/// Effective data-access level derived from a caller's resolved grant
/// (role default merged with any override). Returned by
/// `Gateway::authorize()` so callers know what they can do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DataAccess {
    Readonly,
    Readwrite,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Grant {
    pub conn_id: String,
    pub user_id: String,
    pub can_read: bool,
    pub can_update: bool,
    pub can_delete: bool,
}

pub const ERR_NO_GRANT: &str = "no access to this connection";

fn parse_grant_row(r: &sqlx::postgres::PgRow) -> Grant {
    Grant {
        conn_id: r.get("conn_id"),
        user_id: r.get("user_id"),
        // INTEGER (32-bit) columns — sqlx maps that to i32, not i64.
        can_read: r.get::<i32, _>("can_read") != 0,
        can_update: r.get::<i32, _>("can_update") != 0,
        can_delete: r.get::<i32, _>("can_delete") != 0,
    }
}

impl Store {
    pub async fn grant_upsert(
        &self,
        conn_id: &str,
        user_id: &str,
        can_read: bool,
        can_update: bool,
        can_delete: bool,
    ) -> Result<(), String> {
        sqlx::query(
            r#"INSERT INTO connection_grants (conn_id, user_id, can_read, can_update, can_delete)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (conn_id, user_id)
               DO UPDATE SET can_read=excluded.can_read,
                             can_update=excluded.can_update,
                             can_delete=excluded.can_delete"#,
        )
        .bind(conn_id)
        .bind(user_id)
        .bind(can_read as i64)
        .bind(can_update as i64)
        .bind(can_delete as i64)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn grant_revoke(&self, conn_id: &str, user_id: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM connection_grants WHERE conn_id=$1 AND user_id=$2")
            .bind(conn_id)
            .bind(user_id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// All grant overrides for one connection (admin views / revoke cascades).
    pub async fn grants_for_conn(&self, conn_id: &str) -> Result<Vec<Grant>, String> {
        let rows = sqlx::query("SELECT * FROM connection_grants WHERE conn_id=$1")
            .bind(conn_id)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(rows.iter().map(parse_grant_row).collect())
    }

    /// One user's override for one connection, if any (`None` = "use the
    /// role default" — see `gateway.rs::Gateway::authorize`).
    pub async fn grant_for_user(&self, conn_id: &str, user_id: &str) -> Result<Option<Grant>, String> {
        let row = sqlx::query("SELECT * FROM connection_grants WHERE conn_id=$1 AND user_id=$2")
            .bind(conn_id)
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(row.as_ref().map(parse_grant_row))
    }
}

#[cfg(test)]
mod tests {
    use crate::server::orgs::OrgRole;
    use crate::server::vault::ConnInput;

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn grant_override_lifecycle() {
        let store = crate::server::store::test_store().await;
        let owner = store.user_upsert_oauth("google", "o", "o@x.com", "Owner", None).await.unwrap();
        let org = store.org_create("Acme", &owner.id).await.unwrap();
        let member = store.user_upsert_oauth("google", "m", "m@x.com", "Member", None).await.unwrap();
        let invite = store.invite_create(&org.id, OrgRole::Member, &owner.id, None, None).await.unwrap();
        store.invite_redeem(&invite.code, &member.id).await.unwrap();

        let meta = store
            .conn_add(
                &org.id,
                &ConnInput {
                    name: "c".into(),
                    kind: crate::api::DbKind::Postgres,
                    host: "h".into(),
                    port: 5432,
                    user: "u".into(),
                    password: Some("p".into()),
                    database: "d".into(),
                    ssl_mode: None,
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
                },
                &owner.id,
            )
            .await
            .unwrap();

        // No override yet.
        assert!(store.grant_for_user(&meta.id, &member.id).await.unwrap().is_none());

        // Restrict the member to read-only on this one connection.
        store.grant_upsert(&meta.id, &member.id, true, false, false).await.unwrap();
        let g = store.grant_for_user(&meta.id, &member.id).await.unwrap().unwrap();
        assert!(g.can_read && !g.can_update && !g.can_delete);
        assert_eq!(store.grants_for_conn(&meta.id).await.unwrap().len(), 1);

        store.grant_revoke(&meta.id, &member.id).await.unwrap();
        assert!(store.grant_for_user(&meta.id, &member.id).await.unwrap().is_none());
    }
}
