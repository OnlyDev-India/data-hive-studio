//! Where the sign in flow may send the browser afterward (spec 0010, AC-10).
//! The callback appends a session token or a claim ticket to `next`, so an
//! unchecked `next` would hand either to any site a crafted link names.
//! Allowed: a loopback address (this computer, for the desktop app), the
//! origin of `DH_PUBLIC_URL`, or an origin listed in `DH_ALLOWED_ORIGINS`.

use reqwest::Url;

/// The address the server is reached at, used to build the OAuth redirect and
/// as one allowed return origin.
pub(super) fn public_base_url() -> String {
    std::env::var("DH_PUBLIC_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".to_string())
}

/// `next` is allowed against the process environment.
pub(super) fn next_allowed_env(next: &str) -> bool {
    let extra = std::env::var("DH_ALLOWED_ORIGINS").unwrap_or_default();
    next_allowed(next, &public_base_url(), &extra)
}

/// Pure form of the check, so it tests without touching the environment.
/// `extra_origins` is the comma separated `DH_ALLOWED_ORIGINS` value.
pub fn next_allowed(next: &str, public_url: &str, extra_origins: &str) -> bool {
    let Ok(url) = Url::parse(next) else { return false };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    // A user name or password in the address is a way to disguise the host.
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    if is_loopback(&url) {
        return true;
    }
    let origin = url.origin().ascii_serialization();
    std::iter::once(public_url)
        .chain(extra_origins.split(','))
        .filter_map(|o| Url::parse(o.trim()).ok())
        .any(|allowed| allowed.origin().ascii_serialization() == origin)
}

fn is_loopback(url: &Url) -> bool {
    let Some(host) = url.host_str() else { return false };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    // An IPv6 host comes back in brackets.
    host.trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<std::net::IpAddr>()
        .is_ok_and(|ip| ip.is_loopback())
}

/// `next` with query pairs added, keeping any query it already has.
pub(super) fn with_query(next: &str, pairs: &[(&str, &str)]) -> Option<String> {
    let mut url = Url::parse(next).ok()?;
    url.query_pairs_mut().extend_pairs(pairs);
    Some(url.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PUBLIC: &str = "https://studio.example.com";

    #[test]
    fn loopback_and_public_origin_pass() {
        for ok in [
            "http://127.0.0.1:5173/callback",
            "http://127.0.0.1:1/other",
            "http://localhost:3000/",
            "http://[::1]:9000/cb",
            "https://studio.example.com/app?x=1",
            "https://studio.example.com",
        ] {
            assert!(next_allowed(ok, PUBLIC, ""), "{ok} should pass");
        }
    }

    #[test]
    fn other_sites_and_odd_schemes_are_refused() {
        for bad in [
            "https://evil.example/steal",
            "javascript:alert(1)",
            "data:text/html,hi",
            "//evil.example",
            "/relative/path",
            "",
            "not a url",
            // Look alikes of an allowed host.
            "https://studio.example.com.evil.example/",
            "http://127.0.0.1.evil.example/",
            "http://localhost.evil.example/",
            "https://evil.example@studio.example.com/",
            "http://127.0.0.1@evil.example/",
            // Same host, different scheme or port, so a different origin.
            "http://studio.example.com/",
            "https://studio.example.com:8443/",
        ] {
            assert!(!next_allowed(bad, PUBLIC, ""), "{bad:?} should be refused");
        }
    }

    #[test]
    fn extra_origins_are_honoured_exactly() {
        let extra = "https://app.example.org, http://web.local:5173";
        assert!(next_allowed("https://app.example.org/x", PUBLIC, extra));
        assert!(next_allowed("http://web.local:5173/", PUBLIC, extra));
        assert!(!next_allowed("http://web.local:5174/", PUBLIC, extra));
        assert!(!next_allowed("https://app.example.org.evil.example/", PUBLIC, extra));
    }

    #[test]
    fn query_is_appended_and_encoded() {
        let out = with_query("http://127.0.0.1:1/cb", &[("error", "not_invited"), ("email", "a+b@x.com")]).unwrap();
        assert_eq!(out, "http://127.0.0.1:1/cb?error=not_invited&email=a%2Bb%40x.com");
        let out = with_query("http://127.0.0.1:1/cb?keep=1", &[("token", "t")]).unwrap();
        assert_eq!(out, "http://127.0.0.1:1/cb?keep=1&token=t");
    }
}
