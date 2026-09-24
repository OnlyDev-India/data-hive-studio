//! Who may create an org (spec 0011, AC-1, AC-2, AC-3, AC-14, AC-15).

use super::*;
use crate::store::{test_store, test_user};
use dh_server_client::auth::{AccessError, AuthCtx, ServerRole};

async fn count(store: &Store, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(&store.pool).await.unwrap()
}

/// A fresh context for `id`, as the next request would see it.
async fn fresh(store: &Store, id: &str) -> AuthCtx {
    store.user_get(id).await.unwrap().unwrap().ctx()
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn a_server_owner_creates_any_number_and_becomes_org_owner() {
    let store = test_store().await;
    let owner = test_user(&store, "o@x.com", ServerRole::Owner).await;
    let a = store.org_create(&owner.ctx(), "  Acme  ").await.unwrap();
    store.org_create(&owner.ctx(), "Beta").await.unwrap();
    assert_eq!(a.name, "Acme", "the name is trimmed");
    assert_eq!(store.org_role(&a.id, &owner.id).await.unwrap(), Some(OrgRole::Owner));
    assert_eq!(count(&store, "SELECT count(*) FROM audit WHERE action='org.created' AND org_id IS NOT NULL").await, 2);
    assert!(store.can_create_org(&owner.ctx()).await.unwrap());
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn the_name_must_be_one_to_eighty_characters() {
    let store = test_store().await;
    let owner = test_user(&store, "o@x.com", ServerRole::Owner).await.ctx();
    for bad in ["", "   ", &"x".repeat(81)] {
        assert!(matches!(store.org_create(&owner, bad).await, Err(AccessError::BadRequest(_))), "{bad:?}");
    }
    store.org_create(&owner, &"x".repeat(80)).await.unwrap();
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn with_the_policy_off_only_an_admin_with_the_switch_creates_one_org() {
    let store = test_store().await;
    let owner = test_user(&store, "o@x.com", ServerRole::Owner).await.ctx();
    let member = test_user(&store, "m@x.com", ServerRole::Member).await;
    let admin = test_user(&store, "a@x.com", ServerRole::Admin).await;

    assert_eq!(store.org_create(&member.ctx(), "M").await.unwrap_err(), AccessError::Forbidden);
    assert_eq!(store.org_create(&admin.ctx(), "A").await.unwrap_err(), AccessError::Forbidden);
    assert!(!store.can_create_org(&admin.ctx()).await.unwrap());

    store.create_orgs_set(&owner, &admin.id, true).await.unwrap();
    let ctx = fresh(&store, &admin.id).await;
    assert!(store.can_create_org(&ctx).await.unwrap());
    store.org_create(&ctx, "A").await.unwrap();
    assert_eq!(store.org_create(&ctx, "A2").await.unwrap_err(), AccessError::OrgLimit);
    assert!(!store.can_create_org(&ctx).await.unwrap());
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn two_simultaneous_creates_by_one_admin_make_one_org() {
    let store = test_store().await;
    let owner = test_user(&store, "o@x.com", ServerRole::Owner).await.ctx();
    let admin = test_user(&store, "a@x.com", ServerRole::Admin).await;
    store.create_orgs_set(&owner, &admin.id, true).await.unwrap();
    let ctx = fresh(&store, &admin.id).await;
    let (a, b) = tokio::join!(store.org_create(&ctx, "One"), store.org_create(&ctx, "Two"));
    assert_eq!([a.is_ok(), b.is_ok()].iter().filter(|x| **x).count(), 1);
    let loser = if a.is_err() { a } else { b };
    assert_eq!(loser.unwrap_err(), AccessError::OrgLimit);
    assert_eq!(count(&store, "SELECT count(*) FROM organizations").await, 1);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn the_switch_lives_only_on_an_admin_and_is_cleared_with_the_role() {
    let store = test_store().await;
    let owner = test_user(&store, "o@x.com", ServerRole::Owner).await.ctx();
    let admin = test_user(&store, "a@x.com", ServerRole::Admin).await;
    let member = test_user(&store, "m@x.com", ServerRole::Member).await;

    assert_eq!(store.create_orgs_set(&admin.ctx(), &admin.id, true).await, Err(AccessError::Forbidden));
    assert_eq!(store.create_orgs_set(&owner, &member.id, true).await, Err(AccessError::NotAnAdmin));
    assert_eq!(store.create_orgs_set(&owner, "missing", true).await, Err(AccessError::NotFound));

    store.create_orgs_set(&owner, &admin.id, true).await.unwrap();
    let ctx = fresh(&store, &admin.id).await;
    let org = store.org_create(&ctx, "A").await.unwrap();
    // Demoting clears the switch and never removes the org they made.
    store.role_set(&owner, &admin.id, ServerRole::Member).await.unwrap();
    assert!(!fresh(&store, &admin.id).await.can_create_orgs);
    assert_eq!(store.org_role(&org.id, &admin.id).await.unwrap(), Some(OrgRole::Owner));
    // Promoting again does not bring it back, and the limit still counts the org.
    store.role_set(&owner, &admin.id, ServerRole::Admin).await.unwrap();
    store.create_orgs_set(&owner, &admin.id, true).await.unwrap();
    let again = fresh(&store, &admin.id).await;
    assert_eq!(store.org_create(&again, "A2").await.unwrap_err(), AccessError::OrgLimit);
    assert_eq!(count(&store, "SELECT count(*) FROM audit WHERE action='server.create_orgs_changed' AND org_id IS NULL").await, 2);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn the_open_policy_lets_anyone_create_one_org_and_only_the_owner_flips_it() {
    let store = test_store().await;
    let owner = test_user(&store, "o@x.com", ServerRole::Owner).await.ctx();
    let member = test_user(&store, "m@x.com", ServerRole::Member).await;
    let admin = test_user(&store, "a@x.com", ServerRole::Admin).await;

    assert_eq!(store.open_org_creation_set(&admin.ctx(), true).await, Err(AccessError::Forbidden));
    assert_eq!(store.open_org_creation_set(&member.ctx(), true).await, Err(AccessError::Forbidden));
    assert_eq!(store.server_settings_get(&member.ctx()).await.unwrap_err(), AccessError::Forbidden);
    assert!(!store.server_settings_get(&owner).await.unwrap().open_org_creation);

    store.open_org_creation_set(&owner, true).await.unwrap();
    assert!(store.server_settings_get(&owner).await.unwrap().open_org_creation);
    assert!(store.can_create_org(&member.ctx()).await.unwrap());
    let org = store.org_create(&member.ctx(), "Mine").await.unwrap();
    assert_eq!(store.org_role(&org.id, &member.id).await.unwrap(), Some(OrgRole::Owner));
    assert_eq!(store.org_create(&member.ctx(), "Two").await.unwrap_err(), AccessError::OrgLimit);

    // Off again: the org stays, the person still cannot make a second, and an
    // admin without the switch is refused as before.
    store.open_org_creation_set(&owner, false).await.unwrap();
    assert_eq!(store.org_role(&org.id, &member.id).await.unwrap(), Some(OrgRole::Owner));
    assert_eq!(store.org_create(&member.ctx(), "Two").await.unwrap_err(), AccessError::OrgLimit);
    assert_eq!(store.org_create(&admin.ctx(), "A").await.unwrap_err(), AccessError::Forbidden);
    assert!(!store.can_create_org(&admin.ctx()).await.unwrap());
    assert_eq!(count(&store, "SELECT count(*) FROM audit WHERE action='server.open_org_creation_changed' AND org_id IS NULL").await, 2);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn the_owner_lists_orgs_but_cannot_read_the_members_of_one_they_are_not_in() {
    let store = test_store().await;
    let owner = test_user(&store, "o@x.com", ServerRole::Owner).await;
    let admin = test_user(&store, "a@x.com", ServerRole::Admin).await;
    let member = test_user(&store, "m@x.com", ServerRole::Member).await;
    store.create_orgs_set(&owner.ctx(), &admin.id, true).await.unwrap();
    let org = store.org_create(&fresh(&store, &admin.id).await, "Theirs").await.unwrap();

    let list = store.server_orgs_list(&owner.ctx()).await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, org.id);
    assert_eq!(list[0].created_by.as_deref(), Some("a@x.com"));
    assert_eq!(list[0].owners, ["a@x.com"]);
    assert_eq!(list[0].member_count, 1);
    assert_eq!(store.server_orgs_list(&admin.ctx()).await.unwrap_err(), AccessError::Forbidden);
    assert_eq!(store.server_orgs_list(&member.ctx()).await.unwrap_err(), AccessError::Forbidden);
    // Being the server owner is not membership.
    assert_eq!(store.org_role(&org.id, &owner.id).await.unwrap(), None);
}
