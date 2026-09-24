//! Member roles, removal and leaving (spec 0011, AC-9, AC-10, AC-11, AC-14).

use super::*;
use crate::store::{test_store, test_user};
use dh_server_client::auth::{AccessError, AuthCtx, ServerRole};

async fn count(store: &Store, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(&store.pool).await.unwrap()
}

/// A claimed-server org with an owner, and a way to add people at a role.
struct Fx {
    store: Store,
    owner: AuthCtx,
    org: Organization,
}

async fn fixture() -> Fx {
    let store = test_store().await;
    let owner = test_user(&store, "owner@x.com", ServerRole::Owner).await.ctx();
    let org = store.org_create(&owner, "Acme").await.unwrap();
    Fx { store, owner, org }
}

/// Add `email` to the org at `role`, through an invite the org owner sends.
async fn add(fx: &Fx, email: &str, role: OrgRole) -> AuthCtx {
    let u = test_user(&fx.store, email, ServerRole::Member).await;
    let dh_server_client::orgs::OrgInviteWrite::Created(inv) =
        fx.store.org_invite_create(&fx.owner, &fx.org.id, email, role, Some(7)).await.unwrap()
    else {
        panic!("expected created")
    };
    fx.store.invite_accept(&u.id, &inv.id).await.unwrap();
    u.ctx()
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn an_owner_sets_any_role_and_it_is_audited() {
    let fx = fixture().await;
    let bob = add(&fx, "bob@x.com", OrgRole::Member).await;
    fx.store.org_member_set_role(&fx.owner, &fx.org.id, &bob.user_id, OrgRole::Owner).await.unwrap();
    assert_eq!(fx.store.org_role(&fx.org.id, &bob.user_id).await.unwrap(), Some(OrgRole::Owner));
    // A second owner makes demoting the first fine.
    fx.store.org_member_set_role(&bob, &fx.org.id, &fx.owner.user_id, OrgRole::Member).await.unwrap();
    // A change to the same role is a no op with no audit row.
    fx.store.org_member_set_role(&bob, &fx.org.id, &fx.owner.user_id, OrgRole::Member).await.unwrap();
    assert_eq!(count(&fx.store, "SELECT count(*) FROM audit WHERE action='org.member_role_changed' AND org_id IS NOT NULL").await, 2);
    let detail: String = sqlx::query_scalar("SELECT detail FROM audit WHERE action='org.member_role_changed' ORDER BY id LIMIT 1")
        .fetch_one(&fx.store.pool)
        .await
        .unwrap();
    assert_eq!(detail, "member to owner");
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn an_admin_is_limited_to_member_and_admin_and_never_an_owner() {
    let fx = fixture().await;
    let admin = add(&fx, "admin@x.com", OrgRole::Admin).await;
    let bob = add(&fx, "bob@x.com", OrgRole::Member).await;
    let set = |who: &AuthCtx, target: &str, role| {
        let store = fx.store.clone();
        let (who, org, target) = (who.clone(), fx.org.id.clone(), target.to_string());
        async move { store.org_member_set_role(&who, &org, &target, role).await }
    };
    set(&admin, &bob.user_id, OrgRole::Admin).await.unwrap();
    set(&admin, &bob.user_id, OrgRole::Member).await.unwrap();
    // Cannot make anyone an owner, themselves included, and cannot touch an owner.
    assert_eq!(set(&admin, &bob.user_id, OrgRole::Owner).await.unwrap_err(), AccessError::Forbidden);
    assert_eq!(set(&admin, &admin.user_id, OrgRole::Owner).await.unwrap_err(), AccessError::Forbidden);
    assert_eq!(set(&admin, &fx.owner.user_id, OrgRole::Member).await.unwrap_err(), AccessError::Forbidden);
    assert_eq!(fx.store.org_role(&fx.org.id, &fx.owner.user_id).await.unwrap(), Some(OrgRole::Owner));
    // A plain member changes nobody's role, and an outsider is refused.
    assert_eq!(set(&bob, &admin.user_id, OrgRole::Member).await.unwrap_err(), AccessError::Forbidden);
    let outsider = test_user(&fx.store, "out@x.com", ServerRole::Member).await.ctx();
    assert_eq!(set(&outsider, &bob.user_id, OrgRole::Admin).await.unwrap_err(), AccessError::Forbidden);
    // An unknown target is a 404.
    assert_eq!(set(&fx.owner, "nobody", OrgRole::Admin).await.unwrap_err(), AccessError::NotFound);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn two_owners_demoting_themselves_at_once_leave_one_and_the_other_gets_last_owner() {
    let fx = fixture().await;
    let bob = add(&fx, "bob@x.com", OrgRole::Owner).await;
    let (a, b) = tokio::join!(
        fx.store.org_member_set_role(&fx.owner, &fx.org.id, &fx.owner.user_id, OrgRole::Member),
        fx.store.org_member_set_role(&bob, &fx.org.id, &bob.user_id, OrgRole::Member),
    );
    let outcomes = [a, b];
    assert_eq!(outcomes.iter().filter(|r| r.is_ok()).count(), 1, "exactly one wins: {outcomes:?}");
    assert_eq!(outcomes.iter().filter(|r| **r == Err(AccessError::LastOwner)).count(), 1, "{outcomes:?}");
    assert_eq!(count(&fx.store, "SELECT count(*) FROM org_members WHERE role='owner'").await, 1);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn two_owners_demoting_each_other_at_once_leave_one_owner() {
    let fx = fixture().await;
    let bob = add(&fx, "bob@x.com", OrgRole::Owner).await;
    let (a, b) = tokio::join!(
        fx.store.org_member_set_role(&fx.owner, &fx.org.id, &bob.user_id, OrgRole::Member),
        fx.store.org_member_set_role(&bob, &fx.org.id, &fx.owner.user_id, OrgRole::Member),
    );
    let outcomes = [a, b];
    assert_eq!(outcomes.iter().filter(|r| r.is_ok()).count(), 1, "exactly one wins: {outcomes:?}");
    // The loser was already demoted by the winner, so it is refused as a
    // non owner (or, if it got the lock first, told it is the last owner).
    let loser = outcomes.iter().find(|r| r.is_err()).unwrap().clone().unwrap_err();
    assert!(matches!(loser, AccessError::Forbidden | AccessError::LastOwner), "{loser:?}");
    assert_eq!(count(&fx.store, "SELECT count(*) FROM org_members WHERE role='owner'").await, 1);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn the_last_owner_cannot_be_removed_and_can_leave_only_with_another_owner() {
    let fx = fixture().await;
    let f = &fx;
    assert_eq!(f.store.org_member_remove(&f.owner, &f.org.id, &f.owner.user_id).await.unwrap_err(), AccessError::LastOwner);
    let bob = add(f, "bob@x.com", OrgRole::Owner).await;
    // Two owners try to remove each other at once: one wins.
    let (a, b) = tokio::join!(
        f.store.org_member_remove(&f.owner, &f.org.id, &bob.user_id),
        f.store.org_member_remove(&bob, &f.org.id, &f.owner.user_id),
    );
    assert_eq!([&a, &b].iter().filter(|r| r.is_ok()).count(), 1, "{a:?} {b:?}");
    assert_eq!(count(&f.store, "SELECT count(*) FROM org_members WHERE role='owner'").await, 1);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn who_may_remove_whom() {
    let fx = fixture().await;
    let admin = add(&fx, "admin@x.com", OrgRole::Admin).await;
    let other_admin = add(&fx, "admin2@x.com", OrgRole::Admin).await;
    let bob = add(&fx, "bob@x.com", OrgRole::Member).await;
    let carl = add(&fx, "carl@x.com", OrgRole::Member).await;
    let rm = |who: &AuthCtx, target: &str| {
        let store = fx.store.clone();
        let (who, org, target) = (who.clone(), fx.org.id.clone(), target.to_string());
        async move { store.org_member_remove(&who, &org, &target).await }
    };
    // A plain member cannot remove anyone but themselves.
    assert_eq!(rm(&bob, &carl.user_id).await.unwrap_err(), AccessError::Forbidden);
    // An admin removes a member or an admin, never an owner.
    assert_eq!(rm(&admin, &fx.owner.user_id).await.unwrap_err(), AccessError::Forbidden);
    rm(&admin, &carl.user_id).await.unwrap();
    rm(&admin, &other_admin.user_id).await.unwrap();
    // Leaving is always allowed; the person is gone and the row says so.
    rm(&bob, &bob.user_id).await.unwrap();
    assert_eq!(fx.store.org_role(&fx.org.id, &bob.user_id).await.unwrap(), None);
    assert_eq!(rm(&bob, &bob.user_id).await.unwrap_err(), AccessError::Forbidden, "no longer in the org");
    assert_eq!(rm(&fx.owner, "nobody").await.unwrap_err(), AccessError::NotFound);
    assert_eq!(count(&fx.store, "SELECT count(*) FROM audit WHERE action='org.member_removed' AND org_id IS NOT NULL").await, 2);
    assert_eq!(count(&fx.store, "SELECT count(*) FROM audit WHERE action='org.member_left' AND org_id IS NOT NULL").await, 1);
}
