//! Email invites into an org (spec 0011, AC-4 to AC-7, AC-14).

use super::*;
use crate::store::{test_store, test_user};
use dh_server_client::auth::{AccessError, AuthCtx, InviteStatus, ProfileOutcome, ServerRole, SignIn, VerifiedProfile};
use dh_server_client::orgs::OrgInviteWrite;

async fn count(store: &Store, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(&store.pool).await.unwrap()
}

fn created(w: OrgInviteWrite) -> dh_server_client::orgs::OrgEmailInvite {
    match w {
        OrgInviteWrite::Created(i) => i,
        OrgInviteWrite::Refreshed(_) => panic!("expected created"),
    }
}

struct Fx {
    store: Store,
    owner: AuthCtx,
    org: Organization,
}

/// A claimed server with an owner and one org they own.
async fn fixture() -> Fx {
    let store = test_store().await;
    let owner = test_user(&store, "owner@x.com", ServerRole::Owner).await;
    sqlx::query("UPDATE server_settings SET claimed_ms=1, claimed_by=$1 WHERE id=1")
        .bind(&owner.id)
        .execute(&store.pool)
        .await
        .unwrap();
    let org = store.org_create(&owner.ctx(), "Acme").await.unwrap();
    Fx { store, owner: owner.ctx(), org }
}

fn profile(subject: &str, email: &str) -> VerifiedProfile {
    VerifiedProfile { provider: "google".into(), subject: subject.into(), email: email.into(), name: "N".into(), avatar_url: None }
}

