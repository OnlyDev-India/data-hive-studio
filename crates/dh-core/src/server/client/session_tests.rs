//! The client's renewal rules against a fake server: one renewal for a burst of
//! requests, one retry on a 401, and a session that survives a bad moment.

use super::*;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

#[derive(Clone, Copy, PartialEq)]
enum Refresh {
    Ok,
    Unauthorized,
    ServerError,
}

struct Fake {
    refreshes: AtomicUsize,
    me_calls: AtomicUsize,
    /// The only access token `/v1/me` accepts.
    valid_access: Mutex<String>,
    /// `/v1/me` refuses every token, however fresh.
    reject_all: AtomicBool,
    refresh: Mutex<Refresh>,
    /// Order of what happened, on the fake and the client's store together.
    events: Arc<Mutex<Vec<String>>>,
}

async fn refresh_route(State(f): State<Arc<Fake>>) -> (StatusCode, Json<serde_json::Value>) {
    // Long enough for a burst of requests to pile up behind one renewal.
    tokio::time::sleep(std::time::Duration::from_millis(60)).await;
    let n = f.refreshes.fetch_add(1, Ordering::SeqCst) + 1;
    match *f.refresh.lock().unwrap() {
        Refresh::Unauthorized => (StatusCode::UNAUTHORIZED, Json(serde_json::json!({}))),
        Refresh::ServerError => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({}))),
        Refresh::Ok => {
            let access = format!("dha_renewed{n}");
            *f.valid_access.lock().unwrap() = access.clone();
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "access_token": access, "expires_in": 900, "session_id": "s1",
                    "refresh_token": format!("dhr_renewed{n}"),
                })),
            )
        }
    }
}

async fn me_route(State(f): State<Arc<Fake>>, headers: HeaderMap) -> StatusCode {
    f.me_calls.fetch_add(1, Ordering::SeqCst);
    let sent = headers.get("authorization").and_then(|h| h.to_str().ok()).unwrap_or("");
    f.events.lock().unwrap().push(format!("me:{sent}"));
    if !f.reject_all.load(Ordering::SeqCst) && sent == format!("Bearer {}", f.valid_access.lock().unwrap()) {
        StatusCode::OK
    } else {
        StatusCode::UNAUTHORIZED
    }
}

struct RecordingStore {
    events: Arc<Mutex<Vec<String>>>,
    fail_save: bool,
}

impl TokenStore for RecordingStore {
    fn save(&self, refresh_token: &str) -> Result<(), String> {
        self.events.lock().unwrap().push(format!("save:{refresh_token}"));
        if self.fail_save {
            Err("keychain locked".into())
        } else {
            Ok(())
        }
    }
    fn clear(&self) {
        self.events.lock().unwrap().push("clear".into());
    }
}

struct Setup {
    fake: Arc<Fake>,
    base: String,
    events: Arc<Mutex<Vec<String>>>,
}

async fn fake_server(refresh: Refresh, valid_access: &str) -> Setup {
    let events = Arc::new(Mutex::new(Vec::new()));
    let fake = Arc::new(Fake {
        refreshes: AtomicUsize::new(0),
        me_calls: AtomicUsize::new(0),
        valid_access: Mutex::new(valid_access.into()),
        reject_all: AtomicBool::new(false),
        refresh: Mutex::new(refresh),
        events: events.clone(),
    });
    let app = Router::new()
        .route("/auth/refresh", post(refresh_route))
        .route("/v1/me", get(me_route))
        .with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Setup { fake, base, events }
}

/// A session signed in a moment ago with an access token that lives `expires_in` seconds.
fn session(s: &Setup, access: &str, expires_in: i64, fail_save: bool) -> Arc<SessionState> {
    let reply = SessionReply {
        access_token: access.into(),
        expires_in,
        session_id: "s1".into(),
        refresh_token: Some("dhr_first".into()),
    };
    let store = Box::new(RecordingStore { events: s.events.clone(), fail_save });
    let state = SessionState::from_reply(&s.base, &reply, store).unwrap();
    s.events.lock().unwrap().clear(); // forget the initial save
    state
}

async fn call(client: &ServerClient) -> Result<serde_json::Value, String> {
    client.empty(reqwest::Method::GET, "/v1/me").await.map(|_| serde_json::json!(null))
}

