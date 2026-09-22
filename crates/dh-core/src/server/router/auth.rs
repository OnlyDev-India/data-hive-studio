use axum::response::IntoResponse;
use crate::server::auth::{
    valid_challenge, AuthCtx, ClaimError, ClaimTicket, ProfileOutcome, Refusal, SignIn, VerifiedProfile,
};
use crate::server::orgs::OrgRole;
use crate::server::store::now_ms;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Redirect, Response};
use axum::Json;
use super::redirect::{next_allowed_env, public_base_url, with_query};
use super::session::{device_from, session_error, token_response};
use super::{AppState, Auth, err_res};

// ---------------------------------------------------------------------------
//  OAuth
// ---------------------------------------------------------------------------
const STATE_COOKIE: &str = "dh_oauth_state";

pub(super) fn read_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';').find_map(|pair| {
        let (k, v) = pair.trim().split_once('=')?;
        (k == name).then(|| v.to_string())
    })
}

/// Which OAuth providers this server has credentials for — unauthenticated,
/// so a sign-in form can ask "which buttons do I show?" before the user has
/// any token at all. Ordered so the frontend's rendering order is stable.
pub(super) async fn auth_providers() -> Json<Vec<&'static str>> {
    Json(
        ["google", "github"]
            .into_iter()
            .filter(|p| crate::server::auth::provider_config(p).is_some())
            .collect(),
    )
}

/// Redirects to the provider's consent screen. `next` is where the browser
/// lands afterward, with `code=` (signed in: a one time login code the client
/// trades at `/auth/exchange`), `ticket=` (this server still needs its owner to
/// claim it) or `error=<code>&email=<email>` (refused) added as query params,
/// never a token and not a `#` fragment (desktop's `next` is a plain local
/// loopback listener, and fragments are never sent to a server). `next` must be
/// the desktop loopback callback or a path on this server's own origin (see
/// `redirect.rs`), and `code_challenge` is the client's PKCE S256 challenge.
pub(super) async fn auth_start(Path(provider): Path<String>, Query(q): Query<StartQuery>) -> Response {
    let Some(cfg) = crate::server::auth::provider_config(&provider) else {
        return (StatusCode::NOT_FOUND, format!("OAuth provider '{provider}' is not configured")).into_response();
    };
    let next = q.next.as_deref().unwrap_or("");
    if !next_allowed_env(next) {
        return (StatusCode::BAD_REQUEST, "next is not an allowed return address").into_response();
    }
    let challenge = q.code_challenge.as_deref().unwrap_or("");
    if !valid_challenge(challenge) {
        return (StatusCode::BAD_REQUEST, "code_challenge must be a PKCE S256 challenge").into_response();
    }
    let csrf = hex::encode(rand::random::<[u8; 16]>());
    let redirect_uri = format!("{}/auth/{}/callback", public_base_url(), provider);
    let Some(url) =
        crate::server::auth::authorize_url(&provider, &cfg, &redirect_uri, &csrf)
    else {
        return (StatusCode::NOT_FOUND, "unknown provider").into_response();
    };
    // The cookie value carries the CSRF check value, the PKCE challenge and
    // where to send the browser afterward, kept together so this stays fully
    // stateless (no server-side "pending login" storage, which matters on
    // serverless hosts where nothing survives between the two requests). The
    // first two never contain a colon, so `next` is everything after them.
    let cookie_value = format!("{csrf}:{challenge}:{next}");
    let mut resp = Redirect::temporary(&url).into_response();
    resp.headers_mut().insert(
        header::SET_COOKIE,
        format!("{STATE_COOKIE}={cookie_value}; Max-Age=600; Path=/; HttpOnly; SameSite=Lax")
            .parse()
            .unwrap(),
    );
    resp
}

#[derive(serde::Deserialize)]
pub(super) struct StartQuery {
    #[serde(default)]
    next: Option<String>,
    #[serde(default)]
    code_challenge: Option<String>,
}

#[derive(serde::Deserialize)]
pub(super) struct CallbackQuery {
    pub(super) code: String,
    pub(super) state: String,
}

