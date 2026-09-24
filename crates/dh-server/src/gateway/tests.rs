use super::*;
use dh_server_client::orgs::OrgRole;
use dh_server_client::vault::ConnInput;
use dh_server_client::auth::{AuthCtx, ServerRole};
use crate::store::{test_store, test_user};

fn input() -> ConnInput {
    ConnInput {
        name: "gw".into(),
        kind: dh_core::api::DbKind::Postgres,
        host: "127.0.0.1".into(),
        port: 1, // nothing listens here; connect must fail cleanly
        user: "u".into(),
        password: Some("p".into()),
        database: "d".into(),
        ssl_mode: None,
        auth_db: None,
        srv: false,
        tls: false,
        ssl_ca_file: None,
        ssl_client_cert_file: None,
        ssl_client_key_file: None,
        retry_writes: false,
        replica_set: None,
        pool_max: None,
        pool_min: None,
        connect_timeout_secs: None,
        idle_timeout_secs: None,
        max_lifetime_secs: None,
        server_selection_timeout_secs: None,
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_auth_mode: None,
        ssh_key_file: None,
        ssh_host_key_fingerprint: None,
        ssh_password: None,
        ssh_key_passphrase: None,
    }
}

async fn owner_and_org(store: &Store) -> (AuthCtx, String) {
    // Unique subject/email per call — tests create several orgs (each
    // with its own owner) in one run, and `users.email` is UNIQUE.
    let sub = format!("owner-{}", uuid::Uuid::new_v4());
    let email = format!("{sub}@x.com");
    let user = test_user(store, &email, ServerRole::Owner).await;
    let org = store.org_create(&user.ctx(), "Acme").await.unwrap();
    (user.ctx(), org.id)
}

