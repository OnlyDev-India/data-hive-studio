//! Server-side identity: OAuth2 (Google/GitHub) sign-in + bearer session
//! tokens. Replaces the old `adm_`/`tem_` opaque-token model — every caller
//! is now a real user, authenticated via a provider, holding a session
//! token verified per-request against the `sessions` table (same
//! hash-and-look-up shape the old token model used — see `crypto::hash_token`
//! — just backed by a real account instead of an admin-minted credential).

use super::crypto;
use super::store::{now_ms, Store};
use sqlx::Row;

pub const SESSION_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000; // 30 days
pub const SESSION_PREFIX: &str = "dhs_";

/// Auth context resolved from a Bearer session token. Deliberately carries
/// no org/role — a user can belong to several organizations with a
/// different role in each, so which org (and role) a given request concerns
/// is resolved per-call against the specific org/connection in play (see
/// `orgs.rs`'s `org_role`, `gateway.rs`'s `authorize`), not baked into the
/// identity itself.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AuthCtx {
    pub user_id: String,
    pub email: String,
    pub name: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub created_ms: i64,
}

impl Store {
    /// Find-or-create a user by `(provider, subject)` — the OAuth callback's
    /// core step. Email/name/avatar are refreshed from the provider on every
    /// login (people do change their display name/photo).
    pub async fn user_upsert_oauth(
        &self,
        provider: &str,
        subject: &str,
        email: &str,
        name: &str,
        avatar_url: Option<&str>,
    ) -> Result<User, String> {
        if let Some(row) = sqlx::query(
            "SELECT id, created_ms FROM users WHERE oauth_provider=$1 AND oauth_subject=$2",
        )
        .bind(provider)
        .bind(subject)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| e.to_string())?
        {
            let id: String = row.get("id");
            sqlx::query("UPDATE users SET email=$1, name=$2, avatar_url=$3 WHERE id=$4")
                .bind(email)
                .bind(name)
                .bind(avatar_url)
                .bind(&id)
                .execute(&self.pool)
                .await
                .map_err(|e| e.to_string())?;
            return Ok(User {
                id,
                email: email.to_string(),
                name: name.to_string(),
                avatar_url: avatar_url.map(str::to_string),
                created_ms: row.get("created_ms"),
            });
        }
        let id = uuid::Uuid::new_v4().to_string();
        let ts = now_ms();
        sqlx::query(
            "INSERT INTO users (id, email, name, avatar_url, oauth_provider, oauth_subject, created_ms)
             VALUES ($1,$2,$3,$4,$5,$6,$7)",
        )
        .bind(&id)
        .bind(email)
        .bind(name)
        .bind(avatar_url)
        .bind(provider)
        .bind(subject)
        .bind(ts)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(User {
            id,
            email: email.to_string(),
            name: name.to_string(),
            avatar_url: avatar_url.map(str::to_string),
            created_ms: ts,
        })
    }

    pub async fn user_get(&self, id: &str) -> Result<Option<User>, String> {
        let row = sqlx::query("SELECT id, email, name, avatar_url, created_ms FROM users WHERE id=$1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(row.map(|r| User {
            id: r.get("id"),
            email: r.get("email"),
            name: r.get("name"),
            avatar_url: r.get("avatar_url"),
            created_ms: r.get("created_ms"),
        }))
    }

    /// Mint a new session for `user_id`. Returns the plaintext token — only
    /// its hash is ever stored (`crypto::hash_token`, the same scheme the
    /// old device-token model used).
    pub async fn session_create(&self, user_id: &str) -> Result<String, String> {
        let token = format!("{SESSION_PREFIX}{}", hex::encode(rand::random::<[u8; 24]>()));
        let id = crypto::hash_token(&token);
        let now = now_ms();
        sqlx::query(
            "INSERT INTO sessions (id, user_id, created_ms, expires_ms, last_used_ms) VALUES ($1,$2,$3,$4,$5)",
        )
        .bind(&id)
        .bind(user_id)
        .bind(now)
        .bind(now + SESSION_TTL_MS)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(token)
    }

    /// Verify a Bearer session token, returning the resolved identity.
    /// Bumps `last_used_ms` on success; lazily deletes and returns `None` if
    /// the session has expired.
    pub async fn verify_session(&self, bearer: &str) -> Option<AuthCtx> {
        let token = bearer.strip_prefix("Bearer ").unwrap_or(bearer);
        if token.is_empty() {
            return None;
        }
        let id = crypto::hash_token(token);
        let row = sqlx::query(
            "SELECT s.user_id AS user_id, s.expires_ms AS expires_ms,
                    u.email AS email, u.name AS name
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.id = $1",
        )
        .bind(&id)
        .fetch_optional(&self.pool)
        .await
        .ok()??;
        let expires_ms: i64 = row.get("expires_ms");
        if expires_ms < now_ms() {
            let _ = sqlx::query("DELETE FROM sessions WHERE id=$1").bind(&id).execute(&self.pool).await;
            return None;
        }
        let _ = sqlx::query("UPDATE sessions SET last_used_ms=$1 WHERE id=$2")
            .bind(now_ms())
            .bind(&id)
            .execute(&self.pool)
            .await;
        Some(AuthCtx { user_id: row.get("user_id"), email: row.get("email"), name: row.get("name") })
    }

    pub async fn session_revoke(&self, bearer: &str) -> Result<(), String> {
        let token = bearer.strip_prefix("Bearer ").unwrap_or(bearer);
        let id = crypto::hash_token(token);
        sqlx::query("DELETE FROM sessions WHERE id=$1")
            .bind(&id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
//  OAuth2 (Google, GitHub) — authorization-code flow via plain `reqwest`
//  calls. Kept dependency-free of an OAuth client crate: the exchange is
//  three well-documented HTTP calls per provider, and hand-rolling it here
//  is easier to read/test/adapt than fighting an unfamiliar builder API.
// ---------------------------------------------------------------------------

pub struct ProviderConfig {
    pub client_id: String,
    pub client_secret: String,
}

/// Reads `{PROVIDER}_CLIENT_ID`/`{PROVIDER}_CLIENT_SECRET` env vars. `None`
/// when the provider isn't configured (or isn't recognized) — callers
/// should treat that as "sign-in with this provider is unavailable", not
/// a hard error.
pub fn provider_config(provider: &str) -> Option<ProviderConfig> {
    let (id_var, secret_var) = match provider {
        "google" => ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"),
        "github" => ("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"),
        _ => return None,
    };
    // Trim: a trailing newline from `export X=$(cat file)`/a pasted value is
    // invisible in a terminal but makes the provider reject the credential
    // pair outright (GitHub: "incorrect_client_credentials") — trimming
    // here is cheap insurance against that whole class of bug.
    let client_id = std::env::var(id_var).ok()?.trim().to_string();
    let client_secret = std::env::var(secret_var).ok()?.trim().to_string();
    if client_id.is_empty() || client_secret.is_empty() {
        return None;
    }
    Some(ProviderConfig { client_id, client_secret })
}

/// Minimal RFC 3986 percent-encoding for query-string values — mirrors
/// `db::mongodb`'s own hand-rolled `percent_encode`, same reasoning: a full
/// URL-encoding crate is overkill for a handful of query params.
fn url_encode(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => c.encode_utf8(&mut [0u8; 4]).bytes().map(|b| format!("%{b:02X}")).collect(),
        })
        .collect()
}

