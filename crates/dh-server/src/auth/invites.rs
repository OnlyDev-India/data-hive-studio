//! Server invites (spec 0010): an owner or admin invites an email, and the
//! person gets a `member` account on their first sign in with that verified
//! email (the join itself lives in `accounts.rs`). One open invite per email.
//! The pure shapes (`Invite`, `InviteStatus`, ...) live in
//! `dh_server_client::auth`.

use crate::store::{audit_in, now_ms, Store};
use dh_server_client::auth::{invite_status, normalize_invite_email, AccessError, AuthCtx, Invite, InviteWrite};
use sqlx::Row;

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

const INVITE_SELECT: &str = "SELECT i.id, i.email, i.created_ms, i.expires_ms, i.used_ms,
        c.email AS created_by, u.email AS used_by
     FROM server_invites i
     JOIN users c ON c.id = i.created_by
     LEFT JOIN users u ON u.id = i.used_by";

fn invite_from_row(r: &sqlx::postgres::PgRow, now: i64) -> Invite {
    let (used_ms, expires_ms): (Option<i64>, Option<i64>) = (r.get("used_ms"), r.get("expires_ms"));
    Invite {
        id: r.get("id"),
        email: r.get("email"),
        created_by: r.get("created_by"),
        created_ms: r.get("created_ms"),
        expires_ms,
        used_ms,
        used_by: r.get("used_by"),
        status: invite_status(used_ms, expires_ms, now),
    }
}

/// `AccessError` lives in `dh-server-client`, which never depends on `sqlx`
/// (spec 0012, AC-8) — see `claim.rs`'s `sqlx_err` for why the `?` operator
/// can no longer carry a `sqlx::Error` straight into it.
fn sqlx_err(e: sqlx::Error) -> AccessError {
    AccessError::Other(e.to_string())
}

impl Store {
    /// Invite `email`. `expires_days` is 1, 7 or 30, or `None` for never.
    /// Refused for an email that already has an account; an email with an
    /// open (or expired) invite gets that invite refreshed instead.
    pub async fn server_invite_create(
        &self,
        actor: &AuthCtx,
        email: &str,
        expires_days: Option<i64>,
    ) -> Result<InviteWrite, AccessError> {
        if !actor.can_invite() {
            return Err(AccessError::Forbidden);
        }
        let email = normalize_invite_email(email)?;
        if matches!(expires_days, Some(d) if ![1, 7, 30].contains(&d)) {
            return Err(AccessError::BadRequest("expires_days must be 1, 7, 30 or null".into()));
        }
        let now = now_ms();
        let expires_ms = expires_days.map(|d| now + d * DAY_MS);

        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        let has_account: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM users WHERE email=$1)")
            .bind(&email)
            .fetch_one(&mut *tx)
            .await
            .map_err(sqlx_err)?;
        if has_account {
            return Err(AccessError::AlreadyHasAccount);
        }
        // One atomic upsert on the one-open-invite-per-email index: a second
        // simultaneous create refreshes instead of failing.
        let row = sqlx::query(
            "INSERT INTO server_invites (id, email, created_by, created_ms, expires_ms)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (email, COALESCE(org_id, '')) WHERE used_ms IS NULL DO UPDATE SET expires_ms = EXCLUDED.expires_ms
             RETURNING id, (xmax = 0) AS inserted",
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(&email)
        .bind(&actor.user_id)
        .bind(now)
        .bind(expires_ms)
        .fetch_one(&mut *tx)
        .await
        .map_err(sqlx_err)?;
        let (id, inserted): (String, bool) = (row.get("id"), row.get("inserted"));
        let action = if inserted { "server.invite_created" } else { "server.invite_refreshed" };
        audit_in(&mut *tx, &actor.user_id, action, &email, None).await.map_err(sqlx_err)?;
        let invite = invite_from_row(
            &sqlx::query(&format!("{INVITE_SELECT} WHERE i.id=$1"))
                .bind(&id)
                .fetch_one(&mut *tx)
                .await
                .map_err(sqlx_err)?,
            now,
        );
        tx.commit().await.map_err(sqlx_err)?;
        Ok(if inserted { InviteWrite::Created(invite) } else { InviteWrite::Refreshed(invite) })
    }

    /// Every invite, newest first, with its derived status.
    pub async fn server_invite_list(&self, actor: &AuthCtx) -> Result<Vec<Invite>, AccessError> {
        if !actor.can_invite() {
            return Err(AccessError::Forbidden);
        }
        let now = now_ms();
        let rows = sqlx::query(&format!("{INVITE_SELECT} WHERE i.org_id IS NULL ORDER BY i.created_ms DESC, i.id"))
            .fetch_all(&self.pool)
            .await
            .map_err(sqlx_err)?;
        Ok(rows.iter().map(|r| invite_from_row(r, now)).collect())
    }