async fn member_of(store: &Store, org_id: &str, role: OrgRole) -> AuthCtx {
    let sub = format!("member-{}", uuid::Uuid::new_v4());
    let email = format!("{sub}@x.com");
    let user = test_user(store, &email, ServerRole::Member).await;
    let owner = store.org_members(org_id).await.unwrap();
    let owner_id = owner.iter().find(|m| m.role == OrgRole::Owner).unwrap().user_id.clone();
    // A shareable link only ever grants `member` (spec 0011, AC-8); promote
    // afterward for a test that needs an admin or owner.
    let owner_ctx = store.user_get(&owner_id).await.unwrap().unwrap().ctx();
    let invite = store.link_create(&owner_ctx, org_id, 100, 7).await.unwrap();
    store.link_redeem(&invite.code, &user.id).await.unwrap();
    if role != OrgRole::Member {
        store.org_member_set_role(&owner_ctx, org_id, &user.id, role).await.unwrap();
    }
    user.ctx()
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn authorization_gates() {
    let store = test_store().await;
    let gw = Gateway::new(store.clone());
    let (owner, org_id) = owner_and_org(&store).await;
    let meta = gw.create_connection(&owner, &org_id, input()).await.unwrap();

    // Owner passes even against a dead adapter (that fails later, not at authz).
    let err = gw.execute_op(&owner, &meta.id, None, None, &read_op()).await.err().unwrap();
    assert!(!err.contains(ERR_FORBIDDEN), "owner should pass authz");

    // Someone from a DIFFERENT org (not a member at all) is forbidden outright.
    let outsider_store = test_store().await;
    let _ = outsider_store; // separate schema; just need a non-member ctx below
    let (_other_owner, other_org) = owner_and_org(&store).await;
    let outsider = member_of(&store, &other_org, OrgRole::Owner).await;
    let err = gw.list_tables(&outsider, &meta.id).await.err().unwrap();
    assert_eq!(err, ERR_FORBIDDEN);

    // A Member gets read+write by default but not delete.
    let member = member_of(&store, &org_id, OrgRole::Member).await;
    let edited = gw.update_conn_details(&member, &meta.id, input()).await.unwrap();
    assert_eq!(edited.name, "gw");
    assert_eq!(gw.delete_connection(&member, &meta.id).await.err().unwrap(), ERR_FORBIDDEN);

    // A grant override can restrict a Member to read only (there is no
    // read-only org role anymore — see spec 0011).
    let restricted = member_of(&store, &org_id, OrgRole::Member).await;
    store.grant_upsert(&meta.id, &restricted.user_id, true, false, false).await.unwrap();
    let err = gw.run_sql(&restricted, &meta.id, None, None, "SELECT 1").await.err().unwrap();
    assert_eq!(err, ERR_READONLY);
    let err3 = gw.execute_op(&restricted, &meta.id, None, None, &read_op()).await.err().unwrap();
    assert!(!err3.contains(ERR_FORBIDDEN) && !err3.contains(ERR_READONLY));

    // An explicit grant override can also lift a Member above their role default.
    store.grant_upsert(&meta.id, &restricted.user_id, true, true, true).await.unwrap();
    gw.delete_connection(&restricted, &meta.id).await.unwrap();
    assert!(gw.visible_connections(&owner, &org_id).await.unwrap().is_empty());
}

fn read_op() -> dh_core::api::QueryOp {
    serde_json::from_str(r#"{"kind":"select","table":"t","limit":5}"#).unwrap()
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn visibility_filtering() {
    let store = test_store().await;
    let gw = Gateway::new(store.clone());
    let (owner, org_id) = owner_and_org(&store).await;
    let m1 = gw.create_connection(&owner, &org_id, input()).await.unwrap();
    let _m2 = gw.create_connection(&owner, &org_id, input()).await.unwrap();

    assert_eq!(gw.visible_connections(&owner, &org_id).await.unwrap().len(), 2);

    // A fresh member sees BOTH (org-wide default access), unlike the old
    // flat per-token model where absence of a grant meant zero visibility.
    let member = member_of(&store, &org_id, OrgRole::Member).await;
    assert_eq!(gw.visible_connections(&member, &org_id).await.unwrap().len(), 2);

    // A grant override can also RESTRICT visibility below the role
    // default by dropping can_read.
    store.grant_upsert(&m1.id, &member.user_id, false, false, false).await.unwrap();
    let vis = gw.visible_connections(&member, &org_id).await.unwrap();
    assert_eq!(vis.len(), 1);
    assert!(!serde_json::to_string(&vis).unwrap().contains("password"));
}

/// A non-Postgres `kind` connection dispatches to the matching adapter
/// (`MongoAdapter::connect`, per its distinctive error text) instead of
/// always going through Postgres — the point of generalizing `pools` to
/// `Arc<dyn DbAdapter>` and matching on `AdapterParams` in `adapter()`.
#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn dispatches_by_connection_kind() {
    let store = test_store().await;
    let gw = Gateway::new(store.clone());
    let (owner, org_id) = owner_and_org(&store).await;
    let mut mongo_input = input();
    mongo_input.kind = dh_core::api::DbKind::Mongodb;
    let meta = gw.create_connection(&owner, &org_id, mongo_input).await.unwrap();
    assert_eq!(meta.kind, dh_core::api::DbKind::Mongodb);

    let err = gw.list_tables(&owner, &meta.id).await.err().unwrap();
    // Postgres's connect error never mentions "mongo" — this fails via
    // MongoAdapter::connect's own error text, confirming dispatch.
    assert!(err.contains("mongo"), "expected a Mongo connect error, got: {err}");
}

/// AC-11: removal (or leaving) cuts access on the very next request, the
/// connection leaves the person's list, and their grants on the org's
/// connections and their unused invites into the org are deleted.
#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn removal_cuts_access_at_once_and_clears_grants_and_invites() {
    let store = test_store().await;
    let gw = Gateway::new(store.clone());
    let (owner, org_id) = owner_and_org(&store).await;
    let meta = gw.create_connection(&owner, &org_id, input()).await.unwrap();
    let (_other_owner, other_org) = owner_and_org(&store).await;

    let admin = member_of(&store, &org_id, OrgRole::Admin).await;
    let leaver = member_of(&store, &org_id, OrgRole::Member).await;
    for who in [&admin, &leaver] {
        assert_eq!(gw.visible_connections(who, &org_id).await.unwrap().len(), 1);
        store.grant_upsert(&meta.id, &who.user_id, true, true, false).await.unwrap();
    }
    // The admin's unused invite into this org goes with them; the owner's stays.
    store.org_invite_create(&admin, &org_id, "pending@x.com", OrgRole::Member, Some(7)).await.unwrap();
    store.org_invite_create(&owner, &org_id, "keep@x.com", OrgRole::Member, Some(7)).await.unwrap();

    // The owner removes the admin.
    store.org_member_remove(&owner, &org_id, &admin.user_id).await.unwrap();
    assert_eq!(gw.list_tables(&admin, &meta.id).await.err().unwrap(), ERR_FORBIDDEN);
    assert_eq!(gw.run_sql(&admin, &meta.id, None, None, "SELECT 1").await.err().unwrap(), ERR_FORBIDDEN);
    assert_eq!(gw.visible_connections(&admin, &org_id).await.err().unwrap(), ERR_FORBIDDEN);
    let grants: i64 = sqlx::query_scalar("SELECT count(*) FROM connection_grants WHERE user_id=$1")
        .bind(&admin.user_id)
        .fetch_one(&store.pool)
        .await
        .unwrap();
    assert_eq!(grants, 0, "their grants went with them");
    let emails: Vec<String> = sqlx::query_scalar("SELECT email FROM server_invites WHERE org_id=$1 AND used_ms IS NULL")
        .bind(&org_id)
        .fetch_all(&store.pool)
        .await
        .unwrap();
    assert_eq!(emails, ["keep@x.com"], "only the removed person's unused invites are deleted");

    // The other person leaves on their own.
    store.org_member_remove(&leaver, &org_id, &leaver.user_id).await.unwrap();
    assert_eq!(gw.list_tables(&leaver, &meta.id).await.err().unwrap(), ERR_FORBIDDEN);

    // Re adding starts clean: back as a member, the old grant is not there.
    let back = store.org_invite_create(&owner, &org_id, "back@x.com", OrgRole::Member, Some(7)).await;
    assert!(back.is_ok());
    assert!(store.grant_for_user(&meta.id, &admin.user_id).await.unwrap().is_none());
    assert!(!store.org_members(&other_org).await.unwrap().iter().any(|m| m.user_id == admin.user_id));
}
