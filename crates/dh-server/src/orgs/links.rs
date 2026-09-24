//! Shareable links (spec 0011). A link always grants `member`, has a use
//! limit of 1 to 100 and an expiry of 1, 7 or 30 days, and only adds people
//! who already have an account. The code is a secret: it is never written to
//! an audit row or a log line, and every way a redeem can fail answers the
//! same.

use super::ERR_INVITE_INVALID;
use crate::store::{audit_org_in, now_ms, Store};
use dh_server_client::auth::{AccessError, AuthCtx};
use dh_server_client::orgs::{OrgLink, OrgRole, Organization};
use sqlx::Row;

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

fn sqlx_err(e: sqlx::Error) -> AccessError {
    AccessError::Other(e.to_string())
}

fn link_from_row(r: &sqlx::postgres::PgRow) -> OrgLink {
    OrgLink {
        code: r.get("code"),
        org_id: r.get("org_id"),
        role: OrgRole::Member,
        created_by: r.get("created_by"),
        max_uses: r.get("max_uses"),
        uses_count: r.get("uses_count"),
        expires_ms: r.get("expires_ms"),
        created_ms: r.get("created_ms"),
    }
}

/// Owners and admins manage links; anyone else is refused.
async fn require_manager(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    org_id: &str,
    user_id: &str,
) -> Result<(), AccessError> {
    let role: Option<String> = sqlx::query_scalar("SELECT role FROM org_members WHERE org_id=$1 AND user_id=$2")
        .bind(org_id)
        .bind(user_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(sqlx_err)?;
    match role.as_deref().and_then(OrgRole::parse) {
        Some(r) if r.can_manage_members() => Ok(()),
        _ => Err(AccessError::Forbidden),
    }
}

impl Store {
    /// Mint a link into `org_id`. `max_uses` is 1 to 100 and `expires_days`
    /// is 1, 7 or 30. The role is always `member`.
    pub async fn link_create(
        &self,
        actor: &AuthCtx,
        org_id: &str,
        max_uses: i32,
        expires_days: i64,
    ) -> Result<OrgLink, AccessError> {
        if !(1..=100).contains(&max_uses) {
            return Err(AccessError::BadRequest("max_uses must be 1 to 100".into()));
        }
        if ![1, 7, 30].contains(&expires_days) {
            return Err(AccessError::BadRequest("expires_days must be 1, 7 or 30".into()));
        }
        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        require_manager(&mut tx, org_id, &actor.user_id).await?;
        let code = hex::encode(rand::random::<[u8; 12]>());
        let ts = now_ms();
        let row = sqlx::query(
            "INSERT INTO org_invites (code, org_id, role, created_by, max_uses, uses_count, expires_ms, created_ms)
             VALUES ($1,$2,'member',$3,$4,0,$5,$6)
             RETURNING code, org_id, created_by, max_uses, uses_count, expires_ms, created_ms",
        )
        .bind(&code)
        .bind(org_id)
        .bind(&actor.user_id)
        .bind(max_uses)
        .bind(ts + expires_days * DAY_MS)
        .bind(ts)
        .fetch_one(&mut *tx)
        .await
        .map_err(sqlx_err)?;
        // The target is the org, never the code.
        audit_org_in(&mut *tx, Some(org_id), &actor.user_id, "org.link_created", org_id, None)
            .await
            .map_err(sqlx_err)?;
        tx.commit().await.map_err(sqlx_err)?;
        Ok(link_from_row(&row))
    }

    /// The org's links, newest first, with their codes (owners and admins).
    pub async fn links_for_org(&self, actor: &AuthCtx, org_id: &str) -> Result<Vec<OrgLink>, AccessError> {
        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        require_manager(&mut tx, org_id, &actor.user_id).await?;
        let rows = sqlx::query(
            "SELECT code, org_id, created_by, max_uses, uses_count, expires_ms, created_ms
             FROM org_invites WHERE org_id=$1 ORDER BY created_ms DESC, code",
        )
        .bind(org_id)
        .fetch_all(&mut *tx)
        .await
        .map_err(sqlx_err)?;
        Ok(rows.iter().map(link_from_row).collect())
    }

    pub async fn link_revoke(&self, actor: &AuthCtx, org_id: &str, code: &str) -> Result<(), AccessError> {
        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        require_manager(&mut tx, org_id, &actor.user_id).await?;
        let n = sqlx::query("DELETE FROM org_invites WHERE org_id=$1 AND code=$2")
            .bind(org_id)
            .bind(code)
            .execute(&mut *tx)
            .await
            .map_err(sqlx_err)?
            .rows_affected();
        if n == 0 {
            return Err(AccessError::NotFound);
        }
        audit_org_in(&mut *tx, Some(org_id), &actor.user_id, "org.link_revoked", org_id, None)
            .await
            .map_err(sqlx_err)?;
        tx.commit().await.map_err(sqlx_err)?;
        Ok(())
    }

    /// Redeem a link for `user_id`: they join as `member`. A wrong, revoked,
    /// expired or used up code is one and the same [`ERR_INVITE_INVALID`]. A
    /// person already in the org gets the org back, spends no use and keeps
    /// their role. The use count and the membership change in one
    /// transaction with the link row locked, so simultaneous redemptions
    /// never pass the limit.
    pub async fn link_redeem(&self, code: &str, user_id: &str) -> Result<Organization, String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let link = sqlx::query("SELECT org_id, max_uses, uses_count, expires_ms FROM org_invites WHERE code=$1 FOR UPDATE")
            .bind(code)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?
            .ok_or(ERR_INVITE_INVALID)?;
        let (org_id, max_uses, uses_count, expires_ms): (String, i32, i32, i64) =
            (link.get("org_id"), link.get("max_uses"), link.get("uses_count"), link.get("expires_ms"));
        let member: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM org_members WHERE org_id=$1 AND user_id=$2)")
            .bind(&org_id)
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        // Already in: nothing to spend, nothing to change. A dead link still
        // answers like a wrong code (checked next), so this only ever hands
        // back an org the person is already inside.
        let live = expires_ms > now_ms() && uses_count < max_uses;
        if !live {
            return Err(ERR_INVITE_INVALID.into());
        }
        if !member {
            sqlx::query("UPDATE org_invites SET uses_count = uses_count + 1 WHERE code=$1")
                .bind(code)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            sqlx::query("INSERT INTO org_members (org_id, user_id, role, joined_ms) VALUES ($1,$2,'member',$3)")
                .bind(&org_id)
                .bind(user_id)
                .bind(now_ms())
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
            audit_org_in(&mut *tx, Some(&org_id), user_id, "org.link_redeemed", &org_id, None)
                .await
                .map_err(|e| e.to_string())?;
        }
        let org = sqlx::query("SELECT id, name, slug, created_ms FROM organizations WHERE id=$1")
            .bind(&org_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(Organization {
            id: org.get("id"),
            name: org.get("name"),
            slug: org.get("slug"),
            created_ms: org.get("created_ms"),
        })
    }
}
