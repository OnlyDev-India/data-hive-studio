//! Token formats, lifetimes and the PKCE helpers for device sessions (spec
//! 0010, short lived sessions and devices). Every secret is opaque: a prefix
//! plus 32 random bytes as hex, stored only as a hash (`crypto::hash_token`).

use super::claim::constant_time_eq;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

/// Short lived token sent as `Authorization: Bearer` on every `/v1` request.
pub const ACCESS_PREFIX: &str = "dha_";
/// Renewal token, changes on every renewal, never accepted as a Bearer token.
pub const REFRESH_PREFIX: &str = "dhr_";
/// One time login code handed to the client at the end of the provider sign in.
pub const CODE_PREFIX: &str = "dhc_";

pub const ACCESS_TTL_MS: i64 = 15 * 60 * 1000;
pub const IDLE_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000;
pub const ABSOLUTE_TTL_MS: i64 = 90 * 24 * 60 * 60 * 1000;
pub const LOGIN_CODE_TTL_MS: i64 = 60 * 1000;
/// How long a retired renewal token is answered with the same new token.
pub const REPLAY_WINDOW_MS: i64 = 30 * 1000;
pub const MAX_SESSIONS_PER_USER: i64 = 25;
/// `last_used_ms` is written at most this often.
pub const LAST_USED_THROTTLE_MS: i64 = 60 * 1000;

fn new_token(prefix: &str) -> String {
    format!("{prefix}{}", hex::encode(rand::random::<[u8; 32]>()))
}

pub(crate) fn new_access_token() -> String {
    new_token(ACCESS_PREFIX)
}

pub(crate) fn new_refresh_token() -> String {
    new_token(REFRESH_PREFIX)
}

pub(crate) fn new_login_code() -> String {
    new_token(CODE_PREFIX)
}

/// `base64url(sha256(verifier))`, the PKCE S256 challenge.
pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// A fresh PKCE pair `(verifier, challenge)`. The client keeps the verifier to
/// itself and sends only the challenge when it starts the sign in.
pub fn pkce_pair() -> (String, String) {
    let verifier = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
    let challenge = pkce_challenge(&verifier);
    (verifier, challenge)
}

/// A challenge is the 43 character base64url of a SHA 256 digest.
pub fn valid_challenge(challenge: &str) -> bool {
    challenge.len() == 43 && challenge.bytes().all(is_base64url)
}

/// RFC 7636: 43 to 128 unreserved characters.
pub fn valid_verifier(verifier: &str) -> bool {
    (43..=128).contains(&verifier.len())
        && verifier.bytes().all(|b| is_base64url(b) || b == b'.' || b == b'~')
}

fn is_base64url(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'-' || b == b'_'
}

/// Whether `verifier` belongs to `challenge`, compared in constant time.
pub(crate) fn verifier_matches(verifier: &str, challenge: &str) -> bool {
    valid_verifier(verifier) && constant_time_eq(pkce_challenge(verifier).as_bytes(), challenge.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_shapes() {
        for (t, prefix) in [
            (new_access_token(), ACCESS_PREFIX),
            (new_refresh_token(), REFRESH_PREFIX),
            (new_login_code(), CODE_PREFIX),
        ] {
            assert!(t.starts_with(prefix));
            assert_eq!(t.len(), prefix.len() + 64);
        }
        assert_ne!(new_access_token(), new_access_token());
    }

    #[test]
    fn pkce_pair_is_valid_and_matches() {
        let (verifier, challenge) = pkce_pair();
        assert!(valid_verifier(&verifier) && valid_challenge(&challenge));
        assert!(verifier_matches(&verifier, &challenge));
        assert!(!verifier_matches(&format!("{verifier}x"), &challenge));
        assert!(!verifier_matches("short", &challenge));
    }

    #[test]
    fn pkce_matches_the_rfc_example() {
        // RFC 7636 appendix B.
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn malformed_challenges_are_refused() {
        assert!(!valid_challenge(""));
        assert!(!valid_challenge("a".repeat(42).as_str()));
        assert!(!valid_challenge(&format!("{}=", "a".repeat(42))));
        assert!(valid_challenge(&"a".repeat(43)));
    }
}
