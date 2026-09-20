//! Typed HTTP client used by desktop builds to talk to a dh-server. Holds a
//! session token (from an OAuth login — see `auth.rs`), not a team header:
//! which organization a call concerns is either in the URL path
//! (`/v1/orgs/{org_id}/...`) or implied by the connection id itself
//! (`/v1/c/{conn_id}/...` — the server resolves its org internally).

mod access;
mod orgs;
mod browse;
mod data;

use crate::server::orgs::OrgRole;

/// `GET /v1/me`'s response shape — the caller's identity plus every org
/// they belong to (with their role in each), matching `router.rs`'s
/// `MeResponse`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MeResult {
    pub user_id: String,
    pub email: String,
    pub name: String,
    pub server_role: crate::server::auth::ServerRole,
    pub can_manage_roles: bool,
    pub orgs: Vec<MeOrg>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MeOrg {
    #[serde(flatten)]
    pub org: crate::server::orgs::Organization,
    pub role: OrgRole,
}

#[derive(Clone)]
pub struct ServerClient {
    base: String,
    token: String,
    http: reqwest::Client,
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
/// local loopback HTTP listener (`src-tauri/src/servers.rs`, not
/// implemented in `dh-core` since it's platform-specific); `next` is where
/// the server redirects the browser afterward, with `token=`, `ticket=` or
/// `error=` appended as a query param (not a `#` fragment — fragments never
/// reach a plain server-side listener). See [`parse_oauth_callback`].
pub fn oauth_start_url(server_base: &str, provider: &str, next: &str) -> String {
    format!(
        "{}/auth/{provider}/start?next={}",
        normalize_base(server_base),
        urlencode(next),
    )
}

/// How a sign in ended, as read from the browser's return to the loopback
/// listener (`next`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OAuthCallback {
    /// Signed in: a session token.
    Token(String),
    /// The server has no owner yet: a claim ticket to send with the setup code.
    Ticket(String),
    /// Refused: a code such as `not_invited`, and the person's own email.
    Refused { error: String, email: String },
}

/// Read the outcome from the request target of the loopback callback
/// (`/callback?token=...`). `None` when it carries none of the three.
pub fn parse_oauth_callback(request_target: &str) -> Option<OAuthCallback> {
    let query = request_target.split_once('?')?.1;
    // Borrow the URL parser for its percent decoding of the values.
    let url = reqwest::Url::parse(&format!("http://loopback/?{query}")).ok()?;
    let (mut token, mut ticket, mut error, mut email) = (None, None, None, String::new());
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "token" => token = Some(v.into_owned()),
            "ticket" => ticket = Some(v.into_owned()),
            "error" => error = Some(v.into_owned()),
            "email" => email = v.into_owned(),
            _ => {}
        }
    }
    match (token, ticket, error) {
        (Some(t), _, _) if !t.is_empty() => Some(OAuthCallback::Token(t)),
        (_, Some(t), _) if !t.is_empty() => Some(OAuthCallback::Ticket(t)),
        (_, _, Some(error)) if !error.is_empty() => Some(OAuthCallback::Refused { error, email }),
        _ => None,
    }
}

/// Claim a new server: send the ticket from a sign in and the setup code from
/// the server log (`POST /auth/claim`, no token needed). Returns the owner's
/// session token. On refusal the error is the server's code: `ticket_invalid`,
/// `code_invalid` or `already_claimed`.
pub async fn claim_server(server_base: &str, ticket: &str, code: &str) -> Result<String, String> {
    #[derive(serde::Deserialize)]
    struct Claimed {
        token: String,
    }
    let url = format!("{}/auth/claim", normalize_base(server_base));
    let resp = reqwest::Client::new()
        .post(url)
        .json(&serde_json::json!({ "ticket": ticket, "code": code }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        return resp.json::<Claimed>().await.map(|c| c.token).map_err(|e| format!("bad response: {e}"));
    }
    let body = error_message(resp).await;
    Err(serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
        .unwrap_or(body))
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
    pub fn new(base_url: &str, token: &str) -> Self {
        Self { base: normalize_base(base_url), token: token.to_string(), http: reqwest::Client::new() }
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    pub(super) async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let url = format!("{}{}", self.base, path);
        let resp = self.http.get(url).bearer_auth(&self.token).send().await.map_err(|e| e.to_string())?;
        decode(resp).await
    }

    pub(super) async fn send<T: serde::de::DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: impl serde::Serialize,
    ) -> Result<T, String> {
        let url = format!("{}{}", self.base, path);
        let resp = self
            .http
            .request(method, url)
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        decode(resp).await
    }

    pub(super) async fn empty(&self, method: reqwest::Method, path: &str) -> Result<(), String> {
        let url = format!("{}{}", self.base, path);
        let resp =
            self.http.request(method, url).bearer_auth(&self.token).send().await.map_err(|e| e.to_string())?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(error_message(resp).await)
        }
    }

    pub(super) async fn empty_with_body(
        &self,
        method: reqwest::Method,
        path: &str,
        body: impl serde::Serialize,
    ) -> Result<(), String> {
        let url = format!("{}{}", self.base, path);
        let resp = self
            .http
            .request(method, url)
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(error_message(resp).await)
        }
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
        assert_eq!(parse_oauth_callback("/callback?token=dhs_abc"), Some(OAuthCallback::Token("dhs_abc".into())));
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
        assert_eq!(parse_oauth_callback("/callback?token="), None);
    }
}
