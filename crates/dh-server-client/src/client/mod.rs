//! Typed HTTP client used by desktop builds to talk to a dh-server. Holds a
//! device session (from an OAuth login, see `session.rs`), not a team header:
//! which organization a call concerns is either in the URL path
//! (`/v1/orgs/{org_id}/...`) or implied by the connection id itself
//! (`/v1/c/{conn_id}/...` — the server resolves its org internally).
//!
//! Every request goes through [`ServerClient::request`], which sends the short
//! lived access token, renews it quietly when it is about to expire, and on a
//! 401 renews once and retries once.

mod access;
pub mod orgs;
pub mod browse;
pub mod data;
mod session;

pub use session::{
    claim_server, exchange_code, DeviceParams, SessionReply, SessionState, TokenStore, ERR_SIGNED_OUT,
};

use crate::orgs::OrgRole;
use std::sync::Arc;

/// `GET /v1/me`'s response shape — the caller's identity plus every org
/// they belong to (with their role in each), matching `dh-server`'s
/// `router::auth::MeResponse`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MeResult {
    pub user_id: String,
    pub email: String,
    pub name: String,
    pub server_role: crate::auth::ServerRole,
    pub can_manage_roles: bool,
    /// Whether this person may create an organization right now (spec 0011).
    #[serde(default)]
    pub can_create_org: bool,
    pub orgs: Vec<MeOrg>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MeOrg {
    #[serde(flatten)]
    pub org: crate::orgs::Organization,
    pub role: OrgRole,
}

#[derive(Clone)]
pub struct ServerClient {
    base: String,
    http: reqwest::Client,
    /// Shared by every client of one server, so two org profiles on the same
    /// server are one device session and renew together.
    session: Arc<SessionState>,
}

pub fn normalize_base(url: &str) -> String {
    let t = url.trim().trim_end_matches('/');
    if t.starts_with("http") {
        t.to_string()
    } else {
        format!("https://{t}")
    }
}

/// Build the URL to send the browser/system-webview to for `provider`'s
/// OAuth consent screen (`GET server_base/auth/{provider}/start`). Desktop
/// callers open this in the system browser and capture the callback via a
/// local loopback HTTP listener (`src-tauri/src/servers`, not implemented in
/// this crate since it's platform-specific). `next` is where the server
/// redirects the browser afterward, with `code=`, `ticket=` or `error=`
/// appended as a query param (not a `#` fragment: fragments never reach a
/// plain server-side listener). `code_challenge` is the PKCE challenge of a
/// secret the app keeps to itself (see `auth::pkce_pair`). See
/// [`parse_oauth_callback`].
pub fn oauth_start_url(server_base: &str, provider: &str, next: &str, code_challenge: &str) -> String {
    format!(
        "{}/auth/{provider}/start?next={}&code_challenge={}",
        normalize_base(server_base),
        urlencode(next),
        urlencode(code_challenge),
    )
}

/// How a sign in ended, as read from the browser's return to the loopback
/// listener (`next`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OAuthCallback {
    /// Signed in: a one time login code, to trade with the PKCE verifier.
    Code(String),
    /// The server has no owner yet: a claim ticket to send with the setup code.
    Ticket(String),
    /// Refused: a code such as `not_invited`, and the person's own email.
    Refused { error: String, email: String },
    /// The server answered with `token=`, the way a server from before device
    /// sessions does. This app cannot use it, and stores nothing.
    OldServer,
}

/// Read the outcome from the request target of the loopback callback
/// (`/callback?code=...`). `None` when it carries none of them.
pub fn parse_oauth_callback(request_target: &str) -> Option<OAuthCallback> {
    let query = request_target.split_once('?')?.1;
    // Borrow the URL parser for its percent decoding of the values.
    let url = reqwest::Url::parse(&format!("http://loopback/?{query}")).ok()?;
    let (mut code, mut token, mut ticket, mut error, mut email) = (None, None, None, None, String::new());
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "code" => code = Some(v.into_owned()),
            "token" => token = Some(v.into_owned()),
            "ticket" => ticket = Some(v.into_owned()),
            "error" => error = Some(v.into_owned()),
            "email" => email = v.into_owned(),
            _ => {}
        }
    }
    match (code, ticket, error, token) {
        (Some(c), _, _, _) if !c.is_empty() => Some(OAuthCallback::Code(c)),
        (_, Some(t), _, _) if !t.is_empty() => Some(OAuthCallback::Ticket(t)),
        (_, _, Some(error), _) if !error.is_empty() => Some(OAuthCallback::Refused { error, email }),
        (_, _, _, Some(t)) if !t.is_empty() => Some(OAuthCallback::OldServer),
        _ => None,
    }
}

/// Which OAuth providers `server_base` has credentials configured for
/// (`GET /auth/providers`, unauthenticated) — lets a sign-in form show only
/// the buttons that will actually work instead of guessing.
pub async fn oauth_providers(server_base: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/auth/providers", normalize_base(server_base));
    let resp = reqwest::Client::new().get(url).send().await.map_err(|e| e.to_string())?;
    decode(resp).await
}

