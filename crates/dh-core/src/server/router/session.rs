//! Sign in hand off and device sessions over HTTP (spec 0010, sessions): the
//! code exchange, renewal, sign out, the device list and the owner call. The
//! renewal token reaches the desktop app in the response body and the web page
//! only as an HttpOnly cookie, and every response that carries a token says
//! `Cache-Control: no-store`.

use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use crate::server::auth::{
    clean_device_name, device_name_from_user_agent, valid_verifier, AuthError, DeviceInfo, Issued, Platform, User,
};
use super::access::access_err;
use super::auth::read_cookie;
use super::redirect::public_url_is_https;
use super::{err_res, AppState, Auth};

const REFRESH_COOKIE: &str = "dh_refresh";
/// Longest device id we store. A client makes a uuid, so this is generous.
const MAX_DEVICE_ID_LEN: usize = 128;

/// 401 for a missing, unknown, expired or ended token. The body is plain text
/// as before, plus the header that tells a client to send a Bearer token.
pub(super) fn unauthorized() -> Response {
    let mut resp = (StatusCode::UNAUTHORIZED, "invalid, missing, or expired session").into_response();
    resp.headers_mut().insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
    resp
}

pub(super) fn session_error(e: AuthError) -> Response {
    match e {
        AuthError::Unauthorized => unauthorized(),
        AuthError::Other(e) => err_res(e),
    }
}

fn no_store(mut resp: Response) -> Response {
    resp.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    resp
}

fn set_cookie(resp: &mut Response, value: String) {
    if let Ok(v) = HeaderValue::from_str(&value) {
        resp.headers_mut().append(header::SET_COOKIE, v);
    }
}

fn cookie_attrs(max_age_secs: i64) -> String {
    let secure = if public_url_is_https() { "; Secure" } else { "" };
    format!("Path=/auth; HttpOnly; SameSite=Strict; Max-Age={max_age_secs}{secure}")
}

/// The web renewal cookie. Only sent to paths under `/auth`, never readable by
/// page scripts, and never sent on a cross site request.
fn refresh_cookie(token: &str, max_age_secs: i64) -> String {
    format!("{REFRESH_COOKIE}={token}; {}", cookie_attrs(max_age_secs))
}

fn clear_refresh_cookie() -> String {
    format!("{REFRESH_COOKIE}=; {}", cookie_attrs(0))
}

/// Check the device fields of a sign in. The web page's name comes from the
/// `User-Agent` header, so it cannot claim to be another device; the desktop
/// sends its own machine name.
pub(super) fn device_from(
    headers: &HeaderMap,
    device_id: &str,
    platform: &str,
    device_name: Option<&str>,
) -> Result<DeviceInfo, Response> {
    let bad = |m: &str| Err((StatusCode::BAD_REQUEST, m.to_string()).into_response());
    if device_id.is_empty()
        || device_id.len() > MAX_DEVICE_ID_LEN
        || !device_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return bad("device_id must be 1 to 128 letters, digits, dashes or underscores");
    }
    let (platform, device_name) = match platform {
        "desktop" => (Platform::Desktop, clean_device_name(device_name.unwrap_or(""), "Desktop")),
        "web" => {
            let ua = headers.get(header::USER_AGENT).and_then(|h| h.to_str().ok()).unwrap_or("");
            (Platform::Web, device_name_from_user_agent(ua))
        }
        _ => return bad("platform must be desktop or web"),
    };
    Ok(DeviceInfo { device_id: device_id.to_string(), device_name, platform })
}

#[derive(serde::Serialize)]
struct TokenBody {
    access_token: String,
    /// Seconds until `access_token` stops working.
    expires_in: i64,
    session_id: String,
    user: User,
    /// Desktop only. The web page gets the renewal token as a cookie instead.
    #[serde(skip_serializing_if = "Option::is_none")]
    refresh_token: Option<String>,
}

/// The answer to a sign in or a renewal.
pub(super) async fn token_response(gw: &AppState, issued: Issued, platform: Platform) -> Response {
    let user = match gw.store.user_get(&issued.user_id).await {
        Ok(Some(user)) => user,
        Ok(None) => return unauthorized(),
        Err(e) => return err_res(e),
    };
    let body = TokenBody {
        access_token: issued.access_token,
        expires_in: issued.expires_in,
        session_id: issued.session_id,
        user,
        refresh_token: (platform == Platform::Desktop).then(|| issued.refresh_token.clone()),
    };
    let mut resp = Json(body).into_response();
    if platform == Platform::Web {
        set_cookie(&mut resp, refresh_cookie(&issued.refresh_token, issued.refresh_max_age_secs));
    }
    no_store(resp)
}