#[tokio::test]
async fn a_burst_at_the_renew_mark_renews_once() {
    // AC-4: five requests when the token has 30 seconds left cause one renewal.
    let s = fake_server(Refresh::Ok, "dha_old").await;
    let client = ServerClient::new(&s.base, session(&s, "dha_old", 30, false));
    let results = futures_util::future::join_all((0..5).map(|_| call(&client))).await;
    assert!(results.iter().all(Result::is_ok), "{results:?}");
    assert_eq!(s.fake.refreshes.load(Ordering::SeqCst), 1);
    assert_eq!(s.fake.me_calls.load(Ordering::SeqCst), 5);
    // And the next request uses the renewed token without renewing again.
    call(&client).await.unwrap();
    assert_eq!(s.fake.refreshes.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_401_renews_once_and_retries_once() {
    // AC-4: the server ended the token early. Five at once still renew once.
    let s = fake_server(Refresh::Ok, "dha_something_else").await;
    let client = ServerClient::new(&s.base, session(&s, "dha_old", 900, false));
    let results = futures_util::future::join_all((0..5).map(|_| call(&client))).await;
    assert!(results.iter().all(Result::is_ok), "{results:?}");
    assert_eq!(s.fake.refreshes.load(Ordering::SeqCst), 1, "one renewal for all five");
    assert_eq!(s.fake.me_calls.load(Ordering::SeqCst), 10, "each request tried twice, no more");
}

#[tokio::test]
async fn a_second_401_is_returned_not_looped() {
    let s = fake_server(Refresh::Ok, "dha_old").await;
    s.fake.reject_all.store(true, Ordering::SeqCst);
    let client = ServerClient::new(&s.base, session(&s, "dha_old", 900, false));
    assert!(call(&client).await.is_err());
    assert_eq!(s.fake.refreshes.load(Ordering::SeqCst), 1, "one renewal");
    assert_eq!(s.fake.me_calls.load(Ordering::SeqCst), 2, "one retry, then it stops");
}

#[tokio::test]
async fn the_renewed_token_is_saved_before_it_is_used() {
    // AC-14
    let s = fake_server(Refresh::Ok, "dha_old").await;
    let client = ServerClient::new(&s.base, session(&s, "dha_old", 30, false));
    call(&client).await.unwrap();
    let events = s.events.lock().unwrap().clone();
    assert_eq!(events, vec!["save:dhr_renewed1".to_string(), "me:Bearer dha_renewed1".to_string()]);
}

#[tokio::test]
async fn a_save_that_fails_does_not_fail_the_request() {
    let s = fake_server(Refresh::Ok, "dha_old").await;
    let store = Box::new(RecordingStore { events: s.events.clone(), fail_save: true });
    let state = SessionState::from_saved(&s.base, Some("dhr_first".into()), store);
    let client = ServerClient::new(&s.base, state.clone());
    call(&client).await.unwrap();
    assert!(state.signed_in(), "the session works for now even though it could not be saved");
}

#[tokio::test]
async fn a_bad_moment_at_the_server_does_not_sign_anyone_out() {
    // AC-15: a 5xx and an unreachable server both keep the session.
    let s = fake_server(Refresh::ServerError, "dha_old").await;
    let state = session(&s, "dha_old", 30, false);
    let client = ServerClient::new(&s.base, state.clone());
    assert!(call(&client).await.is_err());
    assert!(state.signed_in());
    assert!(!s.events.lock().unwrap().contains(&"clear".to_string()));

    let dead = SessionState::from_saved(
        "http://127.0.0.1:1",
        Some("dhr_saved".into()),
        Box::new(RecordingStore { events: s.events.clone(), fail_save: false }),
    );
    let client = ServerClient::new("http://127.0.0.1:1", dead.clone());
    let err = call(&client).await.unwrap_err();
    assert_ne!(err, ERR_SIGNED_OUT);
    assert!(dead.signed_in());
    assert!(!s.events.lock().unwrap().contains(&"clear".to_string()));
}

#[tokio::test]
async fn a_refused_renewal_signs_out_and_clears_the_saved_token() {
    // AC-15, AC-14
    let s = fake_server(Refresh::Unauthorized, "dha_old").await;
    let state = session(&s, "dha_old", 30, false);
    let client = ServerClient::new(&s.base, state.clone());
    assert_eq!(call(&client).await.unwrap_err(), ERR_SIGNED_OUT);
    assert!(!state.signed_in());
    assert_eq!(s.events.lock().unwrap().clone(), vec!["clear".to_string()]);
    // Later calls fail fast, without asking the server again.
    assert_eq!(call(&client).await.unwrap_err(), ERR_SIGNED_OUT);
    assert_eq!(s.fake.refreshes.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_saved_token_alone_renews_on_the_first_request() {
    let s = fake_server(Refresh::Ok, "dha_x").await;
    let state = SessionState::from_saved(
        &s.base,
        Some("dhr_saved".into()),
        Box::new(RecordingStore { events: s.events.clone(), fail_save: false }),
    );
    let client = ServerClient::new(&s.base, state.clone());
    call(&client).await.unwrap();
    assert_eq!(s.fake.refreshes.load(Ordering::SeqCst), 1);
    assert_eq!(state.session_id().as_deref(), Some("s1"));
}

#[tokio::test]
async fn two_clients_of_one_server_share_one_renewal() {
    // AC-14: two org profiles on one server are one device session.
    let s = fake_server(Refresh::Ok, "dha_old").await;
    let state = session(&s, "dha_old", 30, false);
    let (a, b) = (ServerClient::new(&s.base, state.clone()), ServerClient::new(&s.base, state));
    let (ra, rb) = tokio::join!(call(&a), call(&b));
    ra.unwrap();
    rb.unwrap();
    assert_eq!(s.fake.refreshes.load(Ordering::SeqCst), 1);
}
