//! Email invites into an org (spec 0011). They live in `server_invites` with
//! an `org_id` and `org_role`; the sign in join is in `auth/accounts.rs`. An
//! invite carries no secret: only the account whose email equals the invite
//! email can accept or decline it.

use crate::store::{audit_org_in, now_ms, Store};
use dh_server_client::auth::{invite_status, normalize_invite_email, AccessError, AuthCtx};
use dh_server_client::orgs::{OrgEmailInvite, OrgInviteWrite, OrgRole, Organization, PendingInvite};
use sqlx::Row;

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

const INVITE_SELECT: &str = "SELECT i.id, i.org_id, i.email, i.org_role, i.created_ms, i.expires_ms, i.used_ms,
        c.email AS created_by, u.email AS used_by
     FROM server_invites i
     JOIN users c ON c.id = i.created_by
     LEFT JOIN users u ON u.id = i.used_by";

fn sqlx_err(e: sqlx::Error) -> AccessError {
    AccessError::Other(e.to_string())
}

fn invite_from_row(r: &sqlx::postgres::PgRow, now: i64) -> OrgEmailInvite {
    let (used_ms, expires_ms): (Option<i64>, Option<i64>) = (r.get("used_ms"), r.get("expires_ms"));
    OrgEmailInvite {
        id: r.get("id"),
        org_id: r.get("org_id"),
        email: r.get("email"),
        role: OrgRole::parse(&r.get::<String, _>("org_role")).unwrap_or(OrgRole::Member),
        created_by: r.get("created_by"),
        created_ms: r.get("created_ms"),
        expires_ms,
        used_ms,
        used_by: r.get("used_by"),
        status: invite_status(used_ms, expires_ms, now),
    }
}

