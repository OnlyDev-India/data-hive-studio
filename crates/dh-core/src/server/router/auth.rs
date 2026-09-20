use axum::response::IntoResponse;
use crate::server::auth::{AuthCtx, ClaimError, ClaimTicket, ProfileOutcome, Refusal, SignIn, VerifiedProfile};
use crate::server::orgs::OrgRole;
use crate::server::store::now_ms;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Redirect, Response};
use axum::Json;
use super::redirect::{next_allowed_env, public_base_url, with_query};
use super::{AppState, Auth, err_res};

// ---------------------------------------------------------------------------
//  OAuth
// ---------------------------------------------------------------------------
const STATE_COOKIE: &str = "dh_oauth_state";

fn read_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
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

/// Redirects to the provider's consent screen. `?next=<url>` is where the
/// browser lands afterward, with `token=` (signed in), `ticket=` (this server
/// still needs its owner to claim it) or `error=<code>&email=<email>` (refused)
/// added as query params — not a `#` fragment, since desktop's `next` is a
/// plain local-loopback HTTP listener and fragments are never sent to a
/// server. `next` must be a loopback address or an allowed origin (see
/// `redirect.rs`). Omit it to get the same three outcomes back as JSON from
/// the callback instead (useful for headless/manual testing).
pub(super) async fn auth_start(Path(provider): Path<String>, Query(q): Query<StartQuery>) -> Response {
    let Some(cfg) = crate::server::auth::provider_config(&provider) else {
        return (StatusCode::NOT_FOUND, format!("OAuth provider '{provider}' is not configured")).into_response();
    };
    if q.next.as_deref().is_some_and(|n| !n.is_empty() && !next_allowed_env(n)) {
        return (StatusCode::BAD_REQUEST, "next is not an allowed return address").into_response();
    }
    let csrf = hex::encode(rand::random::<[u8; 16]>());
    let redirect_uri = format!("{}/auth/{}/callback", public_base_url(), provider);
    let Some(url) =
        crate::server::auth::authorize_url(&provider, &cfg, &redirect_uri, &csrf)
    else {
        return (StatusCode::NOT_FOUND, "unknown provider").into_response();
    };
    // Cookie value carries both the CSRF check value and where to send the
    // browser afterward — kept together so this stays fully stateless
    // (no server-side "pending login" storage, which matters on serverless
    // hosts where nothing survives between the two requests otherwise).
    let cookie_value = format!("{csrf}:{}", q.next.as_deref().unwrap_or(""));
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
}

#[derive(serde::Deserialize)]
pub(super) struct CallbackQuery {
    pub(super) code: String,
    pub(super) state: String,
}

/// What the callback ends in. Sent as a redirect to `next`, or as JSON when
/// there is no `next`.
enum Outcome {
    Token { token: String, user: crate::server::auth::User },
    Ticket(String),
    Refused { code: &'static str, email: String },
}

fn finish(next: &str, outcome: Outcome) -> Response {
    let mut resp = if next.is_empty() {
        match outcome {
            Outcome::Token { token, user } => Json(serde_json::json!({ "token": token, "user": user })).into_response(),
            Outcome::Ticket(ticket) => Json(serde_json::json!({ "ticket": ticket })).into_response(),
            Outcome::Refused { code, email } => {
                (StatusCode::FORBIDDEN, Json(serde_json::json!({ "error": code, "email": email }))).into_response()
            }
        }
    } else {
        let pairs: Vec<(&str, &str)> = match &outcome {
            Outcome::Token { token, .. } => vec![("token", token)],
            Outcome::Ticket(ticket) => vec![("ticket", ticket)],
            Outcome::Refused { code, email } => vec![("error", code), ("email", email)],
        };
        match with_query(next, &pairs) {
            Some(url) => Redirect::temporary(&url).into_response(),
            None => return (StatusCode::BAD_REQUEST, "malformed return address").into_response(),
        }
    };
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
    let Some((csrf, next)) = cookie.split_once(':') else {
        return (StatusCode::BAD_REQUEST, "malformed oauth state cookie").into_response();
    };
    if csrf != q.state {
        return (StatusCode::BAD_REQUEST, "oauth state mismatch").into_response();
    }
    // Checked again here: the cookie is the browser's, so it is not trusted
    // just because start accepted it.
    if !next.is_empty() && !next_allowed_env(next) {
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
        Ok(SignIn::User(user)) => match gw.store.session_create(&user.id).await {
            Ok(token) => finish(next, Outcome::Token { token, user }),
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
}

/// Claim a new server: the ticket from a sign in plus the setup code from the
/// server log. Needs no token, the ticket and code are the proof.
pub(super) async fn auth_claim(State(gw): State<AppState>, Json(body): Json<ClaimBody>) -> Response {
    let err = |status: StatusCode, e: &ClaimError| {
        (status, Json(serde_json::json!({ "error": e.code() }))).into_response()
    };
    match gw.store.claim(&body.ticket, &body.code).await {
        Ok(user) => match gw.store.session_create(&user.id).await {
            Ok(token) => Json(serde_json::json!({ "token": token, "user": user })).into_response(),
            Err(e) => err_res(e),
        },
        Err(e @ ClaimError::TicketInvalid) => err(StatusCode::BAD_REQUEST, &e),
        Err(e @ ClaimError::CodeInvalid) => err(StatusCode::FORBIDDEN, &e),
        Err(e @ ClaimError::AlreadyClaimed) => err(StatusCode::CONFLICT, &e),
        Err(ClaimError::Other(e)) => err_res(e),
    }
}

pub(super) async fn logout(State(gw): State<AppState>, headers: HeaderMap) -> Response {
    let token = headers.get(header::AUTHORIZATION).and_then(|h| h.to_str().ok()).unwrap_or("");
    match gw.store.session_revoke(token).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
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
