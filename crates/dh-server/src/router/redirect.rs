//! Where the sign in flow may send the browser afterward (spec 0010, sessions,
//! AC-3). The callback appends a one time login code, a claim ticket or a
//! refusal to `next`, so an unchecked `next` would hand them to any site a
//! crafted link names. Allowed, and nothing else:
//! - `http://127.0.0.1:<port>/callback`, the desktop app's loopback listener
//! - a path on the origin of `DH_PUBLIC_URL`, the web page this server serves

use reqwest::Url;

/// The address the server is reached at, used to build the OAuth redirect and
/// as the one allowed web return origin.
pub(super) fn public_base_url() -> String {
    std::env::var("DH_PUBLIC_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".to_string())
}

/// Whether the web cookie should be `Secure`: only when the public address is
/// https, so plain http self hosting on a private network still works.
pub(super) fn public_url_is_https() -> bool {
    public_base_url().starts_with("https://")
}

/// A warning for the operator when the web page's renewal cookie will not be
/// `Secure`: the public address is plain http and not this computer. Plain http
/// on a private network still works (the server does not refuse to start), but
/// the cookie can then be read off the wire.
pub fn insecure_public_url_warning(public_url: &str) -> Option<String> {
    let url = Url::parse(public_url).ok();
    let safe = url.as_ref().is_some_and(|u| {
        u.scheme() == "https" || matches!(u.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
    });
    (!safe).then(|| {
        format!(
            "warning: DH_PUBLIC_URL ({public_url:?}) is not https and not a loopback address, so the web \
             sign in cookie is not marked Secure. Serve the web UI over https and set DH_PUBLIC_URL to the https address."
        )
    })
}

/// `next` is allowed against the process environment.
pub(super) fn next_allowed_env(next: &str) -> bool {
    next_allowed(next, &public_base_url())
}

/// Pure form of the check, so it tests without touching the environment.
pub fn next_allowed(next: &str, public_url: &str) -> bool {
    let Ok(url) = Url::parse(next) else { return false };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    // A user name or password in the address is a way to disguise the host.
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    is_desktop_callback(&url)
        || Url::parse(public_url).is_ok_and(|p| p.origin().ascii_serialization() == url.origin().ascii_serialization())
}

fn is_desktop_callback(url: &Url) -> bool {
    url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port().is_some()
        && url.path() == "/callback"
        && url.query().is_none()
        && url.fragment().is_none()
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
    fn desktop_callback_and_public_origin_pass() {
        for ok in [
            "http://127.0.0.1:5173/callback",
            "http://127.0.0.1:49152/callback",
            "https://studio.example.com/app?x=1",
            "https://studio.example.com",
            "https://studio.example.com/",
        ] {
            assert!(next_allowed(ok, PUBLIC), "{ok} should pass");
        }
    }

    #[test]
    fn everything_else_is_refused() {
        for bad in [
            "https://evil.example",
            "https://evil.example/steal",
            "javascript:alert(1)",
            "data:text/html,hi",
            "//evil.example",
            "/relative/path",
            "",
            "not a url",
            // Loopback, but not exactly the desktop callback.
            "http://127.0.0.1:1/other",
            "http://127.0.0.1/callback",
            "http://127.0.0.1:1/callback?x=1",
            "https://127.0.0.1:1/callback",
            "http://localhost:3000/callback",
            "http://[::1]:9000/callback",
            // Look alikes of an allowed host.
            "https://studio.example.com.evil.example/",
            "http://127.0.0.1.evil.example:1/callback",
            "https://evil.example@studio.example.com/",
            "http://127.0.0.1@evil.example:1/callback",
            // Same host, different scheme or port, so a different origin.
            "http://studio.example.com/",
            "https://studio.example.com:8443/",
        ] {
            assert!(!next_allowed(bad, PUBLIC), "{bad:?} should be refused");
        }
    }

    #[test]
    fn plain_http_on_a_network_address_gets_a_warning() {
        assert!(insecure_public_url_warning("https://studio.example.com").is_none());
        assert!(insecure_public_url_warning("http://127.0.0.1:8080").is_none());
        assert!(insecure_public_url_warning("http://localhost:5173").is_none());
        let warning = insecure_public_url_warning("http://studio.internal:8080").unwrap();
        assert!(warning.contains("not marked Secure") && warning.contains("studio.internal"));
        assert!(insecure_public_url_warning("not a url").is_some());
    }

    #[test]
    fn query_is_appended_and_encoded() {
        let out = with_query("http://127.0.0.1:1/callback", &[("error", "not_invited"), ("email", "a+b@x.com")]).unwrap();
        assert_eq!(out, "http://127.0.0.1:1/callback?error=not_invited&email=a%2Bb%40x.com");
        let out = with_query("https://studio.example.com/?keep=1", &[("code", "c")]).unwrap();
        assert_eq!(out, "https://studio.example.com/?keep=1&code=c");
    }
}
