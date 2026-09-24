use super::*;
use crate::store::test_store;
use dh_server_client::auth::{AccessError, AuthCtx, ServerRole};

async fn user(store: &Store, email: &str) -> String {
    crate::store::test_user(store, email, ServerRole::Member).await.id
}

/// A server owner may create any number of orgs; these tests are about the
/// org, not about who may create it (see `create_tests.rs`).
async fn creator(store: &Store, email: &str) -> AuthCtx {
    crate::store::test_user(store, email, ServerRole::Owner).await.ctx()
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn create_org_makes_creator_owner() {
    let store = test_store().await;
    let alice_ctx = creator(&store, "alice").await;
    let alice = alice_ctx.user_id.clone();
    let org = store.org_create(&alice_ctx, "Acme Inc").await.unwrap();
    assert_eq!(org.slug, "acme-inc");
    assert_eq!(store.org_role(&org.id, &alice).await.unwrap(), Some(OrgRole::Owner));
    let members = store.org_members(&org.id).await.unwrap();
    assert_eq!(members.len(), 1);
    assert_eq!(members[0].role, OrgRole::Owner);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn slug_collision_gets_suffixed() {
    let store = test_store().await;
    let alice_ctx = creator(&store, "alice").await;
    let o1 = store.org_create(&alice_ctx, "Acme").await.unwrap();
    let o2 = store.org_create(&alice_ctx, "Acme").await.unwrap();
    assert_eq!(o1.slug, "acme");
    assert_eq!(o2.slug, "acme-1");
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn invite_lifecycle_and_limits() {
    let store = test_store().await;
    let alice_ctx = creator(&store, "alice").await;
    let bob = user(&store, "bob").await;
    let org = store.org_create(&alice_ctx, "Acme").await.unwrap();

    let invite =
        store.link_create(&alice_ctx, &org.id, 1, 7).await.unwrap();
    assert_eq!(store.orgs_for_user(&bob).await.unwrap().len(), 0);

    let joined = store.link_redeem(&invite.code, &bob).await.unwrap();
    assert_eq!(joined.id, org.id);
    assert_eq!(store.org_role(&org.id, &bob).await.unwrap(), Some(OrgRole::Member));

    // max_uses of 1 already consumed — a second redemption fails.
    let carol = user(&store, "carol").await;
    assert_eq!(
        store.link_redeem(&invite.code, &carol).await.err().unwrap(),
        ERR_INVITE_INVALID
    );

    // Unknown code.
    assert_eq!(
        store.link_redeem("does-not-exist", &carol).await.err().unwrap(),
        ERR_INVITE_INVALID
    );
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn last_owner_cannot_be_demoted_or_removed() {
    let store = test_store().await;
    let alice_ctx = creator(&store, "alice").await;
    let alice = alice_ctx.user_id.clone();
    let org = store.org_create(&alice_ctx, "Acme").await.unwrap();

    assert_eq!(
        store.org_member_set_role(&alice_ctx, &org.id, &alice, OrgRole::Admin).await.err().unwrap(),
        AccessError::LastOwner
    );
    assert_eq!(store.org_member_remove(&alice_ctx, &org.id, &alice).await.err().unwrap(), AccessError::LastOwner);

    // A second owner makes demoting/removing the first one fine. A
    // shareable link only ever grants `member` (spec 0011, AC-8), so
    // join as member and promote.
    let bob = user(&store, "bob").await;
    let invite =
        store.link_create(&alice_ctx, &org.id, 100, 7).await.unwrap();
    store.link_redeem(&invite.code, &bob).await.unwrap();
    store.org_member_set_role(&alice_ctx, &org.id, &bob, OrgRole::Owner).await.unwrap();
    store.org_member_set_role(&alice_ctx, &org.id, &alice, OrgRole::Admin).await.unwrap();
    assert_eq!(store.org_role(&org.id, &alice).await.unwrap(), Some(OrgRole::Admin));
}