/// The caller's role in `org_id`, when it lets them manage invites. Owners
/// and admins only; a plain member or an outsider is refused.
async fn manager_role(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    org_id: &str,
    user_id: &str,
) -> Result<OrgRole, AccessError> {
    let role: Option<String> = sqlx::query_scalar("SELECT role FROM org_members WHERE org_id=$1 AND user_id=$2")
        .bind(org_id)
        .bind(user_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(sqlx_err)?;
    match role.as_deref().and_then(OrgRole::parse) {
        Some(r) if r.can_manage_members() => Ok(r),
        _ => Err(AccessError::Forbidden),
    }
}

async fn load_org(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    org_id: &str,
) -> Result<Organization, sqlx::Error> {
    let r = sqlx::query("SELECT id, name, slug, created_ms FROM organizations WHERE id=$1")
        .bind(org_id)
        .fetch_one(&mut **tx)
        .await?;
    Ok(Organization { id: r.get("id"), name: r.get("name"), slug: r.get("slug"), created_ms: r.get("created_ms") })
}

impl Store {
    /// Invite `email` into `org_id` with `role`. `expires_days` is 1, 7 or 30,
    /// or `None` for never. An email that already has an unused invite into
    /// this org gets that invite refreshed (new role, new expiry). An admin
    /// may invite as member or admin only.
    pub async fn org_invite_create(
        &self,
        actor: &AuthCtx,
        org_id: &str,
        email: &str,
        role: OrgRole,
        expires_days: Option<i64>,
    ) -> Result<OrgInviteWrite, AccessError> {
        let email = normalize_invite_email(email)?;
        if matches!(expires_days, Some(d) if ![1, 7, 30].contains(&d)) {
            return Err(AccessError::BadRequest("expires_days must be 1, 7, 30 or null".into()));
        }
        let now = now_ms();
        let expires_ms = expires_days.map(|d| now + d * DAY_MS);

        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        let caller = manager_role(&mut tx, org_id, &actor.user_id).await?;
        if role == OrgRole::Owner && caller != OrgRole::Owner {
            return Err(AccessError::Forbidden);
        }
        let member: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM org_members m JOIN users u ON u.id = m.user_id
                            WHERE m.org_id=$1 AND u.email=$2)",
        )
        .bind(org_id)
        .bind(&email)
        .fetch_one(&mut *tx)
        .await
        .map_err(sqlx_err)?;
        if member {
            return Err(AccessError::AlreadyMember);
        }
        // One atomic upsert on the one-open-invite-per-email-per-org index. The
        // WHERE keeps an admin from refreshing (and so re-roling) an owner invite.
        let row = sqlx::query(
            "INSERT INTO server_invites (id, email, created_by, created_ms, expires_ms, org_id, org_role)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (email, COALESCE(org_id, '')) WHERE used_ms IS NULL
             DO UPDATE SET expires_ms = EXCLUDED.expires_ms, org_role = EXCLUDED.org_role
                WHERE server_invites.org_role <> 'owner' OR $8
             RETURNING id, (xmax = 0) AS inserted",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&email)
        .bind(&actor.user_id)
        .bind(now)
        .bind(expires_ms)
        .bind(org_id)
        .bind(role.as_str())
        .bind(caller == OrgRole::Owner)
        .fetch_optional(&mut *tx)
        .await
        .map_err(sqlx_err)?
        .ok_or(AccessError::Forbidden)?;
        let (id, inserted): (String, bool) = (row.get("id"), row.get("inserted"));
        let action = if inserted { "org.invite_created" } else { "org.invite_refreshed" };
        audit_org_in(&mut *tx, Some(org_id), &actor.user_id, action, &email, None).await.map_err(sqlx_err)?;
        let invite = invite_from_row(
            &sqlx::query(&format!("{INVITE_SELECT} WHERE i.id=$1"))
                .bind(&id)
                .fetch_one(&mut *tx)
                .await
                .map_err(sqlx_err)?,
            now,
        );
        tx.commit().await.map_err(sqlx_err)?;
        Ok(if inserted { OrgInviteWrite::Created(invite) } else { OrgInviteWrite::Refreshed(invite) })
    }

    /// The org's email invites, newest first, with derived status.
    pub async fn org_invite_list(&self, actor: &AuthCtx, org_id: &str) -> Result<Vec<OrgEmailInvite>, AccessError> {
        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        manager_role(&mut tx, org_id, &actor.user_id).await?;
        let now = now_ms();
        let rows = sqlx::query(&format!("{INVITE_SELECT} WHERE i.org_id=$1 ORDER BY i.created_ms DESC, i.id"))
            .bind(org_id)
            .fetch_all(&mut *tx)
            .await
            .map_err(sqlx_err)?;
        Ok(rows.iter().map(|r| invite_from_row(r, now)).collect())
    }

    /// Delete an unused invite. A used invite is never changed or deleted, and
    /// an admin cannot revoke an invite that grants owner.
    pub async fn org_invite_revoke(&self, actor: &AuthCtx, org_id: &str, invite_id: &str) -> Result<(), AccessError> {
        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        let caller = manager_role(&mut tx, org_id, &actor.user_id).await?;
        let row = sqlx::query("SELECT email, org_role, used_ms FROM server_invites WHERE id=$1 AND org_id=$2 FOR UPDATE")
            .bind(invite_id)
            .bind(org_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(sqlx_err)?
            .ok_or(AccessError::NotFound)?;
        if row.get::<Option<i64>, _>("used_ms").is_some() {
            return Err(AccessError::AlreadyUsed);
        }
        if row.get::<String, _>("org_role") == "owner" && caller != OrgRole::Owner {
            return Err(AccessError::Forbidden);
        }
        let email: String = row.get("email");
        sqlx::query("DELETE FROM server_invites WHERE id=$1").bind(invite_id).execute(&mut *tx).await.map_err(sqlx_err)?;
        audit_org_in(&mut *tx, Some(org_id), &actor.user_id, "org.invite_revoked", &email, None)
            .await
            .map_err(sqlx_err)?;
        tx.commit().await.map_err(sqlx_err)?;
        Ok(())
    }

    /// The signed in person's pending invites: unused, unexpired, org invites
    /// for their account email.
    pub async fn invites_pending(&self, user_id: &str) -> Result<Vec<PendingInvite>, String> {
        let rows = sqlx::query(
            "SELECT i.id, i.org_id, i.org_role, i.expires_ms, o.name AS org_name,
                    c.name AS inviter_name, c.email AS inviter_email
             FROM server_invites i
             JOIN users me ON me.email = i.email
             JOIN organizations o ON o.id = i.org_id
             JOIN users c ON c.id = i.created_by
             WHERE me.id = $1 AND i.org_id IS NOT NULL AND i.used_ms IS NULL
               AND (i.expires_ms IS NULL OR i.expires_ms > $2)
             ORDER BY i.created_ms DESC, i.id",
        )
        .bind(user_id)
        .bind(now_ms())
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(rows
            .iter()
            .map(|r| PendingInvite {
                id: r.get("id"),
                org_id: r.get("org_id"),
                org_name: r.get("org_name"),
                role: OrgRole::parse(&r.get::<String, _>("org_role")).unwrap_or(OrgRole::Member),
                inviter_name: r.get("inviter_name"),
                inviter_email: r.get("inviter_email"),
                expires_ms: r.get("expires_ms"),
            })
            .collect())
    }

    /// Lock an org invite that names the caller's email. Anything else (no
    /// such id, a plain server invite, someone else's) is the same `NotFound`,
    /// so an id reveals nothing to the wrong person.
    async fn lock_my_invite(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        user_id: &str,
        invite_id: &str,
    ) -> Result<sqlx::postgres::PgRow, AccessError> {
        sqlx::query(
            "SELECT i.org_id, i.org_role, i.email, i.expires_ms, i.used_ms, i.used_by
             FROM server_invites i JOIN users me ON me.email = i.email
             WHERE i.id=$1 AND me.id=$2 AND i.org_id IS NOT NULL FOR UPDATE OF i",
        )
        .bind(invite_id)
        .bind(user_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(sqlx_err)?
        .ok_or(AccessError::NotFound)
    }

    /// Accept an invite: join the org with the invite's role and mark it used.
    /// Safe to retry. A person already in the org some other way keeps their
    /// role; the invite is only marked used.
    pub async fn invite_accept(&self, user_id: &str, invite_id: &str) -> Result<Organization, AccessError> {
        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        let inv = Self::lock_my_invite(&mut tx, user_id, invite_id).await?;
        let org_id: String = inv.get("org_id");
        if inv.get::<Option<i64>, _>("used_ms").is_some() {
            // Used by this person already: hand the org back if they are still
            // in it (a retry), else there is nothing to return.
            let used_by: Option<String> = inv.get("used_by");
            let still_in: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM org_members WHERE org_id=$1 AND user_id=$2)")
                .bind(&org_id)
                .bind(user_id)
                .fetch_one(&mut *tx)
                .await
                .map_err(sqlx_err)?;
            if used_by.as_deref() == Some(user_id) && still_in {
                return load_org(&mut tx, &org_id).await.map_err(sqlx_err);
            }
            return Err(AccessError::AlreadyUsed);
        }
        let now = now_ms();
        if inv.get::<Option<i64>, _>("expires_ms").is_some_and(|t| t <= now) {
            return Err(AccessError::InviteExpired);
        }
        let role: String = inv.get("org_role");
        sqlx::query(
            "INSERT INTO org_members (org_id, user_id, role, joined_ms) VALUES ($1,$2,$3,$4)
             ON CONFLICT (org_id, user_id) DO NOTHING",
        )
        .bind(&org_id)
        .bind(user_id)
        .bind(&role)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(sqlx_err)?;
        sqlx::query("UPDATE server_invites SET used_ms=$1, used_by=$2 WHERE id=$3")
            .bind(now)
            .bind(user_id)
            .bind(invite_id)
            .execute(&mut *tx)
            .await
            .map_err(sqlx_err)?;
        let email: String = inv.get("email");
        audit_org_in(&mut *tx, Some(&org_id), user_id, "org.invite_accepted", &email, None).await.map_err(sqlx_err)?;
        let org = load_org(&mut tx, &org_id).await.map_err(sqlx_err)?;
        tx.commit().await.map_err(sqlx_err)?;
        Ok(org)
    }

    /// Decline an invite: it is deleted, so the inviter can invite again.
    pub async fn invite_decline(&self, user_id: &str, invite_id: &str) -> Result<(), AccessError> {
        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        let inv = Self::lock_my_invite(&mut tx, user_id, invite_id).await?;
        if inv.get::<Option<i64>, _>("used_ms").is_some() {
            return Err(AccessError::AlreadyUsed);
        }
        let (org_id, email): (String, String) = (inv.get("org_id"), inv.get("email"));
        sqlx::query("DELETE FROM server_invites WHERE id=$1").bind(invite_id).execute(&mut *tx).await.map_err(sqlx_err)?;
        audit_org_in(&mut *tx, Some(&org_id), user_id, "org.invite_declined", &email, None).await.map_err(sqlx_err)?;
        tx.commit().await.map_err(sqlx_err)?;
        Ok(())
    }
}
