//! The sign in decision (spec 0010). After the provider profile is known,
//! [`decide`] picks one outcome from a handful of facts, and
//! [`Store::sign_in`] gathers the facts, carries the outcome out in one
//! transaction, and retries once if another request made the same account a
//! moment earlier. `decide` is pure so it tests without Postgres.

use super::provider::{ProfileOutcome, VerifiedProfile};
use super::{user_from_row, User, USER_COLUMNS};
use crate::server::store::{audit_in, now_ms, Store};
use sqlx::Row;

/// Why a sign in was refused. The code travels to the client, which shows
/// its own message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    EmailUnverified,
    NotInvited,
    InviteExpired,
    AccountLinkConflict,
}

impl Refusal {
    pub fn code(&self) -> &'static str {
        match self {
            Refusal::EmailUnverified => "email_unverified",
            Refusal::NotInvited => "not_invited",
            Refusal::InviteExpired => "invite_expired",
            Refusal::AccountLinkConflict => "account_link_conflict",
        }
    }
}

/// What the store found about the verified profile.
#[derive(Debug, Clone, Default)]
pub struct SignInFacts {
    /// The user that already owns this (provider, subject).
    pub identity_user: Option<String>,
    pub claimed: bool,
    /// The user whose account email equals the verified email, and whether
    /// that user already has an identity for this provider.
    pub email_user: Option<(String, bool)>,
    /// An unused invite for the email: its id and whether it has expired.
    pub invite: Option<(String, bool)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Known identity: refresh the profile and sign in.
    SignInExisting { user_id: String },
    /// Server not claimed: hand back a claim ticket, create nothing.
    Ticket,
    /// Same verified email as an existing account: add this identity to it.
    LinkIdentity { user_id: String },
    /// An open invite: create the member account and mark the invite used.
    JoinWithInvite { invite_id: String },
    Refuse(Refusal),
}

/// Steps 2 to 6 of the sign in decision. Step 1 (unverified email) is
/// handled before any lookup, in [`Store::sign_in`].
pub fn decide(facts: &SignInFacts) -> Decision {
    if let Some(user_id) = &facts.identity_user {
        return Decision::SignInExisting { user_id: user_id.clone() };
    }
    if !facts.claimed {
        return Decision::Ticket;
    }
    if let Some((user_id, has_identity_for_provider)) = &facts.email_user {
        // A second Google (or GitHub) account with the same email as an
        // account that already has one: refuse rather than silently swap.
        return if *has_identity_for_provider {
            Decision::Refuse(Refusal::AccountLinkConflict)
        } else {
            Decision::LinkIdentity { user_id: user_id.clone() }
        };
    }
    match &facts.invite {
        Some((_, true)) => Decision::Refuse(Refusal::InviteExpired),
        Some((invite_id, false)) => Decision::JoinWithInvite { invite_id: invite_id.clone() },
        None => Decision::Refuse(Refusal::NotInvited),
    }
}

/// The result of a sign in. The caller mints the session (or the ticket).
#[derive(Debug, Clone)]
pub enum SignIn {
    User(User),
    Ticket(VerifiedProfile),
    Refused { refusal: Refusal, email: Option<String> },
}

enum Attempt {
    Done(SignIn),
    /// Another request made the same account first: run the decision again.
    Raced,
}

fn is_unique_violation(e: &sqlx::Error) -> bool {
    e.as_database_error().map(|d| d.is_unique_violation()).unwrap_or(false)
}

impl Store {
    /// Run the sign in decision for a provider profile and carry it out.
    pub async fn sign_in(&self, outcome: ProfileOutcome) -> Result<SignIn, String> {
        let profile = match outcome {
            // Refused before any account or invite is looked up.
            ProfileOutcome::Unverified { email } => {
                return Ok(SignIn::Refused { refusal: Refusal::EmailUnverified, email });
            }
            ProfileOutcome::Verified(p) => p,
        };
        // Two requests can both see "no account yet". The loser hits a unique
        // violation, and its second run then finds the winner's account.
        for _ in 0..2 {
            match self.sign_in_once(&profile).await {
                Ok(Attempt::Done(out)) => return Ok(out),
                Ok(Attempt::Raced) => continue,
                Err(e) if is_unique_violation(&e) => continue,
                Err(e) => return Err(e.to_string()),
            }
        }
        Err("sign in kept conflicting with another request, try again".into())
    }

