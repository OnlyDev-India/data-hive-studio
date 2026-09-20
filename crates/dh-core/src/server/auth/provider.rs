//! OAuth2 (Google, GitHub) — authorization-code flow via plain `reqwest`
//! calls. Kept dependency-free of an OAuth client crate: the exchange is
//! three well-documented HTTP calls per provider, and hand-rolling it here
//! is easier to read/test/adapt than fighting an unfamiliar builder API.
//!
//! A sign in is only usable when the provider vouches for the email
//! (spec 0010): Google's `email_verified`, or GitHub's primary email marked
//! verified. The parsers below are pure so they test without a network.

use serde_json::Value;

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

/// A provider profile whose email the provider says the person owns.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct VerifiedProfile {
    pub provider: String,
    pub subject: String,
    /// Lowercased and trimmed.
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
}

/// What a provider told us. `Unverified` carries whatever email it reported
/// (if any) only so the refusal can name it; it is never looked up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileOutcome {
    Verified(VerifiedProfile),
    Unverified { email: Option<String> },
}

pub fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

/// Google's userinfo. `email_verified` must be true (a JSON bool, or the
/// string "true" that some Google endpoints return).
pub fn parse_google_profile(profile: &Value) -> Result<ProfileOutcome, String> {
    let subject = str_field(profile, "sub").ok_or("Google profile missing sub")?.to_string();
    let email = str_field(profile, "email").map(normalize_email).filter(|e| !e.is_empty());
    let verified = match profile.get("email_verified") {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => s == "true",
        _ => false,
    };
    let Some(email) = email.filter(|_| verified) else {
        return Ok(ProfileOutcome::Unverified {
            email: str_field(profile, "email").map(normalize_email).filter(|e| !e.is_empty()),
        });
    };
    Ok(ProfileOutcome::Verified(VerifiedProfile {
        provider: "google".into(),
        subject,
        email,
        name: str_field(profile, "name").unwrap_or_default().to_string(),
        avatar_url: str_field(profile, "picture").map(str::to_string),
    }))
}

/// The address GitHub marks both `primary` and `verified`. The public profile
/// email is never used: it can be any address the person typed.
pub fn pick_github_email(emails: &[Value]) -> Option<String> {
    let flag = |e: &Value, k: &str| e.get(k).and_then(|v| v.as_bool()).unwrap_or(false);
    emails
        .iter()
        .find(|e| flag(e, "primary") && flag(e, "verified"))
        .and_then(|e| str_field(e, "email"))
        .map(normalize_email)
        .filter(|e| !e.is_empty())
}

/// GitHub's `/user` plus the `/user/emails` list.
pub fn parse_github_profile(profile: &Value, emails: &[Value]) -> Result<ProfileOutcome, String> {
    let subject = profile.get("id").map(|v| v.to_string()).ok_or("GitHub profile missing id")?;
    let Some(email) = pick_github_email(emails) else {
        return Ok(ProfileOutcome::Unverified { email: None });
    };
    let name = str_field(profile, "name")
        .filter(|s| !s.is_empty())
        .or_else(|| str_field(profile, "login"))
        .unwrap_or_default()
        .to_string();
    Ok(ProfileOutcome::Verified(VerifiedProfile {
        provider: "github".into(),
        subject,
        email,
        name,
        avatar_url: str_field(profile, "avatar_url").map(str::to_string),
    }))
}

async fn json_ok(resp: reqwest::Response, what: &str) -> Result<Value, String> {
    let status = resp.status();
    let body: Value = resp.json().await.map_err(|e| e.to_string())?;
    if status.is_success() {
        Ok(body)
    } else {
        Err(format!("{what} failed ({status}): {body}"))
    }
}

