//! The desktop's device session (spec 0010, sessions): the short lived access
//! token, the renewal token that replaces it, and the calls that end sessions.
//!
//! One [`SessionState`] belongs to one server URL and is shared by every
//! client of that server, so two org profiles on one server are one device
//! session. The renewal token is handed to a [`TokenStore`] (the OS keychain
//! in the app; this crate has no keychain dependency) and saved BEFORE the new
//! access token is used, so a crash never leaves the only good token unsaved.

use super::{decode, error_message, normalize_base, ServerClient};
use crate::auth::SessionInfo;
use crate::store::now_ms;
use std::sync::{Arc, Mutex};

/// The error a call returns when the session is over (a renewal was refused),
/// so the app can show the server as signed out.
pub const ERR_SIGNED_OUT: &str = "signed_out";

/// Renew when the access token has this long or less to live.
const RENEW_EARLY_MS: i64 = 60_000;

/// Where the desktop keeps the renewal token for a server.
pub trait TokenStore: Send + Sync {
    fn save(&self, refresh_token: &str) -> Result<(), String>;
    /// Forget the token: the session is over.
    fn clear(&self);
}

/// The answer to `/auth/exchange`, `/auth/claim` and `/auth/refresh`.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct SessionReply {
    pub access_token: String,
    /// Seconds until `access_token` stops working.
    pub expires_in: i64,
    pub session_id: String,
    /// Always present for a desktop session.
    #[serde(default)]
    pub refresh_token: Option<String>,
}

struct Tokens {
    access: Option<String>,
    expires_at_ms: i64,
    /// `None` once signed out.
    refresh: Option<String>,
    session_id: Option<String>,
}

pub struct SessionState {
    base: String,
    http: reqwest::Client,
    store: Box<dyn TokenStore>,
    tokens: Mutex<Tokens>,
    /// Held while one request renews, so a burst of requests renews once.
    renewing: tokio::sync::Mutex<()>,
}

impl SessionState {
    /// A session known only by its saved renewal token. The first request
    /// renews it. `None` is a server the person is signed out of.
    pub fn from_saved(base_url: &str, refresh_token: Option<String>, store: Box<dyn TokenStore>) -> Arc<Self> {
        Arc::new(Self::build(
            base_url,
            Tokens { access: None, expires_at_ms: 0, refresh: refresh_token, session_id: None },
            store,
        ))
    }

    /// A session just made by a sign in. The renewal token is saved first, and
    /// failing to save it is an error: the person would be signed out on the
    /// next start without knowing why.
    pub fn from_reply(base_url: &str, reply: &SessionReply, store: Box<dyn TokenStore>) -> Result<Arc<Self>, String> {
        let refresh = reply.refresh_token.clone().ok_or("the server did not return a renewal token")?;
        store.save(&refresh)?;
        let tokens = Tokens {
            access: Some(reply.access_token.clone()),
            expires_at_ms: now_ms() + reply.expires_in * 1000,
            refresh: Some(refresh),
            session_id: Some(reply.session_id.clone()),
        };
        Ok(Arc::new(Self::build(base_url, tokens, store)))
    }

    fn build(base_url: &str, tokens: Tokens, store: Box<dyn TokenStore>) -> Self {
        Self {
            base: normalize_base(base_url),
            http: reqwest::Client::new(),
            store,
            tokens: Mutex::new(tokens),
            renewing: tokio::sync::Mutex::new(()),
        }
    }

    /// Whether a renewal token is held (the server is not shown as signed out).
    pub fn signed_in(&self) -> bool {
        self.tokens.lock().unwrap().refresh.is_some()
    }

    /// The id of this device's session, once a sign in or renewal has said it.
    pub fn session_id(&self) -> Option<String> {
        self.tokens.lock().unwrap().session_id.clone()
    }

    /// The session is over: drop the tokens and forget the saved one.
    pub fn forget(&self) {
        *self.tokens.lock().unwrap() = Tokens { access: None, expires_at_ms: 0, refresh: None, session_id: None };
        self.store.clear();
    }

    /// The access token to use now, renewing first when it is missing or about
    /// to expire.
    pub(super) async fn access_token(&self) -> Result<String, String> {
        match self.fresh_access(None) {
            Some(token) => Ok(token),
            None => self.renew(None).await,
        }
    }

    /// The server refused `rejected`. Renew once, unless another request
    /// already replaced it while this one waited.
    pub(super) async fn renew_after(&self, rejected: &str) -> Result<String, String> {
        self.renew(Some(rejected)).await
    }

    fn fresh_access(&self, rejected: Option<&str>) -> Option<String> {
        let t = self.tokens.lock().unwrap();
        let token = t.access.as_deref()?;
        (t.expires_at_ms - now_ms() > RENEW_EARLY_MS && Some(token) != rejected).then(|| token.to_string())
    }