#[derive(serde::Deserialize)]
pub(super) struct ExchangeBody {
    code: String,
    code_verifier: String,
    device_id: String,
    platform: String,
    #[serde(default)]
    device_name: Option<String>,
}

/// Trade a login code and its PKCE verifier for a session.
pub(super) async fn auth_exchange(State(gw): State<AppState>, headers: HeaderMap, Json(body): Json<ExchangeBody>) -> Response {
    let device = match device_from(&headers, &body.device_id, &body.platform, body.device_name.as_deref()) {
        Ok(d) => d,
        Err(resp) => return resp,
    };
    if !valid_verifier(&body.code_verifier) {
        return (StatusCode::BAD_REQUEST, "code_verifier is malformed").into_response();
    }
    let user_id = match gw.store.login_code_redeem(&body.code, &body.code_verifier).await {
        Ok(id) => id,
        Err(e) => return session_error(e),
    };
    match gw.store.session_start(&user_id, &device).await {
        Ok(issued) => token_response(&gw, issued, device.platform).await,
        Err(e) => session_error(e),
    }
}

#[derive(serde::Deserialize)]
pub(super) struct RefreshBody {
    /// Desktop sends the renewal token here. The web page sends `{}` and the
    /// cookie carries it.
    #[serde(default)]
    refresh_token: Option<String>,
}

/// Renew a session. Only `Content-Type: application/json` gets this far (the
/// `Json` extractor refuses anything else), and the route sets no CORS
/// credentials header, so another site can neither trigger a renewal with the
/// cookie nor read its answer.
pub(super) async fn auth_refresh(State(gw): State<AppState>, headers: HeaderMap, Json(body): Json<RefreshBody>) -> Response {
    let from_body = body.refresh_token.filter(|t| !t.is_empty());
    let from_cookie = read_cookie(&headers, REFRESH_COOKIE).filter(|t| !t.is_empty());
    let (token, platform) = match (from_body, from_cookie) {
        (Some(t), None) => (t, Platform::Desktop),
        (None, Some(t)) => (t, Platform::Web),
        _ => {
            return (StatusCode::BAD_REQUEST, "send the renewal token in the body or as the cookie, not both or neither")
                .into_response();
        }
    };
    match gw.store.session_refresh(&token).await {
        Ok(issued) => token_response(&gw, issued, platform).await,
        Err(e) => {
            let mut resp = session_error(e);
            if platform == Platform::Web && resp.status() == StatusCode::UNAUTHORIZED {
                set_cookie(&mut resp, clear_refresh_cookie());
            }
            resp
        }
    }
}

fn no_content_clearing_cookie() -> Response {
    let mut resp = StatusCode::NO_CONTENT.into_response();
    set_cookie(&mut resp, clear_refresh_cookie());
    resp
}

/// Sign out this device.
pub(super) async fn logout(State(gw): State<AppState>, auth: Auth) -> Response {
    match gw.store.session_end(&auth.0.user_id, &auth.0.session_id).await {
        Ok(()) => no_content_clearing_cookie(),
        Err(e) => access_err(e),
    }
}

pub(super) async fn my_sessions(State(gw): State<AppState>, auth: Auth) -> Response {
    match gw.store.sessions_list(&auth.0.user_id, &auth.0.session_id).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => err_res(e),
    }
}

/// End one of the caller's devices. Someone else's id is a 404.
pub(super) async fn my_session_end(State(gw): State<AppState>, auth: Auth, Path(id): Path<String>) -> Response {
    match gw.store.session_end(&auth.0.user_id, &id).await {
        Ok(()) if id == auth.0.session_id => no_content_clearing_cookie(),
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => access_err(e),
    }
}

/// Sign out everywhere, this device included.
pub(super) async fn my_sessions_end_all(State(gw): State<AppState>, auth: Auth) -> Response {
    match gw.store.sessions_end_all(&auth.0.user_id, &auth.0.session_id).await {
        Ok(_) => no_content_clearing_cookie(),
        Err(e) => err_res(e),
    }
}

/// The server owner ends every session of a person. Anyone else gets 403.
pub(super) async fn owner_end_sessions(State(gw): State<AppState>, auth: Auth, Path(user_id): Path<String>) -> Response {
    match gw.store.is_server_owner(&auth.0.user_id).await {
        Ok(true) => {}
        Ok(false) => return (StatusCode::FORBIDDEN, "forbidden").into_response(),
        Err(e) => return err_res(e),
    }
    match gw.store.sessions_end_by_owner(&auth.0.user_id, &user_id).await {
        Ok(ended) => Json(serde_json::json!({ "ended": ended })).into_response(),
        Err(e) => access_err(e),
    }
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;