    /// Delete an unused invite. A used invite is never changed or deleted.
    pub async fn server_invite_revoke(&self, actor: &AuthCtx, invite_id: &str) -> Result<(), AccessError> {
        if !actor.can_invite() {
            return Err(AccessError::Forbidden);
        }
        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        let row = sqlx::query("SELECT email, used_ms FROM server_invites WHERE id=$1 AND org_id IS NULL FOR UPDATE")
            .bind(invite_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(sqlx_err)?
            .ok_or(AccessError::NotFound)?;
        let used_ms: Option<i64> = row.get("used_ms");
        if used_ms.is_some() {
            return Err(AccessError::AlreadyUsed);
        }
        let email: String = row.get("email");
        sqlx::query("DELETE FROM server_invites WHERE id=$1").bind(invite_id).execute(&mut *tx).await.map_err(sqlx_err)?;
        audit_in(&mut *tx, &actor.user_id, "server.invite_revoked", &email, None).await.map_err(sqlx_err)?;
        tx.commit().await.map_err(sqlx_err)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{test_store, test_user};
    use dh_server_client::auth::ServerRole;

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see store::test_store"]
    async fn create_refresh_list_revoke() {
        let store = test_store().await;
        let owner = test_user(&store, "owner@x.com", ServerRole::Owner).await.ctx();

        let InviteWrite::Created(first) = store.server_invite_create(&owner, "New@X.com", Some(7)).await.unwrap() else {
            panic!("expected created")
        };
        assert_eq!(first.email, "new@x.com");
        assert_eq!(first.status, dh_server_client::auth::InviteStatus::Open);
        assert_eq!(first.created_by, "owner@x.com");

        // Same email again refreshes the same invite.
        let InviteWrite::Refreshed(again) = store.server_invite_create(&owner, "new@x.com", None).await.unwrap() else {
            panic!("expected refreshed")
        };
        assert_eq!(again.id, first.id);
        assert_eq!(again.expires_ms, None);

        // An expired invite comes back to open on refresh.
        sqlx::query("UPDATE server_invites SET expires_ms=1").execute(&store.pool).await.unwrap();
        assert_eq!(store.server_invite_list(&owner).await.unwrap()[0].status, dh_server_client::auth::InviteStatus::Expired);
        store.server_invite_create(&owner, "new@x.com", Some(30)).await.unwrap();
        assert_eq!(store.server_invite_list(&owner).await.unwrap()[0].status, dh_server_client::auth::InviteStatus::Open);

        // An email that already has an account cannot be invited.
        assert_eq!(
            store.server_invite_create(&owner, "owner@x.com", Some(7)).await.unwrap_err(),
            AccessError::AlreadyHasAccount
        );
        assert!(matches!(
            store.server_invite_create(&owner, "x@y.com", Some(3)).await.unwrap_err(),
            AccessError::BadRequest(_)
        ));

        store.server_invite_revoke(&owner, &first.id).await.unwrap();
        assert!(store.server_invite_list(&owner).await.unwrap().is_empty());
        assert_eq!(store.server_invite_revoke(&owner, &first.id).await.unwrap_err(), AccessError::NotFound);

        let actions: Vec<String> = sqlx::query_scalar("SELECT action FROM audit WHERE org_id IS NULL ORDER BY id")
            .fetch_all(&store.pool)
            .await
            .unwrap();
        assert_eq!(
            actions,
            [
                "server.invite_created",
                "server.invite_refreshed",
                "server.invite_refreshed",
                "server.invite_revoked"
            ]
        );
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see store::test_store"]
    async fn used_invite_cannot_be_revoked_and_members_are_refused() {
        let store = test_store().await;
        let owner = test_user(&store, "owner@x.com", ServerRole::Owner).await.ctx();
        let member = test_user(&store, "m@x.com", ServerRole::Member).await.ctx();
        let admin = test_user(&store, "a@x.com", ServerRole::Admin).await.ctx();

        assert_eq!(store.server_invite_create(&member, "n@x.com", Some(7)).await.unwrap_err(), AccessError::Forbidden);
        assert_eq!(store.server_invite_list(&member).await.unwrap_err(), AccessError::Forbidden);
        assert_eq!(store.server_invite_revoke(&member, "any").await.unwrap_err(), AccessError::Forbidden);
        // Admins invite without the roles switch.
        let InviteWrite::Created(inv) = store.server_invite_create(&admin, "n@x.com", Some(7)).await.unwrap() else {
            panic!("expected created")
        };

        sqlx::query("UPDATE server_invites SET used_ms=5 WHERE id=$1").bind(&inv.id).execute(&store.pool).await.unwrap();
        assert_eq!(store.server_invite_revoke(&owner, &inv.id).await.unwrap_err(), AccessError::AlreadyUsed);
    }
}