    async fn gather_facts(
        &self,
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        p: &VerifiedProfile,
    ) -> Result<SignInFacts, sqlx::Error> {
        let identity_user: Option<String> =
            sqlx::query_scalar("SELECT user_id FROM identities WHERE provider=$1 AND subject=$2")
                .bind(&p.provider)
                .bind(&p.subject)
                .fetch_optional(&mut **tx)
                .await?;
        if identity_user.is_some() {
            return Ok(SignInFacts { identity_user, ..Default::default() });
        }
        let claimed: bool = sqlx::query_scalar("SELECT claimed_ms IS NOT NULL FROM server_settings WHERE id=1")
            .fetch_one(&mut **tx)
            .await?;
        if !claimed {
            return Ok(SignInFacts { claimed, ..Default::default() });
        }
        let email_user = sqlx::query(
            "SELECT u.id AS id,
                    EXISTS (SELECT 1 FROM identities i WHERE i.user_id = u.id AND i.provider = $2) AS has_identity
             FROM users u WHERE u.email = $1",
        )
        .bind(&p.email)
        .bind(&p.provider)
        .fetch_optional(&mut **tx)
        .await?
        .map(|r| (r.get::<String, _>("id"), r.get::<bool, _>("has_identity")));
        let invite = sqlx::query("SELECT id, expires_ms FROM server_invites WHERE email=$1 AND used_ms IS NULL")
            .bind(&p.email)
            .fetch_optional(&mut **tx)
            .await?
            .map(|r| {
                let expires_ms: Option<i64> = r.get("expires_ms");
                (r.get::<String, _>("id"), expires_ms.is_some_and(|t| t <= now_ms()))
            });
        Ok(SignInFacts { identity_user: None, claimed, email_user, invite })
    }

    async fn sign_in_once(&self, p: &VerifiedProfile) -> Result<Attempt, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        let facts = self.gather_facts(&mut tx, p).await?;
        let out = match decide(&facts) {
            Decision::SignInExisting { user_id } | Decision::LinkIdentity { user_id } => {
                if facts.identity_user.is_none() {
                    insert_identity(&mut tx, &user_id, p).await?;
                }
                refresh_profile(&mut tx, &user_id, p).await?;
                SignIn::User(load_user(&mut tx, &user_id).await?)
            }
            Decision::Ticket => SignIn::Ticket(p.clone()),
            Decision::Refuse(refusal) => SignIn::Refused { refusal, email: Some(p.email.clone()) },
            Decision::JoinWithInvite { invite_id } => {
                let id = uuid::Uuid::new_v4().to_string();
                insert_user(&mut tx, &id, p, "member").await?;
                insert_identity(&mut tx, &id, p).await?;
                let marked = sqlx::query(
                    "UPDATE server_invites SET used_ms=$1, used_by=$2 WHERE id=$3 AND used_ms IS NULL",
                )
                .bind(now_ms())
                .bind(&id)
                .bind(&invite_id)
                .execute(&mut *tx)
                .await?;
                if marked.rows_affected() != 1 {
                    tx.rollback().await?;
                    return Ok(Attempt::Raced);
                }
                audit_in(&mut *tx, &id, "server.invite_accepted", &p.email, None).await?;
                SignIn::User(load_user(&mut tx, &id).await?)
            }
        };
        tx.commit().await?;
        Ok(Attempt::Done(out))
    }
}

/// Insert a `users` row from a verified profile. Used by sign in (member)
/// and by the claim (owner). The email is fixed at creation.
pub(super) async fn insert_user(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id: &str,
    p: &VerifiedProfile,
    role: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO users (id, email, name, avatar_url, server_role, created_ms) VALUES ($1,$2,$3,$4,$5,$6)",
    )
    .bind(id)
    .bind(&p.email)
    .bind(&p.name)
    .bind(&p.avatar_url)
    .bind(role)
    .bind(now_ms())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub(super) async fn insert_identity(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: &str,
    p: &VerifiedProfile,
) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT INTO identities (provider, subject, user_id, created_ms) VALUES ($1,$2,$3,$4)")
        .bind(&p.provider)
        .bind(&p.subject)
        .bind(user_id)
        .bind(now_ms())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Name and avatar follow the provider at each sign in. The account email
