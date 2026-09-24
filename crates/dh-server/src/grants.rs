//! Per-connection grant override database work. The shared shapes
//! (`DataAccess`, `Grant`) live in `dh_server_client::grants` (spec 0012).

use crate::store::Store;
use dh_server_client::grants::Grant;
use sqlx::Row;

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
    /// role default" — see `gateway::Gateway::authorize`).
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
    use crate::store::{test_store, test_user};
    use dh_server_client::auth::ServerRole;
    use dh_server_client::vault::ConnInput;

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see store::test_store"]
    async fn grant_override_lifecycle() {
        let store = test_store().await;
        let owner = test_user(&store, "o@x.com", ServerRole::Owner).await;
        let org = store.org_create(&owner.ctx(), "Acme").await.unwrap();
        let member = test_user(&store, "m@x.com", ServerRole::Member).await;
        let invite =
            store.link_create(&owner.ctx(), &org.id, 100, 7).await.unwrap();
        store.link_redeem(&invite.code, &member.id).await.unwrap();

        let meta = store
            .conn_add(
                &org.id,
                &ConnInput {
                    name: "c".into(),
                    kind: dh_core::api::DbKind::Postgres,
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
                    pool_max: None,
                    pool_min: None,
                    connect_timeout_secs: None,
                    idle_timeout_secs: None,
                    max_lifetime_secs: None,
                    server_selection_timeout_secs: None,
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
