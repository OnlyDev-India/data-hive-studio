//! Claiming a new server (spec 0010). A server with no owner prints a setup
//! code in its log. Signing in on such a server makes no account: it returns
//! a claim ticket carrying the verified profile, and whoever holds a valid
//! ticket and enters the right code becomes the owner.
//!
//! Both secrets are derived from the master key, so they are the same at
//! every start and across server copies, with nothing new to store or set.

use super::accounts::{insert_identity, insert_user, load_user};
use super::provider::VerifiedProfile;
use super::User;
use crate::server::crypto;
use crate::server::store::{audit_in, now_ms, Store};
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
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
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

    fn profile(&self) -> VerifiedProfile {
        VerifiedProfile {
            provider: self.provider.clone(),
            subject: self.subject.clone(),
            email: self.email.clone(),
            name: self.name.clone(),
            avatar_url: self.avatar_url.clone(),
        }
    }
}

/// Why a claim was refused.
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

impl From<sqlx::Error> for ClaimError {
    fn from(e: sqlx::Error) -> Self {
        ClaimError::Other(e.to_string())
    }
}

impl Store {
    /// The setup code for this server.
    pub fn setup_code(&self) -> String {
        derive_setup_code(&self.master_key)
    }

    pub async fn is_claimed(&self) -> Result<bool, String> {
        sqlx::query_scalar("SELECT claimed_ms IS NOT NULL FROM server_settings WHERE id=1")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| e.to_string())
    }

    /// Claim the server: open the ticket, check the code, then in one
    /// transaction flip `claimed_ms` (a guarded update, so of two simultaneous
    /// claims exactly one wins) and create the owner. Nothing is created on
    /// any refusal.
    pub async fn claim(&self, ticket: &str, code: &str) -> Result<User, ClaimError> {
        self.claim_at(ticket, code, now_ms()).await
    }

    pub(crate) async fn claim_at(&self, ticket: &str, code: &str, now: i64) -> Result<User, ClaimError> {
        let ticket = ClaimTicket::open(ticket, &self.master_key, now).ok_or(ClaimError::TicketInvalid)?;
        let expected = normalize_setup_code(&self.setup_code());
        if !constant_time_eq(normalize_setup_code(code).as_bytes(), expected.as_bytes()) {
            return Err(ClaimError::CodeInvalid);
        }
        let profile = ticket.profile();
        let mut tx = self.pool.begin().await?;
        // The row lock also makes a simultaneous second claim wait here.
        let won = sqlx::query("UPDATE server_settings SET claimed_ms=$1 WHERE id=1 AND claimed_ms IS NULL")
            .bind(now)
            .execute(&mut *tx)
            .await?;
        if won.rows_affected() != 1 {
            return Err(ClaimError::AlreadyClaimed);
        }
        let id = uuid::Uuid::new_v4().to_string();
        insert_user(&mut tx, &id, &profile, "owner").await?;
        insert_identity(&mut tx, &id, &profile).await?;
        sqlx::query("UPDATE server_settings SET claimed_by=$1 WHERE id=1").bind(&id).execute(&mut *tx).await?;
        audit_in(&mut *tx, &id, "server.claimed", &profile.email, None).await?;
        let user = load_user(&mut tx, &id).await?;
        tx.commit().await?;
        Ok(user)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::store::test_store;

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

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn right_code_makes_the_owner_once() {
        let store = test_store().await;
        let ticket = ClaimTicket::seal(&profile("boss@x.com"), &store.master_key, now_ms()).unwrap();
        assert!(!store.is_claimed().await.unwrap());
        let owner = store.claim(&ticket, &store.setup_code().to_lowercase()).await.unwrap();
        assert_eq!(owner.email, "boss@x.com");
        assert_eq!(owner.server_role, crate::server::auth::ServerRole::Owner);
        assert!(store.is_claimed().await.unwrap());

        let claimed_by: Option<String> = sqlx::query_scalar("SELECT claimed_by FROM server_settings").fetch_one(&store.pool).await.unwrap();
        assert_eq!(claimed_by.as_deref(), Some(owner.id.as_str()));
        let audit: i64 = sqlx::query_scalar("SELECT count(*) FROM audit WHERE action='server.claimed' AND org_id IS NULL")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(audit, 1);

        // The code stops working the moment the server is claimed.
        let second = ClaimTicket::seal(&profile("late@x.com"), &store.master_key, now_ms()).unwrap();
        assert_eq!(store.claim(&second, &store.setup_code()).await, Err(ClaimError::AlreadyClaimed));
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn bad_code_bad_ticket_and_expired_ticket_create_nothing() {
        let store = test_store().await;
        let good = ClaimTicket::seal(&profile("a@x.com"), &store.master_key, now_ms()).unwrap();
        assert_eq!(store.claim(&good, "AAAA-AAAA-AAAA-AAAA-AAAA").await, Err(ClaimError::CodeInvalid));
        assert_eq!(store.claim("00ff", &store.setup_code()).await, Err(ClaimError::TicketInvalid));
        let stale = ClaimTicket::seal(&profile("a@x.com"), &store.master_key, now_ms() - TICKET_TTL_MS - 1).unwrap();
        assert_eq!(store.claim(&stale, &store.setup_code()).await, Err(ClaimError::TicketInvalid));
        // A ticket from another server's key is forged as far as this one can tell.
        let forged = ClaimTicket::seal(&profile("a@x.com"), &[1u8; 32], now_ms()).unwrap();
        assert_eq!(store.claim(&forged, &store.setup_code()).await, Err(ClaimError::TicketInvalid));

        let users: i64 = sqlx::query_scalar("SELECT count(*) FROM users").fetch_one(&store.pool).await.unwrap();
        assert_eq!(users, 0);
        assert!(!store.is_claimed().await.unwrap());
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn two_simultaneous_claims_yield_one_owner() {
        let store = test_store().await;
        let a = ClaimTicket::seal(&profile("a@x.com"), &store.master_key, now_ms()).unwrap();
        let b = ClaimTicket::seal(&profile("b@x.com"), &store.master_key, now_ms()).unwrap();
        let code = store.setup_code();
        let (ra, rb) = tokio::join!(store.claim(&a, &code), store.claim(&b, &code));
        let wins = [ra.is_ok(), rb.is_ok()].iter().filter(|w| **w).count();
        assert_eq!(wins, 1);
        let loser = if ra.is_ok() { rb } else { ra };
        assert_eq!(loser, Err(ClaimError::AlreadyClaimed));
        let owners: i64 = sqlx::query_scalar("SELECT count(*) FROM users WHERE server_role='owner'")
            .fetch_one(&store.pool)
            .await
            .unwrap();
        assert_eq!(owners, 1);
    }
}
