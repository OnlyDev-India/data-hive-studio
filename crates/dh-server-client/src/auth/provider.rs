//! The verified OAuth profile shape shared between the desktop app and the
//! team server (spec 0010). The provider calls and the Google/GitHub
//! response parsers only the server ever exercises live in `dh-server`'s
//! own `auth::provider`.

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