/// Add `email` to the org with `role`, through the normal invite and accept path.
async fn add_member(fx: &Fx, email: &str, role: OrgRole) -> AuthCtx {
    let u = test_user(&fx.store, email, ServerRole::Member).await;
    let inv = created(fx.store.org_invite_create(&fx.owner, &fx.org.id, email, role, Some(7)).await.unwrap());
    fx.store.invite_accept(&u.id, &inv.id).await.unwrap();
    u.ctx()
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn invite_then_accept_joins_with_the_invited_role() {
    let fx = fixture().await;
    let bob = test_user(&fx.store, "bob@x.com", ServerRole::Member).await;
    let inv = created(fx.store.org_invite_create(&fx.owner, &fx.org.id, " Bob@X.com ", OrgRole::Admin, Some(7)).await.unwrap());
    assert_eq!((inv.email.as_str(), inv.role, inv.status), ("bob@x.com", OrgRole::Admin, InviteStatus::Open));
    assert_eq!(inv.created_by, "owner@x.com");

    let pending = fx.store.invites_pending(&bob.id).await.unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!((pending[0].org_name.as_str(), pending[0].role, pending[0].inviter_email.as_str()), ("Acme", OrgRole::Admin, "owner@x.com"));

    let org = fx.store.invite_accept(&bob.id, &inv.id).await.unwrap();
    assert_eq!(org.id, fx.org.id);
    assert_eq!(fx.store.org_role(&fx.org.id, &bob.id).await.unwrap(), Some(OrgRole::Admin));
    assert!(fx.store.invites_pending(&bob.id).await.unwrap().is_empty());
    let list = fx.store.org_invite_list(&fx.owner, &fx.org.id).await.unwrap();
    assert_eq!((list[0].status, list[0].used_by.as_deref()), (InviteStatus::Used, Some("bob@x.com")));
    assert_eq!(count(&fx.store, "SELECT count(*) FROM audit WHERE action='org.invite_created' AND org_id IS NOT NULL").await, 1);
    assert_eq!(count(&fx.store, "SELECT count(*) FROM audit WHERE action='org.invite_accepted' AND org_id IS NOT NULL").await, 1);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn only_the_named_email_can_accept_or_decline_and_others_get_not_found() {
    let fx = fixture().await;
    let eve = test_user(&fx.store, "eve@x.com", ServerRole::Member).await;
    let inv = created(fx.store.org_invite_create(&fx.owner, &fx.org.id, "bob@x.com", OrgRole::Member, Some(7)).await.unwrap());
    assert_eq!(fx.store.invite_accept(&eve.id, &inv.id).await.unwrap_err(), AccessError::NotFound);
    assert_eq!(fx.store.invite_decline(&eve.id, &inv.id).await.unwrap_err(), AccessError::NotFound);
    assert_eq!(fx.store.invite_accept(&eve.id, "no-such-id").await.unwrap_err(), AccessError::NotFound, "same answer as a missing id");
    assert!(fx.store.invites_pending(&eve.id).await.unwrap().is_empty());
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn decline_deletes_the_invite_and_it_can_be_sent_again() {
    let fx = fixture().await;
    let bob = test_user(&fx.store, "bob@x.com", ServerRole::Member).await;
    let inv = created(fx.store.org_invite_create(&fx.owner, &fx.org.id, "bob@x.com", OrgRole::Member, Some(7)).await.unwrap());
    fx.store.invite_decline(&bob.id, &inv.id).await.unwrap();
    assert!(fx.store.org_invite_list(&fx.owner, &fx.org.id).await.unwrap().is_empty());
    assert_eq!(fx.store.org_role(&fx.org.id, &bob.id).await.unwrap(), None);
    created(fx.store.org_invite_create(&fx.owner, &fx.org.id, "bob@x.com", OrgRole::Member, Some(7)).await.unwrap());
    assert_eq!(count(&fx.store, "SELECT count(*) FROM audit WHERE action='org.invite_declined' AND org_id IS NOT NULL").await, 1);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn accept_is_retry_safe_and_expired_is_refused() {
    let fx = fixture().await;
    let bob = test_user(&fx.store, "bob@x.com", ServerRole::Member).await;
    let inv = created(fx.store.org_invite_create(&fx.owner, &fx.org.id, "bob@x.com", OrgRole::Member, Some(7)).await.unwrap());
    fx.store.invite_accept(&bob.id, &inv.id).await.unwrap();
    assert_eq!(fx.store.invite_accept(&bob.id, &inv.id).await.unwrap().id, fx.org.id, "second accept returns the org");
    assert_eq!(count(&fx.store, "SELECT count(*) FROM audit WHERE action='org.invite_accepted' AND org_id IS NOT NULL").await, 1);

    let cy = test_user(&fx.store, "cy@x.com", ServerRole::Member).await;
    let old = created(fx.store.org_invite_create(&fx.owner, &fx.org.id, "cy@x.com", OrgRole::Member, Some(1)).await.unwrap());
    sqlx::query("UPDATE server_invites SET expires_ms=1 WHERE id=$1").bind(&old.id).execute(&fx.store.pool).await.unwrap();
    assert_eq!(fx.store.invite_accept(&cy.id, &old.id).await.unwrap_err(), AccessError::InviteExpired);
    assert!(fx.store.invites_pending(&cy.id).await.unwrap().is_empty(), "expired invites are not pending");
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn accepting_after_joining_another_way_keeps_the_existing_role() {
    let fx = fixture().await;
    let bob = test_user(&fx.store, "bob@x.com", ServerRole::Member).await;
    let inv = created(fx.store.org_invite_create(&fx.owner, &fx.org.id, "bob@x.com", OrgRole::Member, Some(7)).await.unwrap());
    sqlx::query("INSERT INTO org_members (org_id, user_id, role, joined_ms) VALUES ($1,$2,'admin',1)")
        .bind(&fx.org.id)
        .bind(&bob.id)
        .execute(&fx.store.pool)
        .await
        .unwrap();
    fx.store.invite_accept(&bob.id, &inv.id).await.unwrap();
    assert_eq!(fx.store.org_role(&fx.org.id, &bob.id).await.unwrap(), Some(OrgRole::Admin), "role is never changed");
    assert_eq!(count(&fx.store, "SELECT count(*) FROM server_invites WHERE used_ms IS NOT NULL").await, 1);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn refresh_an_existing_invite_and_refuse_an_email_already_in_the_org() {
    let fx = fixture().await;
    let first = created(fx.store.org_invite_create(&fx.owner, &fx.org.id, "bob@x.com", OrgRole::Member, Some(7)).await.unwrap());
    let OrgInviteWrite::Refreshed(again) =
        fx.store.org_invite_create(&fx.owner, &fx.org.id, "bob@x.com", OrgRole::Admin, None).await.unwrap()
    else {
        panic!("expected refreshed")
    };
    assert_eq!((again.id, again.role, again.expires_ms), (first.id, OrgRole::Admin, None));
    add_member(&fx, "carl@x.com", OrgRole::Member).await;
    assert_eq!(
        fx.store.org_invite_create(&fx.owner, &fx.org.id, "carl@x.com", OrgRole::Member, Some(7)).await.unwrap_err(),
        AccessError::AlreadyMember
    );
    assert!(matches!(
        fx.store.org_invite_create(&fx.owner, &fx.org.id, "d@x.com", OrgRole::Member, Some(3)).await.unwrap_err(),
        AccessError::BadRequest(_)
    ));
    assert_eq!(count(&fx.store, "SELECT count(*) FROM audit WHERE action='org.invite_refreshed' AND org_id IS NOT NULL").await, 1);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn one_email_holds_open_invites_to_several_orgs() {
    let fx = fixture().await;
    let second = fx.store.org_create(&fx.owner, "Beta").await.unwrap();
    created(fx.store.org_invite_create(&fx.owner, &fx.org.id, "bob@x.com", OrgRole::Member, Some(7)).await.unwrap());
    created(fx.store.org_invite_create(&fx.owner, &second.id, "bob@x.com", OrgRole::Admin, Some(7)).await.unwrap());
    let bob = test_user(&fx.store, "bob@x.com", ServerRole::Member).await;
    assert_eq!(fx.store.invites_pending(&bob.id).await.unwrap().len(), 2);
    // The server access invite list shows only plain server invites.
    assert!(fx.store.server_invite_list(&fx.owner).await.unwrap().is_empty());
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn admins_are_limited_and_plain_members_are_refused() {
    let fx = fixture().await;
    let admin = add_member(&fx, "admin@x.com", OrgRole::Admin).await;
    let member = add_member(&fx, "member@x.com", OrgRole::Member).await;
    let outsider = test_user(&fx.store, "out@x.com", ServerRole::Member).await.ctx();

    // A plain member or an outsider is refused every one.
    for who in [&member, &outsider] {
        assert_eq!(fx.store.org_invite_create(who, &fx.org.id, "n@x.com", OrgRole::Member, Some(7)).await.unwrap_err(), AccessError::Forbidden);
        assert_eq!(fx.store.org_invite_list(who, &fx.org.id).await.unwrap_err(), AccessError::Forbidden);
        assert_eq!(fx.store.org_invite_revoke(who, &fx.org.id, "any").await.unwrap_err(), AccessError::Forbidden);
    }
    // An admin invites member or admin, never owner, and never touches an owner invite.
    created(fx.store.org_invite_create(&admin, &fx.org.id, "n@x.com", OrgRole::Admin, Some(7)).await.unwrap());
    assert_eq!(fx.store.org_invite_create(&admin, &fx.org.id, "o@x.com", OrgRole::Owner, Some(7)).await.unwrap_err(), AccessError::Forbidden);
    let owner_inv = created(fx.store.org_invite_create(&fx.owner, &fx.org.id, "o@x.com", OrgRole::Owner, Some(7)).await.unwrap());
    assert_eq!(
        fx.store.org_invite_create(&admin, &fx.org.id, "o@x.com", OrgRole::Member, Some(7)).await.unwrap_err(),
        AccessError::Forbidden,
        "an admin cannot refresh an owner invite into a lesser role either"
    );
    assert_eq!(fx.store.org_invite_revoke(&admin, &fx.org.id, &owner_inv.id).await.unwrap_err(), AccessError::Forbidden);
    let still: String = sqlx::query_scalar("SELECT org_role FROM server_invites WHERE id=$1").bind(&owner_inv.id).fetch_one(&fx.store.pool).await.unwrap();
    assert_eq!(still, "owner");
    fx.store.org_invite_revoke(&fx.owner, &fx.org.id, &owner_inv.id).await.unwrap();
    assert_eq!(fx.store.org_invite_revoke(&fx.owner, &fx.org.id, &owner_inv.id).await.unwrap_err(), AccessError::NotFound);
    assert_eq!(count(&fx.store, "SELECT count(*) FROM audit WHERE action='org.invite_revoked' AND org_id IS NOT NULL").await, 1);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn a_used_invite_cannot_be_revoked() {
    let fx = fixture().await;
    let bob = test_user(&fx.store, "bob@x.com", ServerRole::Member).await;
    let inv = created(fx.store.org_invite_create(&fx.owner, &fx.org.id, "bob@x.com", OrgRole::Member, Some(7)).await.unwrap());
    fx.store.invite_accept(&bob.id, &inv.id).await.unwrap();
    assert_eq!(fx.store.org_invite_revoke(&fx.owner, &fx.org.id, &inv.id).await.unwrap_err(), AccessError::AlreadyUsed);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn first_sign_in_joins_every_open_invite_in_one_step() {
    let fx = fixture().await;
    let second = fx.store.org_create(&fx.owner, "Beta").await.unwrap();
    created(fx.store.org_invite_create(&fx.owner, &fx.org.id, "new@x.com", OrgRole::Member, Some(7)).await.unwrap());
    created(fx.store.org_invite_create(&fx.owner, &second.id, "new@x.com", OrgRole::Admin, Some(7)).await.unwrap());
    let out = fx.store.sign_in(ProfileOutcome::Verified(profile("g-new", "new@x.com"))).await.unwrap();
    let SignIn::User(u) = out else { panic!("expected sign in") };
    assert_eq!(u.server_role, ServerRole::Member);
    assert_eq!(fx.store.org_role(&fx.org.id, &u.id).await.unwrap(), Some(OrgRole::Member));
    assert_eq!(fx.store.org_role(&second.id, &u.id).await.unwrap(), Some(OrgRole::Admin));
    assert_eq!(count(&fx.store, "SELECT count(*) FROM server_invites WHERE used_ms IS NULL").await, 0);
    assert_eq!(count(&fx.store, "SELECT count(*) FROM audit WHERE action='org.invite_accepted' AND org_id IS NOT NULL").await, 2);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn two_simultaneous_first_sign_ins_make_one_account_and_one_membership_per_org() {
    let fx = fixture().await;
    let second = fx.store.org_create(&fx.owner, "Beta").await.unwrap();
    created(fx.store.org_invite_create(&fx.owner, &fx.org.id, "race@x.com", OrgRole::Member, Some(7)).await.unwrap());
    created(fx.store.org_invite_create(&fx.owner, &second.id, "race@x.com", OrgRole::Member, Some(7)).await.unwrap());
    let p = profile("g-race", "race@x.com");
    let (a, b) = tokio::join!(
        fx.store.sign_in(ProfileOutcome::Verified(p.clone())),
        fx.store.sign_in(ProfileOutcome::Verified(p.clone())),
    );
    for out in [a.unwrap(), b.unwrap()] {
        assert!(matches!(out, SignIn::User(_)), "both end signed in");
    }
    assert_eq!(count(&fx.store, "SELECT count(*) FROM users WHERE email='race@x.com'").await, 1);
    assert_eq!(count(&fx.store, "SELECT count(*) FROM org_members m JOIN users u ON u.id=m.user_id WHERE u.email='race@x.com'").await, 2);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn expired_org_invites_alone_refuse_and_a_mix_joins_only_the_open_one() {
    let fx = fixture().await;
    let second = fx.store.org_create(&fx.owner, "Beta").await.unwrap();
    let old = created(fx.store.org_invite_create(&fx.owner, &fx.org.id, "late@x.com", OrgRole::Member, Some(1)).await.unwrap());
    sqlx::query("UPDATE server_invites SET expires_ms=1 WHERE id=$1").bind(&old.id).execute(&fx.store.pool).await.unwrap();
    let out = fx.store.sign_in(ProfileOutcome::Verified(profile("g-late", "late@x.com"))).await.unwrap();
    assert!(matches!(out, SignIn::Refused { refusal: dh_server_client::auth::Refusal::InviteExpired, .. }));
    assert_eq!(count(&fx.store, "SELECT count(*) FROM users WHERE email='late@x.com'").await, 0);

    created(fx.store.org_invite_create(&fx.owner, &second.id, "late@x.com", OrgRole::Member, Some(7)).await.unwrap());
    let SignIn::User(u) = fx.store.sign_in(ProfileOutcome::Verified(profile("g-late", "late@x.com"))).await.unwrap() else {
        panic!("expected sign in")
    };
    assert_eq!(fx.store.org_role(&second.id, &u.id).await.unwrap(), Some(OrgRole::Member));
    assert_eq!(fx.store.org_role(&fx.org.id, &u.id).await.unwrap(), None, "the expired invite is left alone");
    assert_eq!(count(&fx.store, "SELECT count(*) FROM server_invites WHERE used_ms IS NULL").await, 1);
}
