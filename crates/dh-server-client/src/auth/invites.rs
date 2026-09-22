//! Server invite shapes shared between the desktop app and the team server
//! (spec 0010). The `impl Store` methods that create, list and revoke
//! invites live in `dh-server`'s own `auth::invites`.

use super::AccessError;

const MAX_EMAIL_LEN: usize = 254;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InviteStatus {
    Open,
    Used,
    Expired,
}

/// Used if `used_ms` is set, else expired once `expires_ms` has passed, else
/// open. Derived, never stored.
pub fn invite_status(used_ms: Option<i64>, expires_ms: Option<i64>, now: i64) -> InviteStatus {
    if used_ms.is_some() {
        InviteStatus::Used
    } else if expires_ms.is_some_and(|t| t <= now) {
        InviteStatus::Expired
    } else {
        InviteStatus::Open
    }
}

/// An invite as the Server access page shows it.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Invite {
    pub id: String,
    pub email: String,
    /// Email of the person who made the invite.
    pub created_by: String,
    pub created_ms: i64,
    pub expires_ms: Option<i64>,
    pub used_ms: Option<i64>,
    /// Email of the account the invite created, once used.
    pub used_by: Option<String>,
    pub status: InviteStatus,
}

/// A new invite is `Created` (HTTP 201); inviting an email that already has
/// an open or expired invite `Refreshed` it (HTTP 200).
#[derive(Debug, Clone)]
pub enum InviteWrite {
    Created(Invite),
    Refreshed(Invite),
}

/// One `@` with text on both sides, at most 254 characters. Lowercased and
/// trimmed. Not a full address parser: the provider verified the real one.
pub fn normalize_invite_email(raw: &str) -> Result<String, AccessError> {
    let email = raw.trim().to_lowercase();
    let ok = email.len() <= MAX_EMAIL_LEN
        && email.matches('@').count() == 1
        && email.split_once('@').is_some_and(|(local, domain)| !local.is_empty() && !domain.is_empty())
        && !email.chars().any(char::is_whitespace);
    if ok {
        Ok(email)
    } else {
        Err(AccessError::BadRequest("enter a valid email address".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_is_derived() {
        assert_eq!(invite_status(Some(5), None, 10), InviteStatus::Used);
        assert_eq!(invite_status(Some(5), Some(1), 10), InviteStatus::Used, "used wins over expired");
        assert_eq!(invite_status(None, Some(10), 10), InviteStatus::Expired);
        assert_eq!(invite_status(None, Some(11), 10), InviteStatus::Open);
        assert_eq!(invite_status(None, None, 10), InviteStatus::Open, "never expires");
    }

    #[test]
    fn email_is_checked_and_lowercased() {
        assert_eq!(normalize_invite_email("  Bob@Example.COM ").unwrap(), "bob@example.com");
        for bad in ["", "bob", "@x.com", "bob@", "a@b@c.com", "a b@x.com"] {
            assert!(normalize_invite_email(bad).is_err(), "{bad:?} should be refused");
        }
        let long = format!("{}@x.com", "a".repeat(250));
        assert!(normalize_invite_email(&long).is_err());
    }
}