/// What the callback ends in, sent as a redirect to `next`.
enum Outcome {
    Code(String),
    Ticket(String),
    Refused { code: &'static str, email: String },
}

fn finish(next: &str, outcome: Outcome) -> Response {
    let pairs: Vec<(&str, &str)> = match &outcome {
        Outcome::Code(code) => vec![("code", code)],
        Outcome::Ticket(ticket) => vec![("ticket", ticket)],
        Outcome::Refused { code, email } => vec![("error", code), ("email", email)],
    };
    let Some(url) = with_query(next, &pairs) else {
        return (StatusCode::BAD_REQUEST, "malformed return address").into_response();
    };
    let mut resp = Redirect::temporary(&url).into_response();
    // Clear the state cookie now that it's been used.
    resp.headers_mut().insert(
        header::SET_COOKIE,
        format!("{STATE_COOKIE}=; Max-Age=0; Path=/").parse().unwrap(),
    );
    resp
}

pub(super) async fn auth_callback(
    State(gw): State<AppState>,
    Path(provider): Path<String>,
    headers: HeaderMap,
    Query(q): Query<CallbackQuery>,
) -> Response {
    let Some(cookie) = read_cookie(&headers, STATE_COOKIE) else {
        return (StatusCode::BAD_REQUEST, "missing oauth state cookie").into_response();
    };
    let mut parts = cookie.splitn(3, ':');
    let (Some(csrf), Some(challenge), Some(next)) = (parts.next(), parts.next(), parts.next()) else {
        return (StatusCode::BAD_REQUEST, "malformed oauth state cookie").into_response();
    };
    if csrf != q.state {
        return (StatusCode::BAD_REQUEST, "oauth state mismatch").into_response();
    }
    // Checked again here: the cookie is the browser's, so it is not trusted
    // just because start accepted it. No code is issued for anything else.
    if !next_allowed_env(next) || !valid_challenge(challenge) {
        return (StatusCode::BAD_REQUEST, "next is not an allowed return address").into_response();
    }
    let Some(cfg) = crate::server::auth::provider_config(&provider) else {
        return (StatusCode::NOT_FOUND, format!("OAuth provider '{provider}' is not configured")).into_response();
    };
    let redirect_uri = format!("{}/auth/{}/callback", public_base_url(), provider);
    let outcome = match crate::server::auth::exchange_code(&provider, &cfg, &q.code, &redirect_uri).await {
        Ok(o) => o,
        Err(e) => return (StatusCode::BAD_GATEWAY, format!("oauth exchange failed: {e}")).into_response(),
    };
    let email_for_log = match &outcome {
        ProfileOutcome::Verified(p) => p.email.clone(),
        ProfileOutcome::Unverified { email } => email.clone().unwrap_or_default(),
    };
    match gw.store.sign_in(outcome).await {
        Ok(SignIn::User(user)) => match gw.store.login_code_create(&user.id, challenge).await {
            Ok(code) => finish(next, Outcome::Code(code)),
            Err(e) => err_res(e),
        },
        Ok(SignIn::Ticket(profile)) => ticket_outcome(&gw, next, &profile),
        Ok(SignIn::Refused { refusal, email }) => refused(next, &provider, refusal, email.unwrap_or(email_for_log)),
        Err(e) => err_res(e),
    }
}

fn ticket_outcome(gw: &AppState, next: &str, profile: &VerifiedProfile) -> Response {
    match ClaimTicket::seal(profile, &gw.store.master_key, now_ms()) {
        Ok(ticket) => finish(next, Outcome::Ticket(ticket)),
        Err(e) => err_res(e),
    }
}

/// A refused sign in only prints a log line: nothing is written to the
/// database, and the person is told their own email and the reason.
fn refused(next: &str, provider: &str, refusal: Refusal, email: String) -> Response {
    eprintln!("sign in refused: {} (provider {provider}, email {email:?})", refusal.code());
    finish(next, Outcome::Refused { code: refusal.code(), email })
}

#[derive(serde::Deserialize)]
pub(super) struct ClaimBody {
    ticket: String,
    code: String,
    device_id: String,
    platform: String,
    #[serde(default)]
    device_name: Option<String>,
}

/// Claim a new server: the ticket from a sign in plus the setup code from the
/// server log. Needs no token, the ticket and code are the proof. The claimer
/// signs in the way anyone does: the answer is the same as `/auth/exchange`.
/// It is a direct request from the client, so no token is ever in a URL and no
/// PKCE step is needed.
pub(super) async fn auth_claim(State(gw): State<AppState>, headers: HeaderMap, Json(body): Json<ClaimBody>) -> Response {
    let device = match device_from(&headers, &body.device_id, &body.platform, body.device_name.as_deref()) {
        Ok(d) => d,
        Err(resp) => return resp,
    };
    let err = |status: StatusCode, e: &ClaimError| {
        (status, Json(serde_json::json!({ "error": e.code() }))).into_response()
    };
    match gw.store.claim(&body.ticket, &body.code).await {
        Ok(user) => match gw.store.session_start(&user.id, &device).await {
            Ok(issued) => token_response(&gw, issued, device.platform).await,
            Err(e) => session_error(e),
        },
        Err(e @ ClaimError::TicketInvalid) => err(StatusCode::BAD_REQUEST, &e),
        Err(e @ ClaimError::CodeInvalid) => err(StatusCode::FORBIDDEN, &e),
        Err(e @ ClaimError::AlreadyClaimed) => err(StatusCode::CONFLICT, &e),
        Err(ClaimError::Other(e)) => err_res(e),
    }
}

#[derive(serde::Serialize)]
pub(super) struct MeResponse {
    #[serde(flatten)]
    pub(super) ctx: AuthCtx,
    pub(super) orgs: Vec<MeOrg>,
}

#[derive(serde::Serialize)]
pub(super) struct MeOrg {
    #[serde(flatten)]
    pub(super) org: crate::server::orgs::Organization,
    pub(super) role: OrgRole,
}

pub(super) async fn me(State(gw): State<AppState>, auth: Auth) -> Response {
    match gw.store.orgs_for_user(&auth.0.user_id).await {
        Ok(orgs) => Json(MeResponse {
            ctx: auth.0,
            orgs: orgs.into_iter().map(|(org, role)| MeOrg { org, role }).collect(),
        })
        .into_response(),
        Err(e) => err_res(e),
    }
}

// Pure, DB-free unit tests for this file's own helpers. `auth_tests.rs`
// (below) covers the routes end to end against a real Postgres test store.
#[cfg(test)]
mod unit_tests {
    use super::*;
    use axum::http::HeaderValue;