/// Build the URL to redirect the user to for `provider`'s consent screen.
/// `state` is an opaque anti-CSRF value the caller generates and later
/// re-checks on the callback (see `router.rs`'s auth routes).
pub fn authorize_url(provider: &str, cfg: &ProviderConfig, redirect_uri: &str, state: &str) -> Option<String> {
    match provider {
        "google" => Some(format!(
            "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&access_type=online&prompt=select_account",
            url_encode(&cfg.client_id),
            url_encode(redirect_uri),
            url_encode("openid email profile"),
            url_encode(state),
        )),
        "github" => Some(format!(
            "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope={}&state={}",
            url_encode(&cfg.client_id),
            url_encode(redirect_uri),
            url_encode("read:user user:email"),
            url_encode(state),
        )),
        _ => None,
    }
}

/// Provider-agnostic profile shape both Google's and GitHub's userinfo
/// endpoints get mapped to.
pub struct OAuthProfile {
    pub subject: String,
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
}

/// Exchange an authorization `code` for the signed-in user's profile. Does
/// two real HTTP round-trips to the provider — not unit-testable without
/// live credentials/network, so covered by manual verification instead
/// (see the plan's Phase 1 verification notes), not `cargo test`.
pub async fn exchange_code(
    provider: &str,
    cfg: &ProviderConfig,
    code: &str,
    redirect_uri: &str,
) -> Result<OAuthProfile, String> {
    let client = reqwest::Client::new();
    match provider {
        "google" => {
            let token_res: serde_json::Value = client
                .post("https://oauth2.googleapis.com/token")
                .form(&[
                    ("client_id", cfg.client_id.as_str()),
                    ("client_secret", cfg.client_secret.as_str()),
                    ("code", code),
                    ("redirect_uri", redirect_uri),
                    ("grant_type", "authorization_code"),
                ])
                .send()
                .await
                .map_err(|e| e.to_string())?
                .json()
                .await
                .map_err(|e| e.to_string())?;
            let access_token = token_res
                .get("access_token")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("no access_token in Google response: {token_res}"))?;
            let profile: serde_json::Value = client
                .get("https://www.googleapis.com/oauth2/v3/userinfo")
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|e| e.to_string())?
                .json()
                .await
                .map_err(|e| e.to_string())?;
            Ok(OAuthProfile {
                subject: profile
                    .get("sub")
                    .and_then(|v| v.as_str())
                    .ok_or("Google profile missing sub")?
                    .to_string(),
                email: profile.get("email").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                name: profile.get("name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                avatar_url: profile.get("picture").and_then(|v| v.as_str()).map(str::to_string),
            })
        }
        "github" => {
            let token_res: serde_json::Value = client
                .post("https://github.com/login/oauth/access_token")
                .header("Accept", "application/json")
                .form(&[
                    ("client_id", cfg.client_id.as_str()),
                    ("client_secret", cfg.client_secret.as_str()),
                    ("code", code),
                    ("redirect_uri", redirect_uri),
                ])
                .send()
                .await
                .map_err(|e| e.to_string())?
                .json()
                .await
                .map_err(|e| e.to_string())?;
            let access_token = token_res
                .get("access_token")
                .and_then(|v| v.as_str())
                .ok_or_else(|| format!("no access_token in GitHub response: {token_res}"))?;
            let profile: serde_json::Value = client
                .get("https://api.github.com/user")
                .bearer_auth(access_token)
                .header("User-Agent", "dh-studio")
                .send()
                .await
                .map_err(|e| e.to_string())?
                .json()
                .await
                .map_err(|e| e.to_string())?;
            let subject = profile
                .get("id")
                .map(|v| v.to_string())
                .ok_or("GitHub profile missing id")?;
            let name = profile
                .get("name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| profile.get("login").and_then(|v| v.as_str()))
                .unwrap_or_default()
                .to_string();
            let avatar_url = profile.get("avatar_url").and_then(|v| v.as_str()).map(str::to_string);
            // GitHub's /user only exposes `email` when it's public — fall
            // back to /user/emails for the primary address otherwise.
            let mut email = profile.get("email").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            if email.is_empty() {
                if let Ok(resp) = client
                    .get("https://api.github.com/user/emails")
                    .bearer_auth(access_token)
                    .header("User-Agent", "dh-studio")
                    .send()
                    .await
                {
                    if let Ok(list) = resp.json::<Vec<serde_json::Value>>().await {
                        if let Some(primary) =
                            list.iter().find(|e| e.get("primary").and_then(|v| v.as_bool()).unwrap_or(false))
                        {
                            email = primary.get("email").and_then(|v| v.as_str()).unwrap_or_default().to_string();
                        }
                    }
                }
            }
            Ok(OAuthProfile { subject, email, name, avatar_url })
        }
        _ => Err(format!("unknown OAuth provider: {provider}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn oauth_upsert_creates_then_updates() {
        let store = super::super::store::test_store().await;
        let a = store
            .user_upsert_oauth("google", "sub-1", "a@x.com", "Alice", Some("http://x/a.png"))
            .await
            .unwrap();
        // Same (provider, subject) again — same user id, refreshed fields.
        let b = store
            .user_upsert_oauth("google", "sub-1", "a2@x.com", "Alice B", None)
            .await
            .unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(b.email, "a2@x.com");
        assert_eq!(b.name, "Alice B");
        assert_eq!(b.avatar_url, None);

        // Different subject (even same provider) is a different user.
        let c = store.user_upsert_oauth("google", "sub-2", "c@x.com", "Carl", None).await.unwrap();
        assert_ne!(a.id, c.id);
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn session_lifecycle() {
        let store = super::super::store::test_store().await;
        let user = store.user_upsert_oauth("github", "1", "u@x.com", "U", None).await.unwrap();

        let token = store.session_create(&user.id).await.unwrap();
        assert!(token.starts_with(SESSION_PREFIX));

        let ctx = store.verify_session(&format!("Bearer {token}")).await.unwrap();
        assert_eq!(ctx.user_id, user.id);
        assert_eq!(ctx.email, "u@x.com");

        // Bearer prefix is optional — verify accepts the bare token too.
        assert!(store.verify_session(&token).await.is_some());

        // Garbage/unknown token → None, not an error.
        assert!(store.verify_session("Bearer nope").await.is_none());

        store.session_revoke(&token).await.unwrap();
        assert!(store.verify_session(&token).await.is_none());
    }

    #[test]
    fn authorize_url_shapes() {
        let cfg = ProviderConfig { client_id: "abc".into(), client_secret: "s".into() };
        let google = authorize_url("google", &cfg, "https://x/callback", "st1").unwrap();
        assert!(google.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        assert!(google.contains("client_id=abc"));
        assert!(google.contains("state=st1"));

        let github = authorize_url("github", &cfg, "https://x/callback", "st2").unwrap();
        assert!(github.starts_with("https://github.com/login/oauth/authorize?"));

        assert!(authorize_url("bogus", &cfg, "https://x", "s").is_none());
    }
}
