use sqlx::Row;
use super::*;
use dh_server_client::crypto;
use crate::server::store::Store;

fn input(name: &str, pw: &str) -> ConnInput {
    ConnInput {
        name: name.into(),
        kind: DbKind::Postgres,
        host: "db.internal".into(),
        port: 5432,
        user: "alice".into(),
        password: Some(pw.into()),
        database: "appdb".into(),
        ssl_mode: Some("require".into()),
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

/// Sets up a store with one org + one user, returning `(store, org_id, user_id)`.
async fn org_and_user(store: &Store) -> (String, String) {
    let user = crate::server::store::test_user(store, "a@x.com", crate::server::auth::ServerRole::Member).await;
    let org = store.org_create("Acme", &user.id).await.unwrap();
    (org.id, user.id)
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see server::store::test_store"]
async fn add_list_update_archive() {
    let store = super::super::store::test_store().await;
    let (org_id, user_id) = org_and_user(&store).await;
    let meta = store.conn_add(&org_id, &input("prod", "s3cret"), &user_id).await.unwrap();

    // Metadata must never contain the secret.
    let listed = store.conn_list_active(&org_id).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, meta.id);
    assert!(!serde_json::to_string(&listed).unwrap().contains("s3cret"));

    // Secret roundtrips through encryption with correct params.
    let params = pg_password_and_host(&store, &meta.id).await;
    assert_eq!(params.0, "s3cret");
    assert_eq!(params.1, "db.internal");

    // Update without password keeps the stored one.
    let mut edit = input("prod-renamed", "");
    edit.password = None;
    let updated = store.conn_update(&meta.id, &edit).await.unwrap();
    assert_eq!(updated.name, "prod-renamed");
    assert_eq!(updated.kind, DbKind::Postgres);
    assert!(pg_password_and_host(&store, &meta.id).await.0 == "s3cret");

    // Update WITH password rotates it.
    let mut rotate = edit.clone();
    rotate.password = Some("newpw".into());
    store.conn_update(&meta.id, &rotate).await.unwrap();
    assert!(pg_password_and_host(&store, &meta.id).await.0 == "newpw");

    // Archive hides from listing but secret stays intact internally.
    store.conn_archive(&meta.id).await.unwrap();
    assert!(store.conn_list_active(&org_id).await.unwrap().is_empty());
    assert_eq!(pg_password_and_host(&store, &meta.id).await.0, "newpw");
    assert_eq!(store.conn_get(&meta.id).await.unwrap().unwrap().name, "prod-renamed");
}

/// Unwrap `conn_secret_params`'s Postgres variant (every test connection
/// here is Postgres) into (password, host) for easy assertions.
async fn pg_password_and_host(store: &Store, id: &str) -> (String, String) {
    match store.conn_secret_params(id).await.unwrap() {
        AdapterParams::Postgres(p) => (p.password, p.host),
        AdapterParams::Mongodb(_) => panic!("expected Postgres params"),
    }
}

/// Mongo's auth_db/srv/tls/retry_writes/replica_set must round-trip
/// through storage — these are the fields `conn_secret_params` used to
/// hardcode to None/false/false for every Mongo shared connection
/// regardless of what was stored. `retry_writes`/`replica_set` are the
/// two fields a real Amazon DocumentDB cluster needs set.
#[tokio::test]
#[ignore = "requires a live Postgres test database — see server::store::test_store"]
async fn mongo_auth_db_srv_tls_round_trip() {
    let store = super::super::store::test_store().await;
    let (org_id, user_id) = org_and_user(&store).await;
    let input = ConnInput {
        name: "mongo-prod".into(),
        kind: DbKind::Mongodb,
        host: "cluster0.mongodb.net".into(),
        port: 27017,
        user: "mongo-user".into(),
        password: Some("mongo-pw".into()),
        database: "app".into(),
        ssl_mode: None,
        auth_db: Some("admin".into()),
        srv: true,
        tls: true,
        ssl_ca_file: None,
        ssl_client_cert_file: None,
        ssl_client_key_file: None,
        retry_writes: true,
        replica_set: Some("rs0".into()),
        pool_max: Some(20),
        pool_min: Some(2),
        connect_timeout_secs: Some(15),
        idle_timeout_secs: Some(120),
        max_lifetime_secs: None,
        server_selection_timeout_secs: Some(45),
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_auth_mode: None,
        ssh_key_file: None,
        ssh_host_key_fingerprint: None,
        ssh_password: None,
        ssh_key_passphrase: None,
    };
    let meta = store.conn_add(&org_id, &input, &user_id).await.unwrap();
    assert_eq!(meta.kind, DbKind::Mongodb);
    assert_eq!(meta.auth_db.as_deref(), Some("admin"));
    assert!(meta.srv);
    assert!(meta.tls);
    assert!(meta.retry_writes);
    assert_eq!(meta.replica_set.as_deref(), Some("rs0"));
    assert_eq!(meta.pool_max, Some(20));
    assert_eq!(meta.pool_min, Some(2));
    assert_eq!(meta.connect_timeout_secs, Some(15));
    assert_eq!(meta.idle_timeout_secs, Some(120));
    assert_eq!(meta.max_lifetime_secs, None);
    assert_eq!(meta.server_selection_timeout_secs, Some(45));

    match store.conn_secret_params(&meta.id).await.unwrap() {
        AdapterParams::Mongodb(p) => {
            assert_eq!(p.password, "mongo-pw");
            assert_eq!(p.auth_db.as_deref(), Some("admin"));
            assert!(p.srv);
            assert!(p.tls);
            assert_eq!(p.retry_writes, Some(false));
            assert_eq!(p.replica_set.as_deref(), Some("rs0"));
            assert_eq!(p.pool_max, Some(20));
            assert_eq!(p.pool_min, Some(2));
            assert_eq!(p.connect_timeout_secs, Some(15));
            assert_eq!(p.server_selection_timeout_secs, Some(45));
            assert_eq!(p.max_idle_time_secs, Some(120));
        }
        AdapterParams::Postgres(_) => panic!("expected Mongodb params"),
    }

    // conn_get (metadata-only path) also carries the flags.
    let fetched = store.conn_get(&meta.id).await.unwrap().unwrap();
    assert!(fetched.srv && fetched.tls);
}

/// `kind: DbKind::DocumentDb` must round-trip through storage as its own
/// value (not silently collapse to Mongodb) AND still dispatch to the
/// Mongo adapter — the whole point of keeping it a separate `DbKind`
/// variant instead of a sidecar flag.
#[tokio::test]
#[ignore = "requires a live Postgres test database — see server::store::test_store"]
async fn document_db_kind_round_trips_and_dispatches_to_mongo() {
    let store = super::super::store::test_store().await;
    let (org_id, user_id) = org_and_user(&store).await;
    let mut input = input("docdb-prod", "docdb-pw");
    input.kind = DbKind::DocumentDb;
    input.host = "my-cluster.us-east-1.docdb.amazonaws.com".into();
    input.port = 27017;
    input.retry_writes = true;
    input.replica_set = Some("rs0".into());

    let meta = store.conn_add(&org_id, &input, &user_id).await.unwrap();
    assert_eq!(meta.kind, DbKind::DocumentDb);

    let fetched = store.conn_get(&meta.id).await.unwrap().unwrap();
    assert_eq!(fetched.kind, DbKind::DocumentDb);

    match store.conn_secret_params(&meta.id).await.unwrap() {
        AdapterParams::Mongodb(p) => assert_eq!(p.host, input.host),
        AdapterParams::Postgres(_) => {
            panic!("DocumentDb kind should dispatch to the Mongo adapter")
        }
    }
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see server::store::test_store"]
async fn missing_and_wrong_key() {
    let store = super::super::store::test_store().await;
    assert_eq!(
        store.conn_secret_params("nope").await.err().unwrap(),
        super::ERR_NOT_FOUND
    );

    let other = super::super::store::test_store().await;
    let (org_id, user_id) = org_and_user(&other).await;
    // Same store instance, but with a different in-memory master_key —
    // simulates a mismatched DH_MASTER_KEY deployment.
    let mut other = other;
    other.master_key = [9u8; 32];
    let meta = other.conn_add(&org_id, &input("x", "pw"), &user_id).await.unwrap();

    let raw: Vec<u8> = sqlx::query("SELECT password_enc FROM connections WHERE id=$1")
        .bind(&meta.id)
        .fetch_one(&other.pool)
        .await
        .unwrap()
        .get("password_enc");
    assert!(crypto::decrypt(&[1u8; 32], &raw).is_err());
}

/// SSH secrets (password + key passphrase) round-trip through storage,
/// a "keep existing" update leaves an un-provided one intact, and
/// disabling the tunnel (ssh_host: None) clears both.
#[tokio::test]
#[ignore = "requires a live Postgres test database — see server::store::test_store"]
async fn ssh_secrets_round_trip_and_clear() {
    let store = super::super::store::test_store().await;
    let (org_id, user_id) = org_and_user(&store).await;

    let mut with_ssh = input("via-bastion", "dbpw");
    with_ssh.ssh_host = Some("bastion.internal".into());
    with_ssh.ssh_port = Some(2222);
    with_ssh.ssh_user = Some("tunnel".into());
    with_ssh.ssh_auth_mode = Some("password".into());
    with_ssh.ssh_password = Some("sshpw".into());
    let meta = store.conn_add(&org_id, &with_ssh, &user_id).await.unwrap();
    assert_eq!(meta.ssh_host.as_deref(), Some("bastion.internal"));
    assert_eq!(meta.ssh_port, Some(2222));

    let ssh_of = |ap: AdapterParams| match ap {
        AdapterParams::Postgres(p) => p.ssh.expect("ssh config"),
        AdapterParams::Mongodb(_) => panic!("expected Postgres params"),
    };
    let ssh = ssh_of(store.conn_secret_params(&meta.id).await.unwrap());
    assert_eq!(ssh.host, "bastion.internal");
    assert_eq!(ssh.password.as_deref(), Some("sshpw"));
    assert_eq!(ssh.key_passphrase, None);

    // Update without touching ssh_password keeps the stored one.
    let mut keep = with_ssh.clone();
    keep.ssh_password = None;
    keep.ssh_key_file = Some("/home/me/.ssh/id_ed25519".into());
    store.conn_update(&meta.id, &keep).await.unwrap();
    let ssh = ssh_of(store.conn_secret_params(&meta.id).await.unwrap());
    assert_eq!(ssh.password.as_deref(), Some("sshpw"));
    assert_eq!(ssh.key_file.as_deref(), Some("/home/me/.ssh/id_ed25519"));

    // Disabling the tunnel drops the stored secrets entirely.
    let mut disabled = keep.clone();
    disabled.ssh_host = None;
    let updated = store.conn_update(&meta.id, &disabled).await.unwrap();
    assert_eq!(updated.ssh_host, None);
    match store.conn_secret_params(&meta.id).await.unwrap() {
        AdapterParams::Postgres(p) => assert!(p.ssh.is_none()),
        AdapterParams::Mongodb(_) => panic!("expected Postgres params"),
    }
}
