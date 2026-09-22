//! Claiming a new server (spec 0010): the `impl Store` half. The pure ticket
//! and setup-code logic lives in `dh_server_client::auth` (spec 0012).

use super::accounts::{insert_identity, insert_user, load_user};
use crate::store::{audit_in, now_ms, Store};
use dh_server_client::auth::{constant_time_eq, derive_setup_code, normalize_setup_code, ClaimError, ClaimTicket};
use dh_server_client::auth::User;

impl Store {
    /// The setup code for this server.
    pub fn setup_code(&self) -> String {
        derive_setup_code(&self.master_key)
    }

    pub async fn is_claimed(&self) -> Result<bool, String> {
        sqlx::query_scalar("SELECT claimed_ms IS NOT NULL FROM server_settings WHERE id=1")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| e.to_string())
    }

    /// Claim the server: open the ticket, check the code, then in one
    /// transaction flip `claimed_ms` (a guarded update, so of two simultaneous
    /// claims exactly one wins) and create the owner. Nothing is created on
    /// any refusal.
    pub async fn claim(&self, ticket: &str, code: &str) -> Result<User, ClaimError> {
        self.claim_at(ticket, code, now_ms()).await
    }

    pub(crate) async fn claim_at(&self, ticket: &str, code: &str, now: i64) -> Result<User, ClaimError> {
        let ticket = ClaimTicket::open(ticket, &self.master_key, now).ok_or(ClaimError::TicketInvalid)?;
        let expected = normalize_setup_code(&self.setup_code());
        if !constant_time_eq(normalize_setup_code(code).as_bytes(), expected.as_bytes()) {
            return Err(ClaimError::CodeInvalid);
        }
        let profile = ticket.profile();
        let mut tx = self.pool.begin().await.map_err(sqlx_err)?;
        // The row lock also makes a simultaneous second claim wait here.
        let won = sqlx::query("UPDATE server_settings SET claimed_ms=$1 WHERE id=1 AND claimed_ms IS NULL")
            .bind(now)
            .execute(&mut *tx)
            .await
            .map_err(sqlx_err)?;
        if won.rows_affected() != 1 {
            return Err(ClaimError::AlreadyClaimed);
        }
        let id = uuid::Uuid::new_v4().to_string();
        insert_user(&mut tx, &id, &profile, "owner").await.map_err(sqlx_err)?;
        insert_identity(&mut tx, &id, &profile).await.map_err(sqlx_err)?;
        sqlx::query("UPDATE server_settings SET claimed_by=$1 WHERE id=1")
            .bind(&id)
            .execute(&mut *tx)
            .await
            .map_err(sqlx_err)?;
        audit_in(&mut *tx, &id, "server.claimed", &profile.email, None).await.map_err(sqlx_err)?;
        let user = load_user(&mut tx, &id).await.map_err(sqlx_err)?;
        tx.commit().await.map_err(sqlx_err)?;
        Ok(user)
    }
}

/// `ClaimTicket`/`ClaimError` live in `dh-server-client`, which never depends
/// on `sqlx` (spec 0012, AC-8) — so `From<sqlx::Error> for ClaimError` can't
/// be written anywhere (blocked by the orphan rule in `dh-server`, and by
/// AC-8 in `dh-server-client`). Every producing call site maps explicitly
/// instead, at the same error shape the old `?` produced.
fn sqlx_err(e: sqlx::Error) -> ClaimError {
    ClaimError::Other(e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::test_store;
    use dh_server_client::auth::VerifiedProfile;

    fn profile(email: &str) -> VerifiedProfile {
        VerifiedProfile {
            provider: "google".into(),
            subject: format!("sub-{email}"),
            email: email.into(),
            name: "Owner".into(),
            avatar_url: Some("http://a".into()),
        }
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see store::test_store"]
    async fn right_code_makes_the_owner_once() {
        let store = test_store().await;
        let ticket = ClaimTicket::seal(&profile("boss@x.com"), &store.master_key, now_ms()).unwrap();
        assert!(!store.is_claimed().await.unwrap());
        let owner = store.claim(&ticket, &store.setup_code().to_lowercase()).await.unwrap();
        assert_eq!(owner.email, "boss@x.com");
        assert_eq!(owner.server_role, dh_server_client::auth::ServerRole::Owner);
        assert!(store.is_claimed().await.unwrap());

        let claimed_by: Option<String> = sqlx::query_scalar("SELECT claimed_by FROM server_settings").fetch_one(&store.pool).await.unwrap();
        assert_eq!(claimed_by.as_deref(), Some(owner.id.as_str()));
        let audit: i64 = sqlx::query_scalar("SELECT count(*) FROM audit WHERE action='server.claimed' AND org_id IS NULL")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(audit, 1);

        // The code stops working the moment the server is claimed.
        let second = ClaimTicket::seal(&profile("late@x.com"), &store.master_key, now_ms()).unwrap();
        assert_eq!(store.claim(&second, &store.setup_code()).await, Err(ClaimError::AlreadyClaimed));
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see store::test_store"]
    async fn bad_code_bad_ticket_and_expired_ticket_create_nothing() {
        let store = test_store().await;
        let good = ClaimTicket::seal(&profile("a@x.com"), &store.master_key, now_ms()).unwrap();
        assert_eq!(store.claim(&good, "AAAA-AAAA-AAAA-AAAA-AAAA").await, Err(ClaimError::CodeInvalid));
        assert_eq!(store.claim("00ff", &store.setup_code()).await, Err(ClaimError::TicketInvalid));
        let stale = ClaimTicket::seal(&profile("a@x.com"), &store.master_key, now_ms() - dh_server_client::auth::TICKET_TTL_MS - 1).unwrap();
        assert_eq!(store.claim(&stale, &store.setup_code()).await, Err(ClaimError::TicketInvalid));
        // A ticket from another server's key is forged as far as this one can tell.
        let forged = ClaimTicket::seal(&profile("a@x.com"), &[1u8; 32], now_ms()).unwrap();
        assert_eq!(store.claim(&forged, &store.setup_code()).await, Err(ClaimError::TicketInvalid));

        let users: i64 = sqlx::query_scalar("SELECT count(*) FROM users").fetch_one(&store.pool).await.unwrap();
        assert_eq!(users, 0);
        assert!(!store.is_claimed().await.unwrap());
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see store::test_store"]
    async fn two_simultaneous_claims_yield_one_owner() {
        let store = test_store().await;
        let a = ClaimTicket::seal(&profile("a@x.com"), &store.master_key, now_ms()).unwrap();
        let b = ClaimTicket::seal(&profile("b@x.com"), &store.master_key, now_ms()).unwrap();
        let code = store.setup_code();
        let (ra, rb) = tokio::join!(store.claim(&a, &code), store.claim(&b, &code));
        let wins = [ra.is_ok(), rb.is_ok()].iter().filter(|w| **w).count();
        assert_eq!(wins, 1);
        let loser = if ra.is_ok() { rb } else { ra };
        assert_eq!(loser, Err(ClaimError::AlreadyClaimed));
        let owners: i64 = sqlx::query_scalar("SELECT count(*) FROM users WHERE server_role='owner'")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(owners, 1);
    }
}
