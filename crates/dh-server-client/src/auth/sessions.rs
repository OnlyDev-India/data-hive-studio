//! Device session shapes shared between the desktop app and the team server
//! (spec 0010). The `impl Store` methods that actually start, renew and
//! verify a session live in `dh-server`'s own `auth::sessions`.

/// Why a token, code or verifier was refused. The router answers 401 for
/// `Unauthorized`, and clients never need to tell "expired" from "ended".
/// No `From<sqlx::Error>` here — see `mod.rs`'s note on `AccessError` for
/// why (spec 0012).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthError {
    Unauthorized,
    Other(String),
}

impl From<String> for AuthError {
    fn from(e: String) -> Self {
        AuthError::Other(e)
    }
}

/// Where a session lives: the desktop app (renewal token in the response body)
/// or the web page (renewal token only as an HttpOnly cookie).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Desktop,
    Web,
}

impl Platform {
    pub fn as_str(&self) -> &'static str {
        match self {
            Platform::Desktop => "desktop",
            Platform::Web => "web",
        }
    }
}

/// The device a session belongs to. `device_id` is a random id the client made
/// once per install, and `device_name` is what the person sees in the list.
#[derive(Debug, Clone)]
pub struct DeviceInfo {
    pub device_id: String,
    pub device_name: String,
    pub platform: Platform,
}

/// A new pair of tokens.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issued {
    pub user_id: String,
    pub session_id: String,
    pub access_token: String,
    /// Seconds the access token lives.
    pub expires_in: i64,
    pub refresh_token: String,
    /// Seconds until this session ends if it is not renewed (the web cookie's
    /// `Max-Age`).
    pub refresh_max_age_secs: i64,
}

/// "Chrome on macOS" from a `User-Agent` header, `Web browser` when the header
/// says nothing useful. The server reads it, so the page cannot lie about it.
pub fn device_name_from_user_agent(ua: &str) -> String {
    let browser = if ua.contains("Edg/") || ua.contains("EdgA/") || ua.contains("EdgiOS/") {
        Some("Edge")
    } else if ua.contains("OPR/") || ua.contains("Opera") {
        Some("Opera")
    } else if ua.contains("Firefox/") || ua.contains("FxiOS/") {
        Some("Firefox")
    } else if ua.contains("Chrome/") || ua.contains("CriOS/") {
        Some("Chrome")
    } else if ua.contains("Safari/") {
        Some("Safari")
    } else {
        None
    };
    // Android and iOS agents also say Linux and Mac OS X, so they go first.
    let os = if ua.contains("Android") {
        Some("Android")
    } else if ua.contains("iPhone") || ua.contains("iPad") {
        Some("iOS")
    } else if ua.contains("Windows") {
        Some("Windows")
    } else if ua.contains("Mac OS X") || ua.contains("Macintosh") {
        Some("macOS")
    } else if ua.contains("CrOS") {
        Some("ChromeOS")
    } else if ua.contains("Linux") || ua.contains("X11") {
        Some("Linux")
    } else {
        None
    };
    match (browser, os) {
        (Some(b), Some(o)) => format!("{b} on {o}"),
        (Some(b), None) => b.to_string(),
        _ => "Web browser".to_string(),
    }
}

/// A device name as stored: trimmed, cut at 80 characters, `fallback` when empty.
pub fn clean_device_name(raw: &str, fallback: &str) -> String {
    let name: String = raw.trim().chars().filter(|c| !c.is_control()).take(80).collect();
    if name.trim().is_empty() {
        fallback.to_string()
    } else {
        name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_names_from_user_agents() {
        let cases = [
            ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Chrome on macOS"),
            ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0", "Edge on Windows"),
            ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", "Safari on macOS"),
            ("Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", "Firefox on Linux"),
            ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36", "Chrome on Android"),
            ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "Safari on iOS"),
            ("", "Web browser"),
            ("curl/8.0", "Web browser"),
        ];
        for (ua, want) in cases {
            assert_eq!(device_name_from_user_agent(ua), want, "{ua}");
        }
    }

    #[test]
    fn device_names_are_trimmed_and_cut() {
        assert_eq!(clean_device_name("  My Mac \n", "Desktop"), "My Mac");
        assert_eq!(clean_device_name("   ", "Desktop"), "Desktop");
        assert_eq!(clean_device_name("", "Desktop"), "Desktop");
        assert_eq!(clean_device_name(&"x".repeat(200), "Desktop").chars().count(), 80);
    }
}
