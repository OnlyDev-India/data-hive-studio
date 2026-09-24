//! Server roles (spec 0010): who is an owner, an admin or a member, and the
//! "can manage roles" switch that lets an admin help. The pure permission
//! check (`check_role_change`) lives in `dh_server_client::auth`.
//!
//! - An owner may make any change and flip the switch.
//! - An admin whose switch is on may list accounts and move people between
//!   member and admin only: never touching an owner, never the switch.
//! - Everyone else is refused.
//! - The server always keeps at least one owner, checked inside the
//!   transaction with the owner rows locked.

use crate::store::{audit_in, Store};
use dh_server_client::auth::{check_role_change, Account, AccessError, AuthCtx, ServerRole};
use sqlx::Row;

/// See `claim.rs`'s `sqlx_err` for why `?` can no longer carry a
/// `sqlx::Error` straight into `AccessError` (spec 0012, AC-8).
fn sqlx_err(e: sqlx::Error) -> AccessError {
    AccessError::Other(e.to_string())
}

impl Store {
    /// Every account, oldest first. Owners, and admins with the switch on.
    pub async fn accounts_list(&self, actor: &AuthCtx) -> Result<Vec<Account>, AccessError> {
        if !actor.can_manage_accounts() {
            return Err(AccessError::Forbidden);
        }
        let rows = sqlx::query(
            "SELECT u.id, u.email, u.name, u.avatar_url, u.server_role, u.can_manage_roles, u.can_create_orgs, u.created_ms,
                    COALESCE(array_agg(i.provider ORDER BY i.provider) FILTER (WHERE i.provider IS NOT NULL), '{}')
                        AS providers
             FROM users u LEFT JOIN identities i ON i.user_id = u.id
             GROUP BY u.id ORDER BY u.created_ms, u.id",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(sqlx_err)?;
        Ok(rows
            .iter()
            .map(|r| {
                let role: String = r.get("server_role");
                Account {
                    id: r.get("id"),
                    email: r.get("email"),
                    name: r.get("name"),
                    avatar_url: r.get("avatar_url"),
                    server_role: ServerRole::parse(&role).unwrap_or(ServerRole::Member),
                    can_manage_roles: r.get("can_manage_roles"),
                    can_create_orgs: r.get("can_create_orgs"),
                    providers: r.get("providers"),
                    created_ms: r.get("created_ms"),
                }
            })
            .collect())
    }

    /// Change one account's server role. The switch is cleared in the same
    /// update that makes someone a member or an owner, so it exists only on
    /// an admin.
    pub async fn role_set(&self, actor: &AuthCtx, target_id: &str, new: ServerRole) -> Result<(), AccessError> {
        // Cheap refusal before touching the database.
        if !actor.can_manage_accounts() {
            return Err(AccessError::Forbidden);
        }
        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        // Lock every owner row and the target in one ordered statement, so two
        // simultaneous changes cannot both demote the last two owners.
        let rows = sqlx::query(
            "SELECT id, server_role FROM users WHERE server_role = 'owner' OR id = $1 ORDER BY id FOR UPDATE",
        )
        .bind(target_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(sqlx_err)?;
        let role_of = |r: &sqlx::postgres::PgRow| {
            let s: String = r.get("server_role");
            ServerRole::parse(&s).unwrap_or(ServerRole::Member)
        };
        let current = rows
            .iter()
            .find(|r| r.get::<String, _>("id") == target_id)
            .map(role_of)
            .ok_or(AccessError::NotFound)?;
        check_role_change(actor, current, new)?;
        if current == new {
            return Ok(());
        }
        let owners = rows.iter().filter(|r| role_of(r) == ServerRole::Owner).count();
        if current == ServerRole::Owner && owners <= 1 {
            return Err(AccessError::LastOwner);
        }
        sqlx::query(
            "UPDATE users SET server_role = $1,
                    can_manage_roles = CASE WHEN $1 = 'admin' THEN can_manage_roles ELSE FALSE END,
                    can_create_orgs = CASE WHEN $1 = 'admin' THEN can_create_orgs ELSE FALSE END
             WHERE id = $2",
        )
        .bind(new.as_str())
        .bind(target_id)
        .execute(&mut *tx)
        .await
        .map_err(sqlx_err)?;
        let detail = format!("{}->{}", current.as_str(), new.as_str());
        audit_in(&mut *tx, &actor.user_id, "server.role_changed", target_id, Some(&detail)).await.map_err(sqlx_err)?;
        tx.commit().await.map_err(sqlx_err)?;
        Ok(())
    }

    /// Turn the can-manage-roles switch on or off for an admin. Owners only.
    pub async fn manage_roles_set(&self, actor: &AuthCtx, target_id: &str, enabled: bool) -> Result<(), AccessError> {
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
        sqlx::query("UPDATE users SET can_manage_roles=$1 WHERE id=$2")
            .bind(enabled)
            .bind(target_id)
            .execute(&mut *tx)
            .await
            .map_err(sqlx_err)?;
        let detail = if enabled { "enabled" } else { "disabled" };
        audit_in(&mut *tx, &actor.user_id, "server.manage_roles_changed", target_id, Some(detail)).await.map_err(sqlx_err)?;
        tx.commit().await.map_err(sqlx_err)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{test_store, test_user};

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see store::test_store"]
    async fn last_owner_is_kept_and_a_second_owner_can_be_demoted() {
        let store = test_store().await;
        let owner = test_user(&store, "o1@x.com", ServerRole::Owner).await;
        let ctx = owner.ctx();
        assert_eq!(store.role_set(&ctx, &owner.id, ServerRole::Member).await, Err(AccessError::LastOwner));

        let second = test_user(&store, "o2@x.com", ServerRole::Member).await;
        store.role_set(&ctx, &second.id, ServerRole::Owner).await.unwrap();
        store.role_set(&ctx, &second.id, ServerRole::Member).await.unwrap();
        assert_eq!(store.role_set(&ctx, "missing", ServerRole::Admin).await, Err(AccessError::NotFound));

        let audit: Vec<Option<String>> =
            sqlx::query_scalar("SELECT detail FROM audit WHERE action='server.role_changed' ORDER BY id")
                .fetch_all(&store.pool)
                .await
                .unwrap();
        assert_eq!(audit, [Some("member->owner".into()), Some("owner->member".into())]);
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see store::test_store"]
    async fn two_owners_demoting_each_other_at_once_leave_one() {
        let store = test_store().await;
        let a = test_user(&store, "a@x.com", ServerRole::Owner).await;
        let b = test_user(&store, "b@x.com", ServerRole::Owner).await;
        let (ctx_a, ctx_b) = (a.ctx(), b.ctx());
        let (ra, rb) = tokio::join!(
            store.role_set(&ctx_a, &b.id, ServerRole::Member),
            store.role_set(&ctx_b, &a.id, ServerRole::Member),
        );
        assert_eq!([ra.is_ok(), rb.is_ok()].iter().filter(|x| **x).count(), 1);
        let owners: i64 = sqlx::query_scalar("SELECT count(*) FROM users WHERE server_role='owner'")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(owners, 1);
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see store::test_store"]
    async fn switch_lives_only_on_an_admin_and_gates_the_helper() {
        let store = test_store().await;
        let owner = test_user(&store, "o@x.com", ServerRole::Owner).await.ctx();
        let admin = test_user(&store, "a@x.com", ServerRole::Admin).await;
        let member = test_user(&store, "m@x.com", ServerRole::Member).await;

        // Off by default: an admin cannot list accounts.
        assert_eq!(store.accounts_list(&admin.ctx()).await.unwrap_err(), AccessError::Forbidden);
        assert_eq!(store.manage_roles_set(&owner, &member.id, true).await, Err(AccessError::NotAnAdmin));

        store.manage_roles_set(&owner, &admin.id, true).await.unwrap();
        let helper = store.user_get(&admin.id).await.unwrap().unwrap().ctx();
        assert!(helper.can_manage_roles);
        let list = store.accounts_list(&helper).await.unwrap();
        assert_eq!(list.len(), 3);
        assert!(list.iter().all(|a| a.providers == ["google"]));

        // The helper moves members and admins, never an owner, never the switch.
        store.role_set(&helper, &member.id, ServerRole::Admin).await.unwrap();
        assert_eq!(store.role_set(&helper, &owner.user_id, ServerRole::Member).await, Err(AccessError::Forbidden));
        assert_eq!(store.role_set(&helper, &member.id, ServerRole::Owner).await, Err(AccessError::Forbidden));
        assert_eq!(store.manage_roles_set(&helper, &member.id, true).await, Err(AccessError::Forbidden));

        // Demoting the helper clears the switch in the same update.
        store.role_set(&owner, &admin.id, ServerRole::Member).await.unwrap();
        assert!(!store.user_get(&admin.id).await.unwrap().unwrap().can_manage_roles);
        // The database check refuses a switch on anyone who is not an admin.
        let bad = sqlx::query("UPDATE users SET can_manage_roles=TRUE WHERE id=$1").bind(&admin.id).execute(&store.pool).await;
        assert!(bad.is_err());

        // A member is refused everything.
        assert_eq!(store.accounts_list(&member.ctx()).await.unwrap_err(), AccessError::Forbidden);
        assert_eq!(store.role_set(&member.ctx(), &admin.id, ServerRole::Admin).await, Err(AccessError::Forbidden));
    }
}
