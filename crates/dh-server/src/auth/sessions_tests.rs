use super::*;
use crate::store::{test_store, test_user};
use dh_server_client::auth::{pkce_pair, AccessError, ServerRole};

/// A fixed start time; every test moves the clock by passing a different `now`.
const T0: i64 = 1_800_000_000_000;
const SEC: i64 = 1000;
const DAY: i64 = 24 * 60 * 60 * SEC;

fn device(id: &str) -> DeviceInfo {
    DeviceInfo { device_id: id.into(), device_name: format!("Laptop {id}"), platform: dh_server_client::auth::Platform::Desktop }
}

/// Sign in the way the routes do: a login code, its verifier, then a session.
async fn sign_in(store: &Store, user_id: &str, dev: &DeviceInfo, now: i64) -> Issued {
    let (verifier, challenge) = pkce_pair();
    let code = store.login_code_create_at(user_id, &challenge, now).await.unwrap();
    let uid = store.login_code_redeem_at(&code, &verifier, now).await.unwrap();
    assert_eq!(uid, user_id);
    store.session_start_at(&uid, dev, now).await.unwrap()
}

async fn rows(store: &Store, table: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT count(*) FROM {table}")).fetch_one(&store.pool).await.unwrap()
}

async fn audit_actions(store: &Store) -> Vec<String> {
    sqlx::query_scalar("SELECT action FROM audit ORDER BY id").fetch_all(&store.pool).await.unwrap()
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn sign_in_call_renew_call() {
    // AC-1, AC-4, AC-5
    let store = test_store().await;
    let user = test_user(&store, "u@x.com", ServerRole::Member).await;
    let first = sign_in(&store, &user.id, &device("d1"), T0).await;
    assert!(first.access_token.starts_with(ACCESS_PREFIX) && first.refresh_token.starts_with(REFRESH_PREFIX));
    assert_eq!(first.expires_in, 900);

    let ctx = store.verify_access_at(&format!("Bearer {}", first.access_token), T0 + SEC).await.unwrap();
    assert_eq!((ctx.user_id.as_str(), ctx.session_id.as_str()), (user.id.as_str(), first.session_id.as_str()));
    // The bare token works too.
    assert!(store.verify_access_at(&first.access_token, T0 + SEC).await.is_some());

    let second = store.session_refresh_at(&first.refresh_token, T0 + 14 * 60 * SEC).await.unwrap();
    assert_eq!(second.session_id, first.session_id, "the same session");
    assert_ne!(second.refresh_token, first.refresh_token, "AC-5: a new renewal token");
    assert_ne!(second.access_token, first.access_token);
    // Past the first access token's 15 minutes, only the new one works.
    let later = T0 + 16 * 60 * SEC;
    assert!(store.verify_access_at(&first.access_token, later).await.is_none());
    assert!(store.verify_access_at(&second.access_token, later).await.is_some());
    // A third renewal with the newest token works, and the run of three shows the chain holds.
    let third = store.session_refresh_at(&second.refresh_token, later).await.unwrap();
    assert_ne!(third.refresh_token, second.refresh_token);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn login_code_refusals_create_no_session() {
    // AC-1
    let store = test_store().await;
    let user = test_user(&store, "u@x.com", ServerRole::Member).await;
    let (verifier, challenge) = pkce_pair();

    // Wrong verifier: refused, and the code is burned.
    let code = store.login_code_create_at(&user.id, &challenge, T0).await.unwrap();
    let (other, _) = pkce_pair();
    assert_eq!(store.login_code_redeem_at(&code, &other, T0).await, Err(AuthError::Unauthorized));
    assert_eq!(store.login_code_redeem_at(&code, &verifier, T0).await, Err(AuthError::Unauthorized));

    // Second use of a good code.
    let code = store.login_code_create_at(&user.id, &challenge, T0).await.unwrap();
    assert_eq!(store.login_code_redeem_at(&code, &verifier, T0).await.unwrap(), user.id);
    assert_eq!(store.login_code_redeem_at(&code, &verifier, T0).await, Err(AuthError::Unauthorized));

    // Used after 60 seconds.
    let code = store.login_code_create_at(&user.id, &challenge, T0).await.unwrap();
    assert_eq!(store.login_code_redeem_at(&code, &verifier, T0 + 61 * SEC).await, Err(AuthError::Unauthorized));

    // Not a code at all, and a refresh token in its place.
    assert_eq!(store.login_code_redeem_at("dhc_nope", &verifier, T0).await, Err(AuthError::Unauthorized));
    assert_eq!(rows(&store, "device_sessions").await, 0, "no session was created");
    assert_eq!(rows(&store, "login_codes").await, 0, "every code was used up");
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn a_retired_token_replays_for_30_seconds_then_ends_the_session() {
    // AC-6
    let store = test_store().await;
    let user = test_user(&store, "u@x.com", ServerRole::Member).await;
    let first = sign_in(&store, &user.id, &device("d1"), T0).await;
    let second = store.session_refresh_at(&first.refresh_token, T0 + 60 * SEC).await.unwrap();

    // Ten seconds later the old token gets the same new renewal token and a fresh access token.
    let again = store.session_refresh_at(&first.refresh_token, T0 + 70 * SEC).await.unwrap();
    assert_eq!(again.refresh_token, second.refresh_token, "identical renewal token");
    assert_ne!(again.access_token, second.access_token, "but a fresh access token");
    assert!(store.verify_access_at(&again.access_token, T0 + 71 * SEC).await.is_some());
    // The session lives, and the token it was given still renews.
    store.session_refresh_at(&again.refresh_token, T0 + 72 * SEC).await.unwrap();

    // Start over: after the window, the retired token is theft.
    let user2 = test_user(&store, "v@x.com", ServerRole::Member).await;
    let a = sign_in(&store, &user2.id, &device("d2"), T0).await;
    let b = store.session_refresh_at(&a.refresh_token, T0 + 60 * SEC).await.unwrap();
    assert_eq!(store.session_refresh_at(&a.refresh_token, T0 + 91 * SEC).await, Err(AuthError::Unauthorized));
    assert!(store.verify_access_at(&b.access_token, T0 + 92 * SEC).await.is_none(), "the session is gone");
    assert_eq!(store.session_refresh_at(&b.refresh_token, T0 + 92 * SEC).await, Err(AuthError::Unauthorized));
    assert!(audit_actions(&store).await.contains(&"session.reuse_detected".to_string()));
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn two_renewals_at_once_rotate_once() {
    // The row lock: both callers get the same new renewal token.
    let store = test_store().await;
    let user = test_user(&store, "u@x.com", ServerRole::Member).await;
    let first = sign_in(&store, &user.id, &device("d1"), T0).await;
    let now = T0 + 5 * SEC;
    let (a, b) = tokio::join!(
        store.session_refresh_at(&first.refresh_token, now),
        store.session_refresh_at(&first.refresh_token, now)
    );
    let (a, b) = (a.unwrap(), b.unwrap());
    assert_eq!(a.refresh_token, b.refresh_token);
    assert_ne!(a.access_token, b.access_token);
    assert_eq!(rows(&store, "device_sessions").await, 1);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn idle_and_absolute_expiry_end_the_session_and_remove_the_row() {
    // AC-7
    let store = test_store().await;
    let user = test_user(&store, "u@x.com", ServerRole::Member).await;

    let idle = sign_in(&store, &user.id, &device("idle"), T0).await;
    assert_eq!(store.session_refresh_at(&idle.refresh_token, T0 + 30 * DAY + SEC).await, Err(AuthError::Unauthorized));
    assert_eq!(rows(&store, "device_sessions").await, 0, "the row is removed");

    // Renewing every 29 days keeps the session idle-alive, but not past 90 days.
    let hard = sign_in(&store, &user.id, &device("hard"), T0).await;
    let (mut token, mut now) = (hard.refresh_token, T0);
    for _ in 0..3 {
        now += 29 * DAY;
        token = store.session_refresh_at(&token, now).await.unwrap().refresh_token;
    }
    // 87 days in: a renewal still works, and its idle end is cut to the 90 day mark.
    let last = store.session_refresh_at(&token, T0 + 89 * DAY).await.unwrap();
    assert!(last.refresh_max_age_secs <= 1 * DAY / SEC, "idle end never passes the 90 day cap");
    assert_eq!(store.session_refresh_at(&last.refresh_token, T0 + 90 * DAY + SEC).await, Err(AuthError::Unauthorized));
    assert_eq!(rows(&store, "device_sessions").await, 0);
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn one_session_per_device_and_a_cap_of_25() {
    // AC-8
    let store = test_store().await;
    let user = test_user(&store, "u@x.com", ServerRole::Member).await;

    let first = sign_in(&store, &user.id, &device("same"), T0).await;
    let second = sign_in(&store, &user.id, &device("same"), T0 + SEC).await;
    assert_eq!(rows(&store, "device_sessions").await, 1);
    assert!(store.verify_access_at(&first.access_token, T0 + 2 * SEC).await.is_none(), "old tokens stop working");
    assert_eq!(store.session_refresh_at(&first.refresh_token, T0 + 2 * SEC).await, Err(AuthError::Unauthorized));
    assert!(store.verify_access_at(&second.access_token, T0 + 2 * SEC).await.is_some());

    // Fill to 25, then a 26th replaces the least recently used.
    let mut oldest = None;
    for i in 0..24 {
        let issued = sign_in(&store, &user.id, &device(&format!("d{i}")), T0 + (10 + i) * SEC).await;
        if i == 0 {
            oldest = Some(issued);
        }
    }
    assert_eq!(rows(&store, "device_sessions").await, 25);
    // "same" was last used at T0+1s, so it is the oldest of all.
    let extra = sign_in(&store, &user.id, &device("extra"), T0 + 100 * SEC).await;
    assert_eq!(rows(&store, "device_sessions").await, 25, "never more than 25");
    assert!(store.verify_access_at(&second.access_token, T0 + 101 * SEC).await.is_none(), "the oldest was pushed out");
    assert!(store.verify_access_at(&oldest.unwrap().access_token, T0 + 101 * SEC).await.is_some());
    assert!(store.verify_access_at(&extra.access_token, T0 + 101 * SEC).await.is_some());
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn a_person_sees_and_ends_only_their_own_devices() {
    // AC-9, AC-10
    let store = test_store().await;
    let a = test_user(&store, "a@x.com", ServerRole::Member).await;
    let b = test_user(&store, "b@x.com", ServerRole::Member).await;
    let a1 = sign_in(&store, &a.id, &device("a1"), T0).await;
    let a2 = sign_in(&store, &a.id, &device("a2"), T0 + SEC).await;
    let b1 = sign_in(&store, &b.id, &device("b1"), T0).await;

    let list = store.sessions_list_at(&a.id, &a1.session_id, T0 + 2 * SEC).await.unwrap();
    assert_eq!(list.len(), 2, "only A's sessions");
    assert!(list.iter().all(|s| s.id != b1.session_id));
    assert_eq!(list.iter().filter(|s| s.current).count(), 1);
    assert!(list.iter().find(|s| s.id == a1.session_id).unwrap().current);
    assert_eq!(list[0].platform, "desktop");

    // Ending B's session as A is a 404, and nothing happens to it.
    assert_eq!(store.session_end(&a.id, &b1.session_id).await, Err(AccessError::NotFound));
    assert!(store.verify_access_at(&b1.access_token, T0 + 3 * SEC).await.is_some());
    assert_eq!(store.session_end(&a.id, "no-such-id").await, Err(AccessError::NotFound));

    // Ending A's second device is refused on the next request, and the first is untouched.
    store.session_end(&a.id, &a2.session_id).await.unwrap();
    assert!(store.verify_access_at(&a2.access_token, T0 + 3 * SEC).await.is_none());
    assert_eq!(store.session_refresh_at(&a2.refresh_token, T0 + 3 * SEC).await, Err(AuthError::Unauthorized));
    assert!(store.verify_access_at(&a1.access_token, T0 + 3 * SEC).await.is_some());
    assert!(store.session_refresh_at(&a1.refresh_token, T0 + 3 * SEC).await.is_ok());
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn sign_out_everywhere_and_the_owner_call() {
    // AC-11, AC-12
    let store = test_store().await;
    let owner = test_user(&store, "o@x.com", ServerRole::Owner).await;
    let p = test_user(&store, "p@x.com", ServerRole::Member).await;
    let q = test_user(&store, "q@x.com", ServerRole::Member).await;
    let p1 = sign_in(&store, &p.id, &device("p1"), T0).await;
    let p2 = sign_in(&store, &p.id, &device("p2"), T0).await;
    let q1 = sign_in(&store, &q.id, &device("q1"), T0).await;

    assert_eq!(store.sessions_end_all(&p.id, &p1.session_id).await.unwrap(), 2);
    for issued in [&p1, &p2] {
        assert!(store.verify_access_at(&issued.access_token, T0 + SEC).await.is_none());
        assert_eq!(store.session_refresh_at(&issued.refresh_token, T0 + SEC).await, Err(AuthError::Unauthorized));
    }
    assert!(store.verify_access_at(&q1.access_token, T0 + SEC).await.is_some(), "someone else is untouched");

    // The owner ends every session of a person; an unknown person is a 404.
    let q2 = sign_in(&store, &q.id, &device("q2"), T0 + 2 * SEC).await;
    assert_eq!(store.sessions_end_by_owner(&owner.id, &q.id).await.unwrap(), 2);
    assert!(store.verify_access_at(&q2.access_token, T0 + 3 * SEC).await.is_none());
    assert_eq!(store.sessions_end_by_owner(&owner.id, "nobody").await, Err(AccessError::NotFound));
    assert!(store.is_server_owner(&owner.id).await.unwrap() && !store.is_server_owner(&q.id).await.unwrap());
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn wrong_kinds_of_token_are_refused() {
    // AC-13
    let store = test_store().await;
    let user = test_user(&store, "u@x.com", ServerRole::Member).await;
    let issued = sign_in(&store, &user.id, &device("d1"), T0).await;

    // The old 30 day token kind, and garbage.
    assert!(store.verify_access_at("Bearer dhs_0123", T0).await.is_none());
    assert!(store.verify_access_at("Bearer nope", T0).await.is_none());
    assert!(store.verify_access_at("", T0).await.is_none());
    // A renewal token is not a Bearer token.
    assert!(store.verify_access_at(&issued.refresh_token, T0).await.is_none());
    // An access token is not a renewal token.
    assert_eq!(store.session_refresh_at(&issued.access_token, T0).await, Err(AuthError::Unauthorized));
    // Expired: 15 minutes and a bit.
    assert!(store.verify_access_at(&issued.access_token, T0 + 15 * 60 * SEC + SEC).await.is_none());
    assert!(store.verify_access_at(&issued.access_token, T0 + 14 * 60 * SEC).await.is_some());
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn last_used_is_written_once_a_minute_and_the_replay_copy_is_cleared() {
    let store = test_store().await;
    let user = test_user(&store, "u@x.com", ServerRole::Member).await;
    let issued = sign_in(&store, &user.id, &device("d1"), T0).await;
    let renewed = store.session_refresh_at(&issued.refresh_token, T0 + 10 * SEC).await.unwrap();
    let used = || async {
        sqlx::query_scalar::<_, i64>("SELECT last_used_ms FROM device_sessions").fetch_one(&store.pool).await.unwrap()
    };
    let has_replay = || async {
        sqlx::query_scalar::<_, bool>("SELECT replay_enc IS NOT NULL FROM device_sessions")
            .fetch_one(&store.pool)
            .await
            .unwrap()
    };
    assert_eq!(used().await, T0 + 10 * SEC);
    assert!(has_replay().await);

    store.verify_access_at(&renewed.access_token, T0 + 30 * SEC).await.unwrap();
    assert_eq!(used().await, T0 + 10 * SEC, "inside the minute: no write");
    assert!(has_replay().await);
    store.verify_access_at(&renewed.access_token, T0 + 71 * SEC).await.unwrap();
    assert_eq!(used().await, T0 + 71 * SEC, "a minute on: written");
    assert!(!has_replay().await, "the replay window has passed, so the copy is gone");
}

#[tokio::test]
#[ignore = "requires a live Postgres test database — see store::test_store"]
async fn events_are_audited_without_any_secret() {
    // AC-18
    let store = test_store().await;
    let user = test_user(&store, "u@x.com", ServerRole::Member).await;
    let owner = test_user(&store, "o@x.com", ServerRole::Owner).await;
    let d1 = sign_in(&store, &user.id, &device("d1"), T0).await;
    let d2 = sign_in(&store, &user.id, &device("d2"), T0).await;
    let renewed = store.session_refresh_at(&d1.refresh_token, T0 + SEC).await.unwrap();
    let _ = store.session_refresh_at(&d1.refresh_token, T0 + 200 * SEC).await; // reuse
    store.session_end(&user.id, &d2.session_id).await.unwrap();
    let d3 = sign_in(&store, &user.id, &device("d3"), T0 + 300 * SEC).await;
    store.sessions_end_all(&user.id, &d3.session_id).await.unwrap();
    let d4 = sign_in(&store, &user.id, &device("d4"), T0 + 400 * SEC).await;
    store.sessions_end_by_owner(&owner.id, &user.id).await.unwrap();

    let actions = audit_actions(&store).await;
    for expected in ["session.created", "session.ended", "session.ended_all", "session.ended_by_owner", "session.reuse_detected"] {
        assert!(actions.iter().any(|a| a == expected), "{expected} was written");
    }
    // No org on any of these rows, and no secret anywhere in them.
    let orgs: i64 =
        sqlx::query_scalar("SELECT count(*) FROM audit WHERE action LIKE 'session.%' AND org_id IS NOT NULL")
            .fetch_one(&store.pool)
            .await
            .unwrap();
    assert_eq!(orgs, 0);
    let dump: String = sqlx::query_scalar(
        "SELECT coalesce(string_agg(action || '|' || target || '|' || coalesce(detail,''), ' '), '') FROM audit",
    )
    .fetch_one(&store.pool)
    .await
    .unwrap();
    for secret in [&d1.access_token, &d1.refresh_token, &renewed.refresh_token, &d4.access_token, &d4.refresh_token] {
        assert!(!dump.contains(secret.as_str()));
        assert!(!dump.contains(&crypto::hash_token(secret)));
    }
}