    fn cookie_header(raw: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(header::COOKIE, HeaderValue::from_str(raw).unwrap());
        h
    }

    #[test]
    fn read_cookie_finds_the_named_value_among_several() {
        let h = cookie_header("a=1; dh_oauth_state=csrf1:chal1:http://x; b=2");
        assert_eq!(read_cookie(&h, STATE_COOKIE).as_deref(), Some("csrf1:chal1:http://x"));
    }

    #[test]
    fn read_cookie_tolerates_the_surrounding_whitespace_browsers_send() {
        let h = cookie_header(" a=1;  dh_oauth_state=xyz ; b=2");
        assert_eq!(read_cookie(&h, STATE_COOKIE).as_deref(), Some("xyz"));
    }

    #[test]
    fn read_cookie_is_none_when_absent_or_header_missing() {
        assert_eq!(read_cookie(&cookie_header("a=1"), STATE_COOKIE), None);
        assert_eq!(read_cookie(&HeaderMap::new(), STATE_COOKIE), None);
    }

    #[test]
    fn finish_redirects_with_the_outcome_as_a_query_param_and_clears_the_state_cookie() {
        let next = "http://127.0.0.1:5173/callback";

        let r = finish(next, Outcome::Code("abc".into()));
        assert_eq!(r.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(
            r.headers().get(header::LOCATION).unwrap().to_str().unwrap(),
            "http://127.0.0.1:5173/callback?code=abc",
        );
        let cleared = r.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap();
        assert!(cleared.starts_with(&format!("{STATE_COOKIE}=; Max-Age=0")), "{cleared}");

        let r = finish(next, Outcome::Ticket("tix-1".into()));
        assert_eq!(
            r.headers().get(header::LOCATION).unwrap().to_str().unwrap(),
            "http://127.0.0.1:5173/callback?ticket=tix-1",
        );

        let r = finish(next, Outcome::Refused { code: "not_invited", email: "a@x.com".into() });
        assert_eq!(
            r.headers().get(header::LOCATION).unwrap().to_str().unwrap(),
            "http://127.0.0.1:5173/callback?error=not_invited&email=a%40x.com",
        );
    }

    #[test]
    fn finish_refuses_a_malformed_return_address() {
        let r = finish("not a url", Outcome::Code("abc".into()));
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn auth_start_refuses_a_provider_with_no_credentials_configured() {
        // The test environment sets no GOOGLE_CLIENT_ID/SECRET, so this
        // exercises the same "unavailable" path a real unconfigured server takes.
        let r = auth_start(Path("google".into()), Query(StartQuery { next: None, code_challenge: None })).await;
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn auth_start_rejects_an_unrecognized_provider_the_same_way() {
        let r = auth_start(
            Path("bogus".into()),
            Query(StartQuery { next: None, code_challenge: None }),
        )
        .await;
        assert_eq!(r.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn claim_body_device_name_is_optional() {
        let b: ClaimBody =
            serde_json::from_str(r#"{"ticket":"t","code":"c","device_id":"d1","platform":"macos"}"#).unwrap();
        assert_eq!(b.device_name, None);

        let b: ClaimBody = serde_json::from_str(
            r#"{"ticket":"t","code":"c","device_id":"d1","platform":"macos","device_name":"Mac mini"}"#,
        )
        .unwrap();
        assert_eq!(b.device_name.as_deref(), Some("Mac mini"));
    }
}

#[cfg(test)]
#[path = "auth_tests.rs"]
mod tests;
