//! Shareable links (spec 0011, AC-8, AC-14).

use super::*;
use crate::store::{test_store, test_user};
use dh_server_client::auth::{AccessError, AuthCtx, ServerRole};

async fn count(store: &Store, sql: &str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(&store.pool).await.unwrap()
}

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

async fn person(fx: &Fx, email: &str) -> String {
    test_user(&fx.store, email, ServerRole::Member).await.id
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn a_link_is_bounded_member_only_and_managed_by_owners_and_admins() {
    let fx = fixture().await;
    for (uses, days) in [(0, 7), (101, 7), (5, 0), (5, 3), (5, 365)] {
        assert!(
            matches!(fx.store.link_create(&fx.owner, &fx.org.id, uses, days).await, Err(AccessError::BadRequest(_))),
            "{uses} uses, {days} days"
        );
    }
    let link = fx.store.link_create(&fx.owner, &fx.org.id, 100, 30).await.unwrap();
    assert_eq!((link.role, link.max_uses, link.uses_count), (OrgRole::Member, 100, 0));
    assert_eq!(link.code.len(), 24, "12 random bytes as hex");
    assert!(link.expires_ms > link.created_ms + 29 * 24 * 60 * 60 * 1000);
    let stored: String = sqlx::query_scalar("SELECT role FROM org_invites WHERE code=$1").bind(&link.code).fetch_one(&fx.store.pool).await.unwrap();
    assert_eq!(stored, "member");

    // A plain member and an outsider cannot create, list or revoke; an admin can.
    let member = person(&fx, "m@x.com").await;
    fx.store.link_redeem(&link.code, &member).await.unwrap();
    let member_ctx = fx.store.user_get(&member).await.unwrap().unwrap().ctx();
    let outsider = test_user(&fx.store, "out@x.com", ServerRole::Member).await.ctx();
    for who in [&member_ctx, &outsider] {
        assert_eq!(fx.store.link_create(who, &fx.org.id, 5, 7).await.unwrap_err(), AccessError::Forbidden);
        assert_eq!(fx.store.links_for_org(who, &fx.org.id).await.unwrap_err(), AccessError::Forbidden);
        assert_eq!(fx.store.link_revoke(who, &fx.org.id, &link.code).await.unwrap_err(), AccessError::Forbidden);
    }
    fx.store.org_member_set_role(&fx.owner, &fx.org.id, &member, OrgRole::Admin).await.unwrap();
    let admin_ctx = fx.store.user_get(&member).await.unwrap().unwrap().ctx();
    let second = fx.store.link_create(&admin_ctx, &fx.org.id, 5, 7).await.unwrap();
    assert_eq!(fx.store.links_for_org(&admin_ctx, &fx.org.id).await.unwrap().len(), 2);
    fx.store.link_revoke(&admin_ctx, &fx.org.id, &second.code).await.unwrap();
    assert_eq!(fx.store.link_revoke(&admin_ctx, &fx.org.id, &second.code).await.unwrap_err(), AccessError::NotFound);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn a_wrong_revoked_expired_and_used_up_link_all_answer_the_same() {
    let fx = fixture().await;
    let who = person(&fx, "who@x.com").await;
    let revoked = fx.store.link_create(&fx.owner, &fx.org.id, 5, 7).await.unwrap();
    fx.store.link_revoke(&fx.owner, &fx.org.id, &revoked.code).await.unwrap();
    let expired = fx.store.link_create(&fx.owner, &fx.org.id, 5, 7).await.unwrap();
    sqlx::query("UPDATE org_invites SET expires_ms=1 WHERE code=$1").bind(&expired.code).execute(&fx.store.pool).await.unwrap();
    let used_up = fx.store.link_create(&fx.owner, &fx.org.id, 1, 7).await.unwrap();
    fx.store.link_redeem(&used_up.code, &person(&fx, "first@x.com").await).await.unwrap();

    for code in ["not-a-code", revoked.code.as_str(), expired.code.as_str(), used_up.code.as_str()] {
        assert_eq!(fx.store.link_redeem(code, &who).await.unwrap_err(), ERR_INVITE_INVALID, "{code}");
    }
    assert_eq!(fx.store.org_role(&fx.org.id, &who).await.unwrap(), None);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn someone_already_in_the_org_spends_no_use_and_keeps_their_role() {
    let fx = fixture().await;
    let link = fx.store.link_create(&fx.owner, &fx.org.id, 1, 7).await.unwrap();
    // The owner redeems their own org's link: nothing spent, still the owner.
    let org = fx.store.link_redeem(&link.code, &fx.owner.user_id).await.unwrap();
    assert_eq!(org.id, fx.org.id);
    assert_eq!(fx.store.org_role(&fx.org.id, &fx.owner.user_id).await.unwrap(), Some(OrgRole::Owner));
    assert_eq!(count(&fx.store, "SELECT uses_count::bigint FROM org_invites").await, 0);
    // The one use is still there for a newcomer.
    fx.store.link_redeem(&link.code, &person(&fx, "new@x.com").await).await.unwrap();
    assert_eq!(count(&fx.store, "SELECT uses_count::bigint FROM org_invites").await, 1);
    assert_eq!(count(&fx.store, "SELECT count(*) FROM audit WHERE action='org.link_redeemed' AND org_id IS NOT NULL").await, 1);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn simultaneous_redemptions_never_pass_the_limit() {
    let fx = fixture().await;
    let link = fx.store.link_create(&fx.owner, &fx.org.id, 3, 7).await.unwrap();
    let mut people = Vec::new();
    for i in 0..10 {
        people.push(person(&fx, &format!("p{i}@x.com")).await);
    }
    let tasks: Vec<_> = people
        .iter()
        .map(|p| {
            let (store, code, p) = (fx.store.clone(), link.code.clone(), p.clone());
            tokio::spawn(async move { store.link_redeem(&code, &p).await })
        })
        .collect();
    let mut results = Vec::new();
    for t in tasks {
        results.push(t.await.unwrap());
    }
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 3, "exactly the limit gets in");
    assert_eq!(count(&fx.store, "SELECT uses_count::bigint FROM org_invites").await, 3);
    assert_eq!(count(&fx.store, "SELECT count(*) FROM org_members WHERE role='member'").await, 3);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn the_code_never_appears_in_an_audit_row() {
    let fx = fixture().await;
    let link = fx.store.link_create(&fx.owner, &fx.org.id, 5, 7).await.unwrap();
    fx.store.link_redeem(&link.code, &person(&fx, "j@x.com").await).await.unwrap();
    fx.store.link_revoke(&fx.owner, &fx.org.id, &link.code).await.unwrap();
    let actions: Vec<String> =
        sqlx::query_scalar("SELECT action FROM audit WHERE action LIKE 'org.link_%' ORDER BY id").fetch_all(&fx.store.pool).await.unwrap();
    assert_eq!(actions, ["org.link_created", "org.link_redeemed", "org.link_revoked"]);
    let leaked = count(
        &fx.store,
        &format!(
            "SELECT count(*) FROM audit WHERE target LIKE '%{c}%' OR detail LIKE '%{c}%' OR action LIKE '%{c}%'",
            c = link.code
        ),
    )
    .await;
    assert_eq!(leaked, 0, "no audit row holds the link code");
}
