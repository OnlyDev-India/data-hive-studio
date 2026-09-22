//! The OAuth entry routes (spec 0010, AC-1, AC-3): everything a request can
//! be refused for before a provider round trip is ever made. `exchange_code`
//! itself needs a live provider and is out of scope here — the happy path
//! through `auth_callback` is exercised indirectly by `session_tests.rs`'s
//! `/auth/exchange` and `/auth/claim` tests, which start from an
//! already-issued login code.

use dh_server_client::auth::pkce_pair;
use crate::gateway::Gateway;
use crate::store::{test_store, Store};
use reqwest::{header, Client, Response, StatusCode};
use std::sync::Arc;

async fn serve(store: Store) -> String {
    let app = super::super::build_router(Arc::new(Gateway::new(store)));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    base
}

async fn body(r: Response) -> String {
    r.text().await.unwrap()
}

/// A cookie value shaped like `auth_start` writes it: `csrf:challenge:next`.
fn state_cookie(csrf: &str, challenge: &str, next: &str) -> String {
    format!("dh_oauth_state={csrf}:{challenge}:{next}")
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn start_refuses_an_unconfigured_provider_before_anything_else() {
    // "microsoft" is never in provider_config's match arms, so this is 404
    // regardless of the environment's own OAuth credentials and regardless
    // of next/code_challenge, which proves the provider check runs first.
    let store = test_store().await;
    let base = serve(store).await;
    let http = Client::new();

    let r = http
        .get(format!(
            "{base}/auth/microsoft/start?next=https://evil.example&code_challenge=short"
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NOT_FOUND);
    assert!(
        r.headers()
            .get_all(header::SET_COOKIE)
            .iter()
            .next()
            .is_none(),
        "no state cookie is set"
    );
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn callback_without_a_state_cookie_is_refused() {
    let store = test_store().await;
    let base = serve(store).await;
    let http = Client::new();

    let r = http
        .get(format!("{base}/auth/google/callback?code=c&state=s"))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    assert!(body(r).await.contains("missing oauth state cookie"));
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn callback_with_a_malformed_cookie_is_refused() {
    let store = test_store().await;
    let base = serve(store).await;
    let http = Client::new();

    let r = http
        .get(format!("{base}/auth/google/callback?code=c&state=s"))
        .header(header::COOKIE, "dh_oauth_state=onlyonepart")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    assert!(body(r).await.contains("malformed oauth state cookie"));
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn callback_checks_csrf_before_trusting_the_cookies_next() {
    let store = test_store().await;
    let base = serve(store).await;
    let http = Client::new();
    let (_, challenge) = pkce_pair();

    let r = http
        .get(format!(
            "{base}/auth/google/callback?code=c&state=wrong-csrf"
        ))
        .header(
            header::COOKIE,
            state_cookie("right-csrf", &challenge, "http://127.0.0.1:1/callback"),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    assert!(body(r).await.contains("oauth state mismatch"));
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn callback_rechecks_next_from_the_cookie_not_just_at_start() {
    // AC-3: the browser owns the cookie, so a forged one naming a
    // disallowed next is refused here too, even with a matching csrf.
    let store = test_store().await;
    let base = serve(store).await;
    let http = Client::new();
    let (_, challenge) = pkce_pair();

    let r = http
        .get(format!("{base}/auth/google/callback?code=c&state=csrf1"))
        .header(
            header::COOKIE,
            state_cookie("csrf1", &challenge, "https://evil.example"),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    assert!(body(r)
        .await
        .contains("next is not an allowed return address"));
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn callback_rechecks_the_pkce_challenge_from_the_cookie() {
    let store = test_store().await;
    let base = serve(store).await;
    let http = Client::new();

    let r = http
        .get(format!("{base}/auth/google/callback?code=c&state=csrf1"))
        .header(
            header::COOKIE,
            state_cookie("csrf1", "too-short", "http://127.0.0.1:1/callback"),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    assert!(body(r)
        .await
        .contains("next is not an allowed return address"));
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn callback_with_a_valid_cookie_reaches_the_provider_check() {
    // Everything before the provider round trip passes, so an unconfigured
    // provider is the very next and only refusal — no network call is made.
    let store = test_store().await;
    let base = serve(store).await;
    let http = Client::new();
    let (_, challenge) = pkce_pair();

    let r = http
        .get(format!("{base}/auth/microsoft/callback?code=c&state=csrf1"))
        .header(
            header::COOKIE,
            state_cookie("csrf1", &challenge, "http://127.0.0.1:1/callback"),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::NOT_FOUND);
    // auth_callback's 404 path returns directly, before finish() would clear
    // the state cookie — only the outcomes routed through finish() do that.
    assert!(r
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .next()
        .is_none());
    assert!(body(r).await.contains("microsoft"));
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn providers_lists_only_configured_ones_and_never_errors() {
    let store = test_store().await;
    let base = serve(store).await;
    let http = Client::new();

    let r = http
        .get(format!("{base}/auth/providers"))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let providers: Vec<String> = r.json().await.unwrap();
    assert!(providers.iter().all(|p| p == "google" || p == "github"));
}
