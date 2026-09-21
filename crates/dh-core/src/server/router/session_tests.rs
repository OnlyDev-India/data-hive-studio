//! The session routes end to end: a real server on a local port, called with
//! a real HTTP client, so headers, cookies and status codes are what a client
//! sees.

use crate::server::auth::{pkce_pair, ClaimTicket, ServerRole, VerifiedProfile};
use crate::server::gateway::Gateway;
use crate::server::store::{now_ms, test_store, test_user, Store};
use reqwest::{header, Client, Response, StatusCode};
use serde_json::{json, Value};
use std::sync::Arc;

async fn serve(store: Store) -> String {
    let app = super::super::build_router(Arc::new(Gateway::new(store)));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    base
}

async fn json_body(r: Response) -> Value {
    r.json().await.unwrap()
}

/// A login code for `user_id`, traded for a session on `platform`.
async fn exchange(store: &Store, http: &Client, base: &str, user_id: &str, device: &str, platform: &str, ua: &str) -> Response {
    let (verifier, challenge) = pkce_pair();
    let code = store.login_code_create(user_id, &challenge).await.unwrap();
    http.post(format!("{base}/auth/exchange"))
        .header(header::USER_AGENT, ua)
        .json(&json!({ "code": code, "code_verifier": verifier, "device_id": device,
                       "platform": platform, "device_name": "Ada's Mac" }))
        .send()
        .await
        .unwrap()
}

