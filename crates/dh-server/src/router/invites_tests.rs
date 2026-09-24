//! The email invite routes end to end (spec 0011, AC-4 to AC-6): a real
//! server on a local port and a real HTTP client, so status codes and
//! bodies are what a client sees.

use crate::gateway::Gateway;
use crate::store::{test_store, test_user, Store};
use dh_server_client::auth::{pkce_pair, ServerRole};
use dh_server_client::orgs::OrgRole;
use reqwest::{Client, StatusCode};
use serde_json::{json, Value};
use std::sync::Arc;

async fn serve(store: Store) -> String {
    let app = super::build_router(Arc::new(Gateway::new(store)));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    base
}

/// An access token for `user_id`, from a login code traded at `/auth/exchange`.
async fn token(store: &Store, http: &Client, base: &str, user_id: &str) -> String {
    let (verifier, challenge) = pkce_pair();
    let code = store.login_code_create(user_id, &challenge).await.unwrap();
    let body: Value = http
        .post(format!("{base}/auth/exchange"))
        .json(&json!({ "code": code, "code_verifier": verifier, "device_id": "d", "platform": "desktop", "device_name": "T" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    body["access_token"].as_str().unwrap().to_string()
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn invite_list_accept_decline_over_http() {
    let store = test_store().await;
    let owner = test_user(&store, "owner@x.com", ServerRole::Owner).await;
    let bob = test_user(&store, "bob@x.com", ServerRole::Member).await;
    let eve = test_user(&store, "eve@x.com", ServerRole::Member).await;
    let org = store.org_create(&owner.ctx(), "Acme").await.unwrap();
    let base = serve(store.clone()).await;
    let http = Client::new();
    let (t_owner, t_bob, t_eve) = (
        token(&store, &http, &base, &owner.id).await,
        token(&store, &http, &base, &bob.id).await,
        token(&store, &http, &base, &eve.id).await,
    );
    let invites = format!("{base}/v1/orgs/{}/invites", org.id);

    // Create is 201, the same email again is a 200 refresh.
    let r = http.post(&invites).bearer_auth(&t_owner).json(&json!({ "email": "Bob@x.com", "role": "admin" })).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::CREATED);
    let created: Value = r.json().await.unwrap();
    assert_eq!((created["email"].as_str(), created["role"].as_str(), created["status"].as_str()), (Some("bob@x.com"), Some("admin"), Some("open")));
    let id = created["id"].as_str().unwrap().to_string();
    let r = http.post(&invites).bearer_auth(&t_owner).json(&json!({ "email": "bob@x.com", "role": "member", "expires_days": null })).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert!(r.json::<Value>().await.unwrap()["expires_ms"].is_null(), "null means never");

    // A bad expiry is a 400, a plain member of the org and an outsider a 403.
    let r = http.post(&invites).bearer_auth(&t_owner).json(&json!({ "email": "z@x.com", "role": "member", "expires_days": 3 })).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    for t in [&t_bob, &t_eve] {
        let r = http.get(&invites).bearer_auth(t).send().await.unwrap();
        assert_eq!(r.status(), StatusCode::FORBIDDEN);
    }

    // Bob sees it; Eve sees nothing and gets the same 404 for it as for a missing id.
    let mine: Value = http.get(format!("{base}/v1/me/invites")).bearer_auth(&t_bob).send().await.unwrap().json().await.unwrap();
    assert_eq!(mine.as_array().unwrap().len(), 1);
    assert_eq!(mine[0]["org_name"], "Acme");
    assert_eq!(mine[0]["role"], "member");
    let theirs: Value = http.get(format!("{base}/v1/me/invites")).bearer_auth(&t_eve).send().await.unwrap().json().await.unwrap();
    assert!(theirs.as_array().unwrap().is_empty());
    for path in [id.as_str(), "no-such-invite"] {
        for action in ["accept", "decline"] {
            let r = http.post(format!("{base}/v1/me/invites/{path}/{action}")).bearer_auth(&t_eve).send().await.unwrap();
            assert_eq!(r.status(), StatusCode::NOT_FOUND, "{path} {action}");
        }
    }
    let r = http.post(format!("{base}/v1/me/invites/{id}/accept")).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);

    // Bob accepts: the org comes back, a retry is safe, and his role is what was last set.
    let r = http.post(format!("{base}/v1/me/invites/{id}/accept")).bearer_auth(&t_bob).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(r.json::<Value>().await.unwrap()["name"], "Acme");
    let r = http.post(format!("{base}/v1/me/invites/{id}/accept")).bearer_auth(&t_bob).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(store.org_role(&org.id, &bob.id).await.unwrap(), Some(OrgRole::Member));

    // Now he is in: inviting him again is a 409, revoking the used invite a 409.
    let r = http.post(&invites).bearer_auth(&t_owner).json(&json!({ "email": "bob@x.com", "role": "member" })).send().await.unwrap();
    assert_eq!((r.status(), r.text().await.unwrap().as_str()), (StatusCode::CONFLICT, "already_member"));
    let r = http.delete(format!("{invites}/{id}")).bearer_auth(&t_owner).send().await.unwrap();
    assert_eq!((r.status(), r.text().await.unwrap().as_str()), (StatusCode::CONFLICT, "already_used"));

    // Decline is a 204 and the invite is gone; revoke of a missing one is a 404.
    let r = http.post(&invites).bearer_auth(&t_owner).json(&json!({ "email": "eve@x.com", "role": "member" })).send().await.unwrap();
    let eve_invite = r.json::<Value>().await.unwrap()["id"].as_str().unwrap().to_string();
    let r = http.post(format!("{base}/v1/me/invites/{eve_invite}/decline")).bearer_auth(&t_eve).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::NO_CONTENT);
    let r = http.delete(format!("{invites}/{eve_invite}")).bearer_auth(&t_owner).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn expired_accept_is_a_409_and_the_old_link_routes_moved() {
    let store = test_store().await;
    let owner = test_user(&store, "owner@x.com", ServerRole::Owner).await;
    let bob = test_user(&store, "bob@x.com", ServerRole::Member).await;
    let org = store.org_create(&owner.ctx(), "Acme").await.unwrap();
    let base = serve(store.clone()).await;
    let http = Client::new();
    let (t_owner, t_bob) = (token(&store, &http, &base, &owner.id).await, token(&store, &http, &base, &bob.id).await);

    let r = http.post(format!("{base}/v1/orgs/{}/invites", org.id)).bearer_auth(&t_owner).json(&json!({ "email": "bob@x.com", "role": "member" })).send().await.unwrap();
    let id = r.json::<Value>().await.unwrap()["id"].as_str().unwrap().to_string();
    sqlx::query("UPDATE server_invites SET expires_ms=1 WHERE id=$1").bind(&id).execute(&store.pool).await.unwrap();
    let r = http.post(format!("{base}/v1/me/invites/{id}/accept")).bearer_auth(&t_bob).send().await.unwrap();
    assert_eq!((r.status(), r.text().await.unwrap().as_str()), (StatusCode::CONFLICT, "invite_expired"));

    // Shareable links live under /links now; the old redeem path is gone.
    let r = http.get(format!("{base}/v1/orgs/{}/links", org.id)).bearer_auth(&t_owner).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let r = http.post(format!("{base}/v1/invites/abc/redeem")).bearer_auth(&t_bob).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn shareable_links_over_http() {
    let store = test_store().await;
    let owner = test_user(&store, "owner@x.com", ServerRole::Owner).await;
    let bob = test_user(&store, "bob@x.com", ServerRole::Member).await;
    let eve = test_user(&store, "eve@x.com", ServerRole::Member).await;
    let org = store.org_create(&owner.ctx(), "Acme").await.unwrap();
    let base = serve(store.clone()).await;
    let http = Client::new();
    let (t_owner, t_bob, t_eve) = (
        token(&store, &http, &base, &owner.id).await,
        token(&store, &http, &base, &bob.id).await,
        token(&store, &http, &base, &eve.id).await,
    );
    let links = format!("{base}/v1/orgs/{}/links", org.id);

    // Bounds are checked: a missing or out of range limit or expiry is a 400/422, never a link.
    for body in [json!({ "max_uses": 0, "expires_days": 7 }), json!({ "max_uses": 101, "expires_days": 7 }), json!({ "max_uses": 5, "expires_days": 2 })] {
        let r = http.post(&links).bearer_auth(&t_owner).json(&body).send().await.unwrap();
        assert_eq!(r.status(), StatusCode::BAD_REQUEST, "{body}");
    }
    let r = http.post(&links).bearer_auth(&t_owner).json(&json!({ "role": "owner" })).send().await.unwrap();
    assert!(r.status().is_client_error(), "a link needs its limit and expiry");
    let r = http.post(&links).bearer_auth(&t_bob).json(&json!({ "max_uses": 5, "expires_days": 7 })).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::FORBIDDEN);

    let r = http.post(&links).bearer_auth(&t_owner).json(&json!({ "max_uses": 2, "expires_days": 7 })).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::CREATED);
    let link: Value = r.json().await.unwrap();
    let code = link["code"].as_str().unwrap().to_string();
    assert_eq!((link["role"].as_str(), link["max_uses"].as_i64(), link["uses_count"].as_i64()), (Some("member"), Some(2), Some(0)));

    // A person with no token gets no account from a link; a signed in one joins.
    let redeem = |c: &str| format!("{base}/v1/links/{c}/redeem");
    assert_eq!(http.post(redeem(&code)).send().await.unwrap().status(), StatusCode::UNAUTHORIZED);
    let r = http.post(redeem(&code)).bearer_auth(&t_bob).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(r.json::<Value>().await.unwrap()["name"], "Acme");
    assert_eq!(store.org_role(&org.id, &bob.id).await.unwrap(), Some(OrgRole::Member));
    // Bob again: fine, and no second use spent.
    assert_eq!(http.post(redeem(&code)).bearer_auth(&t_bob).send().await.unwrap().status(), StatusCode::OK);
    let list: Value = http.get(&links).bearer_auth(&t_owner).send().await.unwrap().json().await.unwrap();
    assert_eq!(list[0]["uses_count"], 1);

    // Wrong and revoked codes are the same 404, with the same body.
    let wrong = http.post(redeem("deadbeef")).bearer_auth(&t_eve).send().await.unwrap();
    let wrong_body = (wrong.status(), wrong.text().await.unwrap());
    let r = http.delete(format!("{links}/{code}")).bearer_auth(&t_owner).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::NO_CONTENT);
    let revoked = http.post(redeem(&code)).bearer_auth(&t_eve).send().await.unwrap();
    assert_eq!((revoked.status(), revoked.text().await.unwrap()), wrong_body);
    assert_eq!(wrong_body.0, StatusCode::NOT_FOUND);
    assert_eq!(store.org_role(&org.id, &eve.id).await.unwrap(), None);
    assert_eq!(http.delete(format!("{links}/{code}")).bearer_auth(&t_owner).send().await.unwrap().status(), StatusCode::NOT_FOUND);
}