fn urlencode(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => c.encode_utf8(&mut [0u8; 4]).bytes().map(|b| format!("%{b:02X}")).collect(),
        })
        .collect()
}

impl ServerClient {
    /// A client for `base_url` that shares `session`.
    pub fn new(base_url: &str, session: Arc<SessionState>) -> Self {
        Self { base: normalize_base(base_url), http: reqwest::Client::new(), session }
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    pub fn session(&self) -> &Arc<SessionState> {
        &self.session
    }

    /// Send one request with the current access token, renewing it first when
    /// it is about to expire. A 401 renews once (unless another request just
    /// did) and retries once, so a token the server ended early is picked up
    /// without the person noticing.
    async fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<reqwest::Response, String> {
        let token = self.session.access_token().await?;
        let resp = self.send_once(&method, path, &body, &token).await?;
        if resp.status() != reqwest::StatusCode::UNAUTHORIZED {
            return Ok(resp);
        }
        let token = self.session.renew_after(&token).await?;
        self.send_once(&method, path, &body, &token).await
    }

    async fn send_once(
        &self,
        method: &reqwest::Method,
        path: &str,
        body: &Option<serde_json::Value>,
        token: &str,
    ) -> Result<reqwest::Response, String> {
        let mut req = self.http.request(method.clone(), format!("{}{}", self.base, path)).bearer_auth(token);
        if let Some(body) = body {
            req = req.json(body);
        }
        req.send().await.map_err(|e| e.to_string())
    }

    pub(super) async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        decode(self.request(reqwest::Method::GET, path, None).await?).await
    }

    pub(super) async fn send<T: serde::de::DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: impl serde::Serialize,
    ) -> Result<T, String> {
        let body = serde_json::to_value(body).map_err(|e| e.to_string())?;
        decode(self.request(method, path, Some(body)).await?).await
    }

    pub(super) async fn empty(&self, method: reqwest::Method, path: &str) -> Result<(), String> {
        finish(self.request(method, path, None).await?).await
    }

    pub(super) async fn empty_with_body(
        &self,
        method: reqwest::Method,
        path: &str,
        body: impl serde::Serialize,
    ) -> Result<(), String> {
        let body = serde_json::to_value(body).map_err(|e| e.to_string())?;
        finish(self.request(method, path, Some(body)).await?).await
    }
}

async fn finish(resp: reqwest::Response) -> Result<(), String> {
    if resp.status().is_success() {
        Ok(())
    } else {
        Err(error_message(resp).await)
    }
}

async fn decode<T: serde::de::DeserializeOwned>(resp: reqwest::Response) -> Result<T, String> {
    if resp.status().is_success() {
        resp.json::<T>().await.map_err(|e| format!("bad response: {e}"))
    } else {
        Err(error_message(resp).await)
    }
}

/// Prefer the server's error body (exact messages like `forbidden`,
/// `connection is read-only for this user`); fall back to the status code.
async fn error_message(resp: reqwest::Response) -> String {
    let status = resp.status();
    match resp.text().await {
        Ok(body) if !body.trim().is_empty() => body,
        _ => format!("server returned {status}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_outcomes_are_read_and_decoded() {
        assert_eq!(parse_oauth_callback("/callback?code=dhc_abc"), Some(OAuthCallback::Code("dhc_abc".into())));
        assert_eq!(parse_oauth_callback("/callback?ticket=00ff"), Some(OAuthCallback::Ticket("00ff".into())));
        assert_eq!(
            parse_oauth_callback("/callback?error=not_invited&email=a%2Bb%40x.com"),
            Some(OAuthCallback::Refused { error: "not_invited".into(), email: "a+b@x.com".into() })
        );
        // No email at all is still a refusal.
        assert_eq!(
            parse_oauth_callback("/callback?error=email_unverified&email="),
            Some(OAuthCallback::Refused { error: "email_unverified".into(), email: String::new() })
        );
        assert_eq!(parse_oauth_callback("/callback"), None);
        assert_eq!(parse_oauth_callback("/callback?other=1"), None);
        assert_eq!(parse_oauth_callback("/callback?code="), None);
    }

    #[test]
    fn a_token_instead_of_a_code_means_an_old_server() {
        // AC-19: never used, never stored.
        assert_eq!(parse_oauth_callback("/callback?token=dhs_abc"), Some(OAuthCallback::OldServer));
        assert_eq!(parse_oauth_callback("/callback?token="), None);
    }

    #[test]
    fn start_url_carries_next_and_the_challenge() {
        let url = oauth_start_url("studio.example.com/", "google", "http://127.0.0.1:9/callback", "abc-_");
        assert_eq!(
            url,
            "https://studio.example.com/auth/google/start?next=http%3A%2F%2F127.0.0.1%3A9%2Fcallback&code_challenge=abc-_"
        );
    }
}