fn set_cookies(r: &Response) -> Vec<String> {
    r.headers().get_all(header::SET_COOKIE).iter().map(|v| v.to_str().unwrap().to_string()).collect()
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see server::store::test_store"]
async fn desktop_exchange_returns_both_tokens_and_no_store() {
    // AC-1, AC-13
    let store = test_store().await;
    let user = test_user(&store, "u@x.com", ServerRole::Member).await;
    let base = serve(store.clone()).await;
    let http = Client::new();

    let r = exchange(&store, &http, &base, &user.id, "dev-1", "desktop", "").await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(r.headers()[header::CACHE_CONTROL], "no-store");
    assert!(set_cookies(&r).is_empty(), "the desktop gets no cookie");
    let body = json_body(r).await;
    assert!(body["access_token"].as_str().unwrap().starts_with("dha_"));
    assert!(body["refresh_token"].as_str().unwrap().starts_with("dhr_"));
    assert_eq!(body["expires_in"], 900);
    assert_eq!(body["user"]["email"], "u@x.com");

    let me = http.get(format!("{base}/v1/me")).bearer_auth(body["access_token"].as_str().unwrap()).send().await.unwrap();
    assert_eq!(me.status(), StatusCode::OK);
    let me = json_body(me).await;
    assert_eq!(me["email"], "u@x.com");
    assert!(me.get("session_id").is_none(), "the session id is not part of the identity");
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see server::store::test_store"]
async fn refused_tokens_get_401_with_a_bearer_challenge() {
    // AC-13
    let store = test_store().await;
    let user = test_user(&store, "u@x.com", ServerRole::Member).await;
    let base = serve(store.clone()).await;
    let http = Client::new();
    let body = json_body(exchange(&store, &http, &base, &user.id, "dev-1", "desktop", "").await).await;

    for bad in ["dhs_0123456789", "nope", body["refresh_token"].as_str().unwrap()] {
        let r = http.get(format!("{base}/v1/me")).bearer_auth(bad).send().await.unwrap();
        assert_eq!(r.status(), StatusCode::UNAUTHORIZED, "{bad}");
        assert_eq!(r.headers()[header::WWW_AUTHENTICATE], "Bearer");
    }
    let none = http.get(format!("{base}/v1/me")).send().await.unwrap();
    assert_eq!(none.status(), StatusCode::UNAUTHORIZED);

    // An access token sent to /auth/refresh is refused.
    let r = http.post(format!("{base}/auth/refresh")).json(&json!({ "refresh_token": body["access_token"] })).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(r.headers()[header::WWW_AUTHENTICATE], "Bearer");
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see server::store::test_store"]
async fn exchange_input_is_checked_before_the_code_is_spent() {
    // AC-1: malformed is 400 and leaves the code alone; a wrong verifier is 401.
    let store = test_store().await;
    let user = test_user(&store, "u@x.com", ServerRole::Member).await;
    let base = serve(store.clone()).await;
    let http = Client::new();
    let (verifier, challenge) = pkce_pair();
    let code = store.login_code_create(&user.id, &challenge).await.unwrap();
    let post = |body: Value| http.post(format!("{base}/auth/exchange")).json(&body).send();

    let ok = json!({ "code": code, "code_verifier": verifier, "device_id": "d1", "platform": "desktop" });
    for bad in [
        json!({ "platform": "phone", "device_id": "d1", "code": code, "code_verifier": verifier }),
        json!({ "platform": "desktop", "device_id": "", "code": code, "code_verifier": verifier }),
        json!({ "platform": "desktop", "device_id": "has space", "code": code, "code_verifier": verifier }),
        json!({ "platform": "desktop", "device_id": "d1", "code": code, "code_verifier": "short" }),
    ] {
        assert_eq!(post(bad).await.unwrap().status(), StatusCode::BAD_REQUEST);
    }
    // Still good after all those refusals.
    let (other, _) = pkce_pair();
    let wrong = json!({ "code": code, "code_verifier": other, "device_id": "d1", "platform": "desktop" });
    assert_eq!(post(wrong).await.unwrap().status(), StatusCode::UNAUTHORIZED);
    assert_eq!(post(ok).await.unwrap().status(), StatusCode::UNAUTHORIZED, "the wrong verifier burned the code");
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see server::store::test_store"]
async fn web_session_keeps_the_renewal_token_in_an_http_only_cookie() {
    // AC-2, AC-13
    let store = test_store().await;
    let user = test_user(&store, "u@x.com", ServerRole::Member).await;
    let base = serve(store.clone()).await;
    let http = Client::new();
    let chrome = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    let r = exchange(&store, &http, &base, &user.id, "web-1", "web", chrome).await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(r.headers()[header::CACHE_CONTROL], "no-store");
    let cookies = set_cookies(&r);
    assert_eq!(cookies.len(), 1);
    let cookie = &cookies[0];
    for want in ["dh_refresh=dhr_", "Path=/auth", "HttpOnly", "SameSite=Strict", "Max-Age="] {
        assert!(cookie.contains(want), "{want} in {cookie}");
    }
    assert!(!cookie.contains("Secure"), "the default public address is plain http");
    let body = json_body(r).await;
    assert!(body.get("refresh_token").is_none(), "no renewal token in the body");
    let raw_cookie = cookie.split(';').next().unwrap().to_string();

    // The device name came from the User-Agent, not from anything the page sent.
    let list = http.get(format!("{base}/v1/me/sessions")).bearer_auth(body["access_token"].as_str().unwrap()).send().await.unwrap();
    let list = json_body(list).await;
    assert_eq!(list[0]["device_name"], "Chrome on macOS");
    assert_eq!(list[0]["platform"], "web");
    assert_eq!(list[0]["current"], true);

    // Renewal from the cookie with an empty JSON body.
    let renew = |cookie: Option<&str>, body: Value| {
        let mut req = http.post(format!("{base}/auth/refresh")).json(&body);
        if let Some(c) = cookie {
            req = req.header(header::COOKIE, c);
        }
        req.send()
    };
    let r = renew(Some(&raw_cookie), json!({})).await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let new_cookie = set_cookies(&r)[0].split(';').next().unwrap().to_string();
    assert_ne!(new_cookie, raw_cookie, "a new renewal token");
    assert!(json_body(r).await.get("refresh_token").is_none());

    // Both, or neither, is a 400.
    assert_eq!(renew(Some(&new_cookie), json!({ "refresh_token": "dhr_x" })).await.unwrap().status(), StatusCode::BAD_REQUEST);
    assert_eq!(renew(None, json!({})).await.unwrap().status(), StatusCode::BAD_REQUEST);
    // Only JSON is accepted, so a plain form post from another site cannot renew.
    let form = http.post(format!("{base}/auth/refresh")).header(header::COOKIE, &new_cookie).body("x=1").send().await.unwrap();
    assert_eq!(form.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    // A dead cookie is a 401 that also clears the cookie.
    let dead = renew(Some("dh_refresh=dhr_0000"), json!({})).await.unwrap();
    assert_eq!(dead.status(), StatusCode::UNAUTHORIZED);
    assert!(set_cookies(&dead)[0].contains("Max-Age=0"));
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see server::store::test_store"]
async fn sign_out_lists_and_ends_devices_over_http() {
    // AC-9, AC-10, AC-11
    let store = test_store().await;
    let a = test_user(&store, "a@x.com", ServerRole::Member).await;
    let b = test_user(&store, "b@x.com", ServerRole::Member).await;
    let base = serve(store.clone()).await;
    let http = Client::new();
    let a1 = json_body(exchange(&store, &http, &base, &a.id, "a1", "desktop", "").await).await;
    let a2 = json_body(exchange(&store, &http, &base, &a.id, "a2", "desktop", "").await).await;
    let b1 = json_body(exchange(&store, &http, &base, &b.id, "b1", "desktop", "").await).await;
    let tok = |v: &Value| v["access_token"].as_str().unwrap().to_string();

    let list = json_body(http.get(format!("{base}/v1/me/sessions")).bearer_auth(tok(&a1)).send().await.unwrap()).await;
    assert_eq!(list.as_array().unwrap().len(), 2);

    // B's id as A is a 404.
    let r = http.delete(format!("{base}/v1/me/sessions/{}", b1["session_id"].as_str().unwrap())).bearer_auth(tok(&a1)).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::NOT_FOUND);

    // End A's second device from the first: refused on the very next request, first untouched.
    let r = http.delete(format!("{base}/v1/me/sessions/{}", a2["session_id"].as_str().unwrap())).bearer_auth(tok(&a1)).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::NO_CONTENT);
    let gone = http.get(format!("{base}/v1/me")).bearer_auth(tok(&a2)).send().await.unwrap();
    assert_eq!(gone.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(http.get(format!("{base}/v1/me")).bearer_auth(tok(&a1)).send().await.unwrap().status(), StatusCode::OK);

    // Sign out this device, then sign out everywhere clears the cookie too.
    let a3 = json_body(exchange(&store, &http, &base, &a.id, "a3", "desktop", "").await).await;
    let r = http.post(format!("{base}/v1/auth/logout")).bearer_auth(tok(&a3)).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::NO_CONTENT);
    assert!(set_cookies(&r)[0].contains("Max-Age=0"));
    assert_eq!(http.get(format!("{base}/v1/me")).bearer_auth(tok(&a3)).send().await.unwrap().status(), StatusCode::UNAUTHORIZED);
    let r = http.delete(format!("{base}/v1/me/sessions")).bearer_auth(tok(&a1)).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::NO_CONTENT);
    assert!(set_cookies(&r)[0].contains("Max-Age=0"));
    assert_eq!(http.get(format!("{base}/v1/me")).bearer_auth(tok(&a1)).send().await.unwrap().status(), StatusCode::UNAUTHORIZED);
    // B is untouched.
    assert_eq!(http.get(format!("{base}/v1/me")).bearer_auth(tok(&b1)).send().await.unwrap().status(), StatusCode::OK);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see server::store::test_store"]
async fn only_the_owner_can_end_another_persons_sessions() {
    // AC-12
    let store = test_store().await;
    let owner = test_user(&store, "o@x.com", ServerRole::Owner).await;
    let admin = test_user(&store, "a@x.com", ServerRole::Admin).await;
    let person = test_user(&store, "p@x.com", ServerRole::Member).await;
    let base = serve(store.clone()).await;
    let http = Client::new();
    let tok = |v: &Value| v["access_token"].as_str().unwrap().to_string();
    let o = json_body(exchange(&store, &http, &base, &owner.id, "o1", "desktop", "").await).await;
    let ad = json_body(exchange(&store, &http, &base, &admin.id, "a1", "desktop", "").await).await;
    let p = json_body(exchange(&store, &http, &base, &person.id, "p1", "desktop", "").await).await;
    let url = format!("{base}/v1/admin/users/{}/sessions", person.id);

    for who in [&ad, &p] {
        let r = http.delete(&url).bearer_auth(tok(who)).send().await.unwrap();
        assert_eq!(r.status(), StatusCode::FORBIDDEN);
    }
    assert_eq!(http.get(format!("{base}/v1/me")).bearer_auth(tok(&p)).send().await.unwrap().status(), StatusCode::OK);

    let r = http.delete(&url).bearer_auth(tok(&o)).send().await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(json_body(r).await["ended"], 1);
    assert_eq!(http.get(format!("{base}/v1/me")).bearer_auth(tok(&p)).send().await.unwrap().status(), StatusCode::UNAUTHORIZED);
    let missing = http.delete(format!("{base}/v1/admin/users/nobody/sessions")).bearer_auth(tok(&o)).send().await.unwrap();
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see server::store::test_store"]
async fn claiming_a_server_signs_the_owner_in_like_an_exchange() {
    let store = test_store().await;
    let base = serve(store.clone()).await;
    let http = Client::new();
    let profile = VerifiedProfile {
        provider: "google".into(),
        subject: "sub-1".into(),
        email: "owner@x.com".into(),
        name: "Owner".into(),
        avatar_url: None,
    };
    let ticket = ClaimTicket::seal(&profile, &store.master_key, now_ms()).unwrap();
    let claim = |code: &str, platform: &str| {
        http.post(format!("{base}/auth/claim"))
            .json(&json!({ "ticket": ticket, "code": code, "device_id": "dev-1", "platform": platform }))
            .send()
    };

    // Bad device fields are refused before anything is claimed.
    assert_eq!(claim(&store.setup_code(), "phone").await.unwrap().status(), StatusCode::BAD_REQUEST);
    assert_eq!(claim("WRONG-CODE", "desktop").await.unwrap().status(), StatusCode::FORBIDDEN);

    let r = claim(&store.setup_code(), "desktop").await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(r.headers()[header::CACHE_CONTROL], "no-store");
    let body = json_body(r).await;
    assert!(body["access_token"].as_str().unwrap().starts_with("dha_"));
    assert!(body["refresh_token"].as_str().unwrap().starts_with("dhr_"));
    assert_eq!(body["user"]["server_role"], "owner");
    assert_eq!(claim(&store.setup_code(), "desktop").await.unwrap().status(), StatusCode::CONFLICT);
}
