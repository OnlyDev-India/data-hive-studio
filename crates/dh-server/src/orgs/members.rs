//! Membership changes (spec 0011). Every change is one transaction that
//! first locks the org's owner rows, so two requests that would each leave
//! the org with no owner cannot both succeed: one wins, the other gets
//! `last_owner`.
//!
//! | Caller    | May set or remove                                               |
//! |-----------|-----------------------------------------------------------------|
//! | owner     | any role, any person, except leaving the org with no owner       |
//! | admin     | member or admin roles only, never an owner; may remove those     |
//! | member    | nothing, except removing themselves (leave)                      |

use crate::store::{audit_org_in, Store};
use dh_server_client::auth::{AccessError, AuthCtx};
use dh_server_client::orgs::OrgRole;
use sqlx::Row;

fn sqlx_err(e: sqlx::Error) -> AccessError {
    AccessError::Other(e.to_string())
}

/// The roles both sides hold, read under the owner lock.
struct Roles {
    caller: OrgRole,
    target: OrgRole,
    target_email: String,
    owners: i64,
}

/// Lock the org's owner rows, then read the caller's and target's roles and
/// the owner count. The caller must be in the org (else 403); the target must
/// be too (else 404).
async fn lock_roles(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    org_id: &str,
    caller_id: &str,
    target_id: &str,
) -> Result<Roles, AccessError> {
    let owner_rows = sqlx::query("SELECT user_id FROM org_members WHERE org_id=$1 AND role='owner' FOR UPDATE")
        .bind(org_id)
        .fetch_all(&mut **tx)
        .await
        .map_err(sqlx_err)?;
    let role_of = |id: &str| {
        sqlx::query("SELECT m.role, u.email FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id=$1 AND m.user_id=$2")
            .bind(org_id)
            .bind(id.to_string())
    };
    let caller = role_of(caller_id).fetch_optional(&mut **tx).await.map_err(sqlx_err)?.ok_or(AccessError::Forbidden)?;
    let target = role_of(target_id).fetch_optional(&mut **tx).await.map_err(sqlx_err)?.ok_or(AccessError::NotFound)?;
    let parse = |r: &sqlx::postgres::PgRow| OrgRole::parse(&r.get::<String, _>("role")).unwrap_or(OrgRole::Member);
    Ok(Roles { caller: parse(&caller), target: parse(&target), target_email: target.get("email"), owners: owner_rows.len() as i64 })
}

impl Store {
    /// Change a member's role. The caller table is in the module docs; the
    /// last owner can never be demoted.
    pub async fn org_member_set_role(
        &self,
        actor: &AuthCtx,
        org_id: &str,
        target_id: &str,
        role: OrgRole,
    ) -> Result<(), AccessError> {
        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        let r = lock_roles(&mut tx, org_id, &actor.user_id, target_id).await?;
        let allowed = match r.caller {
            OrgRole::Owner => true,
            // An admin moves people between member and admin, never touches an
            // owner and never makes one (themselves included).
            OrgRole::Admin => r.target != OrgRole::Owner && role != OrgRole::Owner,
            OrgRole::Member => false,
        };
        if !allowed {
            return Err(AccessError::Forbidden);
        }
        if r.target == role {
            return Ok(());
        }
        if r.target == OrgRole::Owner && r.owners <= 1 {
            return Err(AccessError::LastOwner);
        }
        sqlx::query("UPDATE org_members SET role=$1 WHERE org_id=$2 AND user_id=$3")
            .bind(role.as_str())
            .bind(org_id)
            .bind(target_id)
            .execute(&mut *tx)
            .await
            .map_err(sqlx_err)?;
        let detail = format!("{} to {}", r.target.as_str(), role.as_str());
        audit_org_in(&mut *tx, Some(org_id), &actor.user_id, "org.member_role_changed", &r.target_email, Some(&detail))
            .await
            .map_err(sqlx_err)?;
        tx.commit().await.map_err(sqlx_err)?;
        Ok(())
    }

    /// Remove a member, or let someone leave (`target_id` is the caller).
    /// Their next request for any connection in the org is refused, because
    /// access is read from `org_members` on every request. Their grants on the
    /// org's connections and their unused invites into the org go with them,
    /// so being added again later starts clean.
    pub async fn org_member_remove(&self, actor: &AuthCtx, org_id: &str, target_id: &str) -> Result<(), AccessError> {
        let leaving = actor.user_id == target_id;
        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        let r = lock_roles(&mut tx, org_id, &actor.user_id, target_id).await?;
        let allowed = leaving
            || match r.caller {
                OrgRole::Owner => true,
                OrgRole::Admin => r.target != OrgRole::Owner,
                OrgRole::Member => false,
            };
        if !allowed {
            return Err(AccessError::Forbidden);
        }
        if r.target == OrgRole::Owner && r.owners <= 1 {
            return Err(AccessError::LastOwner);
        }
        sqlx::query("DELETE FROM org_members WHERE org_id=$1 AND user_id=$2")
            .bind(org_id)
            .bind(target_id)
            .execute(&mut *tx)
            .await
            .map_err(sqlx_err)?;
        sqlx::query(
            "DELETE FROM connection_grants g USING connections c
             WHERE g.conn_id = c.id AND c.org_id = $1 AND g.user_id = $2",
        )
        .bind(org_id)
        .bind(target_id)
        .execute(&mut *tx)
        .await
        .map_err(sqlx_err)?;
        sqlx::query("DELETE FROM server_invites WHERE org_id=$1 AND created_by=$2 AND used_ms IS NULL")
            .bind(org_id)
            .bind(target_id)
            .execute(&mut *tx)
            .await
            .map_err(sqlx_err)?;
        let action = if leaving { "org.member_left" } else { "org.member_removed" };
        audit_org_in(&mut *tx, Some(org_id), &actor.user_id, action, &r.target_email, None)
            .await
            .map_err(sqlx_err)?;
        tx.commit().await.map_err(sqlx_err)?;
        Ok(())
    }
}
