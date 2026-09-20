use axum::response::IntoResponse;
use crate::server::auth::AuthCtx;
use crate::server::orgs::OrgRole;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Redirect, Response};
use axum::Json;
use super::{AppState, Auth, err_res};

// ---------------------------------------------------------------------------
//  OAuth
// ---------------------------------------------------------------------------
const STATE_COOKIE: &str = "dh_oauth_state";

fn public_base_url() -> String {
    std::env::var("DH_PUBLIC_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".to_string())
}

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
/// browser lands after a successful login (the session token is appended as
/// a `token=` query param — not a `#` fragment, since desktop's `next` is a
/// plain local-loopback HTTP listener and fragments are never sent to a
/// server); omit it to get the session token back as plain JSON from the
/// callback instead (useful for headless/manual testing).
pub(super) async fn auth_start(Path(provider): Path<String>, Query(q): Query<StartQuery>) -> Response {
    let Some(cfg) = crate::server::auth::provider_config(&provider) else {
        return (StatusCode::NOT_FOUND, format!("OAuth provider '{provider}' is not configured")).into_response();
    };
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
    let Some(cfg) = crate::server::auth::provider_config(&provider) else {
        return (StatusCode::NOT_FOUND, format!("OAuth provider '{provider}' is not configured")).into_response();
    };
    let redirect_uri = format!("{}/auth/{}/callback", public_base_url(), provider);
    let profile = match crate::server::auth::exchange_code(&provider, &cfg, &q.code, &redirect_uri).await {
        Ok(p) => p,
        Err(e) => return (StatusCode::BAD_GATEWAY, format!("oauth exchange failed: {e}")).into_response(),
    };
    if profile.email.is_empty() {
        return (StatusCode::BAD_GATEWAY, "provider did not return an email address").into_response();
    }
    let user = match gw
        .store
        .user_upsert_oauth(&provider, &profile.subject, &profile.email, &profile.name, profile.avatar_url.as_deref())
        .await
    {
        Ok(u) => u,
        Err(e) => return err_res(e),
    };
    let token = match gw.store.session_create(&user.id).await {
        Ok(t) => t,
        Err(e) => return err_res(e),
    };

    let mut resp = if next.is_empty() {
        Json(serde_json::json!({ "token": token, "user": user })).into_response()
    } else {
        let sep = if next.contains('?') { "&" } else { "?" };
        Redirect::temporary(&format!("{next}{sep}token={token}")).into_response()
    };
    // Clear the state cookie now that it's been used.
    resp.headers_mut().insert(
        header::SET_COOKIE,
        format!("{STATE_COOKIE}=; Max-Age=0; Path=/").parse().unwrap(),
    );
    resp
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
