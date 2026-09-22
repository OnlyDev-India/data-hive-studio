//! Claiming a new server (spec 0010): the pure ticket/setup-code shapes both
//! sides use. A server with no owner prints a setup code in its log; signing
//! in on such a server makes no account, it returns a claim ticket carrying
//! the verified profile, and whoever holds a valid ticket and enters the
//! right code becomes the owner (the `impl Store` half of that lives in
//! `dh-server`'s own `auth::claim`).
//!
//! Both secrets are derived from the master key, so they are the same at
//! every start and across server copies, with nothing new to store or set.

use super::provider::VerifiedProfile;
use crate::crypto;
use sha2::{Digest, Sha256};

/// A claim ticket lives 10 minutes.
pub const TICKET_TTL_MS: i64 = 10 * 60 * 1000;

/// No I, O, 0 or 1, so a code read aloud or typed by hand is hard to get wrong.
const ALPHABET: &[u8; 32] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_CHARS: usize = 20; // 20 characters of 5 bits each = 100 bits

fn derive(label: &str, master_key: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(label.as_bytes());
    h.update(master_key);
    h.finalize().into()
}

/// The setup code for `master_key`, shown as five groups of four:
/// `ABCD-EFGH-JKLM-NPQR-STUV`.
pub fn derive_setup_code(master_key: &[u8; 32]) -> String {
    let d = derive("dh-setup-code-v1", master_key);
    let mut chars = String::with_capacity(CODE_CHARS + 4);
    for i in 0..CODE_CHARS {
        let bit = i * 5;
        let pair = ((d[bit / 8] as u16) << 8) | d[bit / 8 + 1] as u16;
        let idx = (pair >> (16 - 5 - (bit % 8))) & 31;
        if i > 0 && i % 4 == 0 {
            chars.push('-');
        }
        chars.push(ALPHABET[idx as usize] as char);
    }
    chars
}

/// Entry ignores case, dashes and spaces.
pub fn normalize_setup_code(input: &str) -> String {
    input.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).collect()
}

/// Compare without stopping at the first difference.
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// The verified profile inside a claim ticket, plus its expiry.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ClaimTicket {
    pub provider: String,
    pub subject: String,
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub exp_ms: i64,
}

impl ClaimTicket {
    /// Seal the profile into an authenticated, hex encoded ticket. It cannot
    /// be forged or edited, and the profile is hidden from the URL it travels in.
    pub fn seal(profile: &VerifiedProfile, master_key: &[u8; 32], now_ms: i64) -> Result<String, String> {
        let ticket = ClaimTicket {
            provider: profile.provider.clone(),
            subject: profile.subject.clone(),
            email: profile.email.clone(),
            name: profile.name.clone(),
            avatar_url: profile.avatar_url.clone(),
            exp_ms: now_ms + TICKET_TTL_MS,
        };
        let json = serde_json::to_vec(&ticket).map_err(|e| e.to_string())?;
        let sealed = crypto::encrypt(&derive("dh-claim-ticket-v1", master_key), &json)?;
        Ok(hex::encode(sealed))
    }

    /// `None` when the ticket is forged, edited, malformed or past `exp_ms`.
    pub fn open(ticket: &str, master_key: &[u8; 32], now_ms: i64) -> Option<ClaimTicket> {
        let bytes = hex::decode(ticket.trim()).ok()?;
        let json = crypto::decrypt(&derive("dh-claim-ticket-v1", master_key), &bytes).ok()?;
        let t: ClaimTicket = serde_json::from_slice(&json).ok()?;
        (t.exp_ms > now_ms).then_some(t)
    }

    pub fn profile(&self) -> VerifiedProfile {
        VerifiedProfile {
            provider: self.provider.clone(),
            subject: self.subject.clone(),
            email: self.email.clone(),
            name: self.name.clone(),
            avatar_url: self.avatar_url.clone(),
        }
    }
}

/// Why a claim was refused. No `From<sqlx::Error>` here — see `mod.rs`'s
/// note on `AccessError` for why (spec 0012).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClaimError {
    TicketInvalid,
    CodeInvalid,
    AlreadyClaimed,
    Other(String),
}

impl ClaimError {
    pub fn code(&self) -> &str {
        match self {
            ClaimError::TicketInvalid => "ticket_invalid",
            ClaimError::CodeInvalid => "code_invalid",
            ClaimError::AlreadyClaimed => "already_claimed",
            ClaimError::Other(e) => e,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(email: &str) -> VerifiedProfile {
        VerifiedProfile {
            provider: "google".into(),
            subject: format!("sub-{email}"),
            email: email.into(),
            name: "Owner".into(),
            avatar_url: Some("http://a".into()),
        }
    }

    #[test]
    fn setup_code_shape_and_stability() {
        let code = derive_setup_code(&[42u8; 32]);
        assert_eq!(code.len(), 24, "20 characters in five groups of four");
        let groups: Vec<&str> = code.split('-').collect();
        assert_eq!(groups.len(), 5);
        assert!(groups.iter().all(|g| g.len() == 4));
        assert!(code
            .chars()
            .filter(|c| *c != '-')
            .all(|c| ALPHABET.contains(&(c as u8))), "only characters from the alphabet");
        assert!(!code.contains(['I', 'O', '0', '1']));
        assert_eq!(code, derive_setup_code(&[42u8; 32]), "same at every start");
        assert_ne!(code, derive_setup_code(&[43u8; 32]));
    }

    #[test]
    fn code_entry_ignores_case_dashes_and_spaces() {
        let code = derive_setup_code(&[7u8; 32]);
        let typed = code.to_lowercase().replace('-', " ");
        assert_eq!(normalize_setup_code(&typed), normalize_setup_code(&code));
        assert_ne!(normalize_setup_code("ABCD-EFGH"), normalize_setup_code(&code));
    }

    #[test]
    fn constant_time_eq_basics() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }

    #[test]
    fn ticket_roundtrip_expiry_and_tamper() {
        let key = [9u8; 32];
        let sealed = ClaimTicket::seal(&profile("a@x.com"), &key, 1_000).unwrap();
        let t = ClaimTicket::open(&sealed, &key, 2_000).unwrap();
        assert_eq!(t.email, "a@x.com");
        assert_eq!(t.exp_ms, 1_000 + TICKET_TTL_MS);
        // The profile is not readable in the ticket text.
        assert!(!sealed.contains("a@x.com"));

        assert!(ClaimTicket::open(&sealed, &key, 1_000 + TICKET_TTL_MS).is_none(), "expired");
        assert!(ClaimTicket::open(&sealed, &[10u8; 32], 2_000).is_none(), "another server's key");
        let mut edited = sealed.clone().into_bytes();
        let last = edited.len() - 1;
        edited[last] = if edited[last] == b'0' { b'1' } else { b'0' };
        assert!(ClaimTicket::open(&String::from_utf8(edited).unwrap(), &key, 2_000).is_none(), "edited");
        assert!(ClaimTicket::open("not hex", &key, 2_000).is_none());
    }
}