/// Exchange an authorization `code` for the signed-in user's profile. Does
/// real HTTP round-trips to the provider — not unit-testable without live
/// credentials/network, so covered by manual verification instead; the
/// parsers above carry the logic and are unit tested.
pub async fn exchange_code(
    provider: &str,
    cfg: &ProviderConfig,
    code: &str,
    redirect_uri: &str,
) -> Result<ProfileOutcome, String> {
    let client = reqwest::Client::new();
    match provider {
        "google" => {
            let token_res: Value = client
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
            let access_token = str_field(&token_res, "access_token")
                .ok_or_else(|| format!("no access_token in Google response: {token_res}"))?;
            let resp = client
                .get("https://www.googleapis.com/oauth2/v3/userinfo")
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            parse_google_profile(&json_ok(resp, "Google userinfo").await?)
        }
        "github" => {
            let token_res: Value = client
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
            let access_token = str_field(&token_res, "access_token")
                .ok_or_else(|| format!("no access_token in GitHub response: {token_res}"))?;
            let profile = json_ok(
                client
                    .get("https://api.github.com/user")
                    .bearer_auth(access_token)
                    .header("User-Agent", "dh-studio")
                    .send()
                    .await
                    .map_err(|e| e.to_string())?,
                "GitHub user",
            )
            .await?;
            // A failed emails call is a provider error, not "no verified
            // email": the person did nothing wrong and should be able to retry.
            let emails = json_ok(
                client
                    .get("https://api.github.com/user/emails")
                    .bearer_auth(access_token)
                    .header("User-Agent", "dh-studio")
                    .send()
                    .await
                    .map_err(|e| e.to_string())?,
                "GitHub emails",
            )
            .await?;
            let emails = emails.as_array().ok_or("GitHub emails response was not a list")?;
            parse_github_profile(&profile, emails)
        }
        _ => Err(format!("unknown OAuth provider: {provider}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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

    #[test]
    fn google_needs_email_verified_true() {
        let ok = parse_google_profile(&json!({
            "sub": "1", "email": "  A@X.com ", "email_verified": true, "name": "A", "picture": "http://p"
        }))
        .unwrap();
        let ProfileOutcome::Verified(p) = ok else { panic!("expected verified") };
        assert_eq!(p.email, "a@x.com");
        assert_eq!(p.provider, "google");
        assert_eq!(p.avatar_url.as_deref(), Some("http://p"));

        // The string form some Google endpoints return also counts.
        assert!(matches!(
            parse_google_profile(&json!({"sub":"1","email":"a@x.com","email_verified":"true"})).unwrap(),
            ProfileOutcome::Verified(_)
        ));

        for bad in [
            json!({"sub":"1","email":"a@x.com","email_verified":false}),
            json!({"sub":"1","email":"a@x.com"}),
            json!({"sub":"1","email":"a@x.com","email_verified":"yes"}),
        ] {
            let out = parse_google_profile(&bad).unwrap();
            assert_eq!(out, ProfileOutcome::Unverified { email: Some("a@x.com".into()) });
        }
        assert_eq!(
            parse_google_profile(&json!({"sub":"1","email_verified":true})).unwrap(),
            ProfileOutcome::Unverified { email: None }
        );
        assert!(parse_google_profile(&json!({"email":"a@x.com","email_verified":true})).is_err());
    }

    #[test]
    fn github_uses_primary_verified_email_only() {
        let emails = vec![
            json!({"email": "old@x.com", "primary": false, "verified": true}),
            json!({"email": "Main@X.com", "primary": true, "verified": true}),
        ];
        // The public profile email must be ignored even when it is set.
        let profile = json!({"id": 7, "login": "octo", "name": "", "email": "public@x.com", "avatar_url": "http://a"});
        let ProfileOutcome::Verified(p) = parse_github_profile(&profile, &emails).unwrap() else {
            panic!("expected verified")
        };
        assert_eq!(p.email, "main@x.com");
        assert_eq!(p.subject, "7");
        assert_eq!(p.name, "octo", "falls back to login when name is empty");

        let unverified_primary = vec![json!({"email": "a@x.com", "primary": true, "verified": false})];
        assert_eq!(
            parse_github_profile(&profile, &unverified_primary).unwrap(),
            ProfileOutcome::Unverified { email: None }
        );
        let secondary_only = vec![json!({"email": "a@x.com", "primary": false, "verified": true})];
        assert_eq!(
            parse_github_profile(&profile, &secondary_only).unwrap(),
            ProfileOutcome::Unverified { email: None }
        );
        assert_eq!(parse_github_profile(&profile, &[]).unwrap(), ProfileOutcome::Unverified { email: None });
    }
}
