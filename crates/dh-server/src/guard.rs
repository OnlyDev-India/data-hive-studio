//! The three request guards (AC-5, AC-6): the Host check, the Origin check
//! and the optional access key. The server sends no CORS headers, so a page
//! on another origin cannot read a reply either.

use crate::config::{host_of, Config};
use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use sha2::{Digest, Sha256};
use std::sync::Arc;

/// Route that stays open when an access key is set.
const INFO_PATH: &str = "/v1/info";

pub async fn guard(State(cfg): State<Arc<Config>>, req: Request, next: Next) -> Response {
    let headers = req.headers();
    let host = headers
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    if !host_allowed(&cfg, host) {
        return (StatusCode::FORBIDDEN, "host not allowed").into_response();
    }
    if let Some(origin) = headers.get(header::ORIGIN) {
        if !origin_is_own(&cfg, origin.to_str().unwrap_or(""), host) {
            return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
        }
    }
    let path = req.uri().path();
    if let Some(key) = &cfg.access_key {
        if path.starts_with("/v1/") && path != INFO_PATH {
            let sent = headers
                .get(header::AUTHORIZATION)
                .and_then(|h| h.to_str().ok())
                .and_then(|h| h.strip_prefix("Bearer "))
                .unwrap_or("");
            if !keys_match(key, sent) {
                return (StatusCode::UNAUTHORIZED, "access key required").into_response();
            }
        }
    }
    next.run(req).await
}

/// `localhost`, `127.0.0.1`, `[::1]`, or the host of `DH_PUBLIC_URL`.
pub fn host_allowed(cfg: &Config, host_header: &str) -> bool {
    let host = host_of(host_header);
    if matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]") {
        return true;
    }
    cfg.public_host().is_some_and(|p| p == host)
}

/// An `Origin` is ours when it names the same host and port the request was
/// sent to (or the public address).
fn origin_is_own(cfg: &Config, origin: &str, host_header: &str) -> bool {
    let authority = origin
        .split("://")
        .nth(1)
        .unwrap_or("")
        .trim_end_matches('/')
        .to_ascii_lowercase();
    if authority.is_empty() {
        return false;
    }
    if authority == host_header.trim().to_ascii_lowercase() {
        return true;
    }
    cfg.public_url.as_deref().is_some_and(|p| {
        p.split("://")
            .nth(1)
            .unwrap_or("")
            .trim_end_matches('/')
            .to_ascii_lowercase()
            == authority
    })
}

/// Constant time compare. Both sides are hashed first so a key of the wrong
/// length takes the same time as a wrong key of the right one.
pub fn keys_match(expected: &str, sent: &str) -> bool {
    let a = Sha256::digest(expected.as_bytes());
    let b = Sha256::digest(sent.as_bytes());
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_compare_by_value() {
        assert!(keys_match("secret", "secret"));
        assert!(!keys_match("secret", "secre"));
        assert!(!keys_match("secret", "secret!"));
        assert!(!keys_match("secret", ""));
    }

    #[test]
    fn host_check_allows_loopback_names_and_the_public_host() {
        let cfg = Config {
            public_url: Some("https://db.example.com".into()),
            ..Default::default()
        };
        for ok in [
            "localhost",
            "localhost:8080",
            "127.0.0.1:1",
            "[::1]:8080",
            "DB.example.com",
            "db.example.com:443",
        ] {
            assert!(host_allowed(&cfg, ok), "{ok}");
        }
        for bad in [
            "evil.example",
            "127.0.0.1.evil.example",
            "",
            "db.example.com.evil.io",
        ] {
            assert!(!host_allowed(&cfg, bad), "{bad}");
        }
    }
}
