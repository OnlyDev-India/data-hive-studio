//! Who may create organizations (spec 0011): the per admin "can create
//! organizations" switch and the server wide open org creation policy. Both
//! are owner only, both write an audit row with no org, and both are read
//! fresh from the database on every call.

use crate::store::{audit_in, Store};
use dh_server_client::auth::{AccessError, AuthCtx, ServerRole};
use dh_server_client::orgs::ServerSettings;

/// See `claim.rs`'s `sqlx_err` for why `?` can no longer carry a
/// `sqlx::Error` straight into `AccessError` (spec 0012, AC-8).
fn sqlx_err(e: sqlx::Error) -> AccessError {
    AccessError::Other(e.to_string())
}

impl Store {
    /// Turn the can-create-orgs switch on or off for an admin. Owners only.
    /// It only exists on an admin (409 `not_an_admin` otherwise); turning it
    /// off never removes an org the person made.
    pub async fn create_orgs_set(&self, actor: &AuthCtx, target_id: &str, enabled: bool) -> Result<(), AccessError> {
        if !actor.is_owner() {
            return Err(AccessError::Forbidden);
        }
        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        let role: String = sqlx::query_scalar("SELECT server_role FROM users WHERE id=$1 FOR UPDATE")
            .bind(target_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(sqlx_err)?
            .ok_or(AccessError::NotFound)?;
        if ServerRole::parse(&role) != Some(ServerRole::Admin) {
            return Err(AccessError::NotAnAdmin);
        }
        sqlx::query("UPDATE users SET can_create_orgs=$1 WHERE id=$2")
            .bind(enabled)
            .bind(target_id)
            .execute(&mut *tx)
            .await
            .map_err(sqlx_err)?;
        let detail = if enabled { "enabled" } else { "disabled" };
        audit_in(&mut *tx, &actor.user_id, "server.create_orgs_changed", target_id, Some(detail))
            .await
            .map_err(sqlx_err)?;
        tx.commit().await.map_err(sqlx_err)?;
        Ok(())
    }

    /// The server wide settings the Server access page shows. Owner only.
    pub async fn server_settings_get(&self, actor: &AuthCtx) -> Result<ServerSettings, AccessError> {
        if !actor.is_owner() {
            return Err(AccessError::Forbidden);
        }
        Ok(ServerSettings { open_org_creation: self.open_org_creation().await.map_err(AccessError::Other)? })
    }

    /// The open policy, read fresh. Not owner gated: `may_create_org` needs it
    /// for every caller, and only the resolved answer reaches them.
    pub(crate) async fn open_org_creation(&self) -> Result<bool, String> {
        sqlx::query_scalar("SELECT open_org_creation FROM server_settings WHERE id=1")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| e.to_string())
    }

    /// Turn the open org creation policy on or off. Owners only. It changes
    /// nobody's stored switch and removes no org.
    pub async fn open_org_creation_set(&self, actor: &AuthCtx, enabled: bool) -> Result<(), AccessError> {
        if !actor.is_owner() {
            return Err(AccessError::Forbidden);
        }
        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        sqlx::query("UPDATE server_settings SET open_org_creation=$1 WHERE id=1")
            .bind(enabled)
            .execute(&mut *tx)
            .await
            .map_err(sqlx_err)?;
        let detail = if enabled { "enabled" } else { "disabled" };
        audit_in(&mut *tx, &actor.user_id, "server.open_org_creation_changed", "server", Some(detail))
            .await
            .map_err(sqlx_err)?;
        tx.commit().await.map_err(sqlx_err)?;
        Ok(())
    }
}
