//! Typed HTTP client used by desktop builds to talk to a dh-server. Holds a
//! session token (from an OAuth login — see `auth.rs`), not a team header:
//! which organization a call concerns is either in the URL path
//! (`/v1/orgs/{org_id}/...`) or implied by the connection id itself
//! (`/v1/c/{conn_id}/...` — the server resolves its org internally).

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
/// the server redirects the browser afterward, with the new session token
/// appended as a `token=` query param (not a `#` fragment — fragments never
/// reach a plain server-side listener).
pub fn oauth_start_url(server_base: &str, provider: &str, next: &str) -> String {
    format!(
        "{}/auth/{provider}/start?next={}",
        normalize_base(server_base),
        urlencode(next),
    )
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