/// never changes, even when the provider's email has.
async fn refresh_profile(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: &str,
    p: &VerifiedProfile,
) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE users SET name=$1, avatar_url=$2 WHERE id=$3")
        .bind(&p.name)
        .bind(&p.avatar_url)
        .bind(user_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub(super) async fn load_user(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    id: &str,
) -> Result<User, sqlx::Error> {
    let row = sqlx::query(&format!("SELECT {USER_COLUMNS} FROM users WHERE id=$1"))
        .bind(id)
        .fetch_one(&mut **tx)
        .await?;
    Ok(user_from_row(&row))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::auth::ServerRole;
    use crate::server::store::{test_store, test_user};

    fn facts() -> SignInFacts {
        SignInFacts { claimed: true, ..Default::default() }
    }

    #[test]
    fn known_identity_signs_in_even_when_unclaimed_or_uninvited() {
        let f = SignInFacts { identity_user: Some("u1".into()), claimed: false, ..Default::default() };
        assert_eq!(decide(&f), Decision::SignInExisting { user_id: "u1".into() });
    }

    #[test]
    fn unclaimed_server_only_gives_a_ticket() {
        let f = SignInFacts { claimed: false, invite: Some(("i".into(), false)), ..Default::default() };
        assert_eq!(decide(&f), Decision::Ticket);
    }

    #[test]
    fn same_email_links_unless_the_provider_is_already_linked() {
        let f = SignInFacts { email_user: Some(("u1".into(), false)), ..facts() };
        assert_eq!(decide(&f), Decision::LinkIdentity { user_id: "u1".into() });
        let f = SignInFacts { email_user: Some(("u1".into(), true)), ..facts() };
        assert_eq!(decide(&f), Decision::Refuse(Refusal::AccountLinkConflict));
    }

    #[test]
    fn stranger_needs_an_open_invite() {
        assert_eq!(decide(&facts()), Decision::Refuse(Refusal::NotInvited));
        let open = SignInFacts { invite: Some(("i1".into(), false)), ..facts() };
        assert_eq!(decide(&open), Decision::JoinWithInvite { invite_id: "i1".into() });
        let expired = SignInFacts { invite: Some(("i1".into(), true)), ..facts() };
        assert_eq!(decide(&expired), Decision::Refuse(Refusal::InviteExpired));
    }

    #[test]
    fn refusal_codes_are_stable() {
        assert_eq!(Refusal::EmailUnverified.code(), "email_unverified");
        assert_eq!(Refusal::NotInvited.code(), "not_invited");
        assert_eq!(Refusal::InviteExpired.code(), "invite_expired");
        assert_eq!(Refusal::AccountLinkConflict.code(), "account_link_conflict");
    }

    fn profile(provider: &str, subject: &str, email: &str) -> VerifiedProfile {
        VerifiedProfile {
            provider: provider.into(),
            subject: subject.into(),
            email: email.into(),
            name: "N".into(),
            avatar_url: None,
        }
    }

    async fn claimed_store() -> (Store, User) {
        let store = test_store().await;
        let owner = test_user(&store, "owner@x.com", ServerRole::Owner).await;
        sqlx::query("UPDATE server_settings SET claimed_ms=1, claimed_by=$1 WHERE id=1")
            .bind(&owner.id)
            .execute(&store.pool)
            .await
            .unwrap();
        (store, owner)
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn unclaimed_server_creates_nothing() {
        let store = test_store().await;
        let out = store.sign_in(ProfileOutcome::Verified(profile("google", "g1", "a@x.com"))).await.unwrap();
        assert!(matches!(out, SignIn::Ticket(_)));
        let users: i64 = sqlx::query_scalar("SELECT count(*) FROM users").fetch_one(&store.pool).await.unwrap();
        let sessions: i64 = sqlx::query_scalar("SELECT count(*) FROM device_sessions").fetch_one(&store.pool).await.unwrap();
        assert_eq!((users, sessions), (0, 0));
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn unverified_email_is_refused_before_any_lookup() {
        let (store, _) = claimed_store().await;
        let out = store.sign_in(ProfileOutcome::Unverified { email: Some("owner@x.com".into()) }).await.unwrap();
        assert!(matches!(out, SignIn::Refused { refusal: Refusal::EmailUnverified, .. }));
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn stranger_is_refused_and_nothing_is_written() {
        let (store, _) = claimed_store().await;
        let out = store.sign_in(ProfileOutcome::Verified(profile("google", "g9", "stranger@x.com"))).await.unwrap();
        let SignIn::Refused { refusal, email } = out else { panic!("expected refusal") };
        assert_eq!(refusal, Refusal::NotInvited);
        assert_eq!(email.as_deref(), Some("stranger@x.com"));
        let users: i64 = sqlx::query_scalar("SELECT count(*) FROM users").fetch_one(&store.pool).await.unwrap();
        assert_eq!(users, 1, "only the owner exists");
        let audits: i64 = sqlx::query_scalar("SELECT count(*) FROM audit").fetch_one(&store.pool).await.unwrap();
        assert_eq!(audits, 0, "a refused sign in writes no audit row");
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn google_then_github_with_one_email_is_one_account() {
        let (store, owner) = claimed_store().await;
        // owner@x.com already has a google identity from test_user.
        let out = store.sign_in(ProfileOutcome::Verified(profile("github", "gh1", "owner@x.com"))).await.unwrap();
        let SignIn::User(u) = out else { panic!("expected sign in") };
        assert_eq!(u.id, owner.id);
        let n: i64 = sqlx::query_scalar("SELECT count(*) FROM identities WHERE user_id=$1")
            .bind(&owner.id)
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(n, 2);

        // A different GitHub account with the same email cannot take a second GitHub slot.
        let out = store.sign_in(ProfileOutcome::Verified(profile("github", "gh2", "owner@x.com"))).await.unwrap();
        assert!(matches!(out, SignIn::Refused { refusal: Refusal::AccountLinkConflict, .. }));
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn returning_identity_keeps_the_account_email() {
        let (store, owner) = claimed_store().await;
        // test_user's google subject is the email.
        let out = store
            .sign_in(ProfileOutcome::Verified(profile("google", "owner@x.com", "changed@x.com")))
            .await
            .unwrap();
        let SignIn::User(u) = out else { panic!("expected sign in") };
        assert_eq!(u.id, owner.id);
        assert_eq!(u.email, "owner@x.com", "the account email never changes");
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn open_invite_creates_one_member_and_is_used_once() {
        let (store, owner) = claimed_store().await;
        store.server_invite_create(&owner.ctx(), "new@x.com", Some(7)).await.unwrap();
        let out = store.sign_in(ProfileOutcome::Verified(profile("google", "g5", "new@x.com"))).await.unwrap();
        let SignIn::User(u) = out else { panic!("expected sign in") };
        assert_eq!(u.server_role, ServerRole::Member);
        let used: Option<String> = sqlx::query_scalar("SELECT used_by FROM server_invites WHERE email='new@x.com'")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(used.as_deref(), Some(u.id.as_str()));
        let audit: i64 = sqlx::query_scalar("SELECT count(*) FROM audit WHERE action='server.invite_accepted' AND org_id IS NULL")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(audit, 1);
        // The same person signing in again is the same account, not a second use.
        let again = store.sign_in(ProfileOutcome::Verified(profile("google", "g5", "new@x.com"))).await.unwrap();
        let SignIn::User(u2) = again else { panic!("expected sign in") };
        assert_eq!(u2.id, u.id);
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn two_first_sign_ins_for_one_invite_make_one_account() {
        let (store, owner) = claimed_store().await;
        store.server_invite_create(&owner.ctx(), "race@x.com", Some(7)).await.unwrap();
        let p = profile("google", "g-race", "race@x.com");
        let (a, b) = tokio::join!(
            store.sign_in(ProfileOutcome::Verified(p.clone())),
            store.sign_in(ProfileOutcome::Verified(p.clone())),
        );
        let ids: Vec<String> = [a.unwrap(), b.unwrap()]
            .into_iter()
            .map(|o| match o {
                SignIn::User(u) => u.id,
                other => panic!("expected sign in, got {other:?}"),
            })
            .collect();
        assert_eq!(ids[0], ids[1]);
        let n: i64 = sqlx::query_scalar("SELECT count(*) FROM users WHERE email='race@x.com'")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(n, 1);
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn expired_invite_gets_its_own_refusal() {
        let (store, owner) = claimed_store().await;
        store.server_invite_create(&owner.ctx(), "late@x.com", Some(1)).await.unwrap();
        sqlx::query("UPDATE server_invites SET expires_ms=1 WHERE email='late@x.com'")
            .execute(&store.pool)
            .await
            .unwrap();
        let out = store.sign_in(ProfileOutcome::Verified(profile("google", "g7", "late@x.com"))).await.unwrap();
        assert!(matches!(out, SignIn::Refused { refusal: Refusal::InviteExpired, .. }));
        let users: i64 = sqlx::query_scalar("SELECT count(*) FROM users").fetch_one(&store.pool).await.unwrap();
        assert_eq!(users, 1);
    }
}