    async fn renew(&self, rejected: Option<&str>) -> Result<String, String> {
        let _turn = self.renewing.lock().await;
        if let Some(token) = self.fresh_access(rejected) {
            return Ok(token);
        }
        let refresh = self.tokens.lock().unwrap().refresh.clone().ok_or(ERR_SIGNED_OUT)?;
        let resp = self
            .http
            .post(format!("{}/auth/refresh", self.base))
            .json(&serde_json::json!({ "refresh_token": refresh }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
            self.forget();
            return Err(ERR_SIGNED_OUT.into());
        }
        // Anything else (a network error above, a 5xx here) leaves the session
        // alone: the person is not signed out by a server having a bad moment.
        let reply: SessionReply = decode(resp).await?;
        let next = reply.refresh_token.clone().ok_or("the server did not return a renewal token")?;
        // Saved before the new access token is used. If it cannot be saved the
        // session still works until the app closes, and the person signs in
        // again after that.
        if let Err(e) = self.store.save(&next) {
            eprintln!("could not save the renewed session: {e}");
        }
        let mut t = self.tokens.lock().unwrap();
        t.access = Some(reply.access_token.clone());
        t.expires_at_ms = now_ms() + reply.expires_in * 1000;
        t.refresh = Some(next);
        t.session_id = Some(reply.session_id);
        Ok(reply.access_token)
    }
}

/// The device the app signs in as.
#[derive(Debug, Clone)]
pub struct DeviceParams {
    /// A random id made once per install.
    pub device_id: String,
    pub device_name: String,
}

/// Trade a login code and the PKCE verifier for a session
/// (`POST /auth/exchange`). A wrong verifier, a used code or an expired code is
/// a 401 and makes no session.
pub async fn exchange_code(
    server_base: &str,
    code: &str,
    code_verifier: &str,
    device: &DeviceParams,
) -> Result<SessionReply, String> {
    post_sign_in(
        server_base,
        "/auth/exchange",
        serde_json::json!({
            "code": code, "code_verifier": code_verifier, "device_id": device.device_id,
            "platform": "desktop", "device_name": device.device_name,
        }),
    )
    .await
}

/// Claim a new server: send the ticket from a sign in and the setup code from
/// the server log (`POST /auth/claim`, no token needed). The owner is signed in
/// the same way anyone is. On refusal the error is the server's code:
/// `ticket_invalid`, `code_invalid` or `already_claimed`.
pub async fn claim_server(
    server_base: &str,
    ticket: &str,
    code: &str,
    device: &DeviceParams,
) -> Result<SessionReply, String> {
    let body = serde_json::json!({
        "ticket": ticket, "code": code, "device_id": device.device_id,
        "platform": "desktop", "device_name": device.device_name,
    });
    post_sign_in(server_base, "/auth/claim", body).await.map_err(|body| {
        serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_string))
            .unwrap_or(body)
    })
}

async fn post_sign_in(server_base: &str, path: &str, body: serde_json::Value) -> Result<SessionReply, String> {
    let url = format!("{}{path}", normalize_base(server_base));
    let resp = reqwest::Client::new().post(url).json(&body).send().await.map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        resp.json::<SessionReply>().await.map_err(|e| format!("bad response: {e}"))
    } else {
        Err(error_message(resp).await)
    }
}

impl ServerClient {
    /// Sign out this device: end its session on the server, then forget the
    /// saved token. A session the server already ended counts as signed out.
    pub async fn sign_out(&self) -> Result<(), String> {
        match self.empty(reqwest::Method::POST, "/v1/auth/logout").await {
            Ok(()) => {}
            Err(e) if e == ERR_SIGNED_OUT => {}
            Err(e) => return Err(e),
        }
        self.session.forget();
        Ok(())
    }

    /// This person's devices, most recently used first.
    pub async fn sessions_list(&self) -> Result<Vec<SessionInfo>, String> {
        self.get("/v1/me/sessions").await
    }

    /// End one device. Ending this one signs this app out.
    pub async fn session_end(&self, session_id: &str) -> Result<(), String> {
        self.empty(reqwest::Method::DELETE, &format!("/v1/me/sessions/{session_id}")).await?;
        if self.session.session_id().as_deref() == Some(session_id) {
            self.session.forget();
        }
        Ok(())
    }

    /// Sign out everywhere, this device included.
    pub async fn sessions_end_all(&self) -> Result<(), String> {
        self.empty(reqwest::Method::DELETE, "/v1/me/sessions").await?;
        self.session.forget();
        Ok(())
    }

    /// The server owner ends every session of `user_id`. Returns how many ended.
    pub async fn owner_end_sessions(&self, user_id: &str) -> Result<u64, String> {
        #[derive(serde::Deserialize)]
        struct Ended {
            ended: u64,
        }
        let ended: Ended =
            self.send(reqwest::Method::DELETE, &format!("/v1/admin/users/{user_id}/sessions"), serde_json::json!({}))
                .await?;
        Ok(ended.ended)
    }
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;
