//! The sign in decision (spec 0010), pure so it tests without Postgres.
//! [`Store::sign_in`], which gathers the facts and carries the outcome out,
//! lives in `dh-server`'s own `auth::accounts`.

use super::provider::VerifiedProfile;
use super::User;

/// Why a sign in was refused. The code travels to the client, which shows
/// its own message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    EmailUnverified,
    NotInvited,
    InviteExpired,
    AccountLinkConflict,
}

impl Refusal {
    pub fn code(&self) -> &'static str {
        match self {
            Refusal::EmailUnverified => "email_unverified",
            Refusal::NotInvited => "not_invited",
            Refusal::InviteExpired => "invite_expired",
            Refusal::AccountLinkConflict => "account_link_conflict",
        }
    }
}

/// What the store found about the verified profile.
#[derive(Debug, Clone, Default)]
pub struct SignInFacts {
    /// The user that already owns this (provider, subject).
    pub identity_user: Option<String>,
    pub claimed: bool,
    /// The user whose account email equals the verified email, and whether
    /// that user already has an identity for this provider.
    pub email_user: Option<(String, bool)>,
    /// An unused invite for the email: its id and whether it has expired.
    pub invite: Option<(String, bool)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    /// Known identity: refresh the profile and sign in.
    SignInExisting { user_id: String },
    /// Server not claimed: hand back a claim ticket, create nothing.
    Ticket,
    /// Same verified email as an existing account: add this identity to it.
    LinkIdentity { user_id: String },
    /// An open invite: create the member account and mark the invite used.
    JoinWithInvite { invite_id: String },
    Refuse(Refusal),
}

/// Steps 2 to 6 of the sign in decision. Step 1 (unverified email) is
/// handled before any lookup, in `Store::sign_in`.
pub fn decide(facts: &SignInFacts) -> Decision {
    if let Some(user_id) = &facts.identity_user {
        return Decision::SignInExisting { user_id: user_id.clone() };
    }
    if !facts.claimed {
        return Decision::Ticket;
    }
    if let Some((user_id, has_identity_for_provider)) = &facts.email_user {
        // A second Google (or GitHub) account with the same email as an
        // account that already has one: refuse rather than silently swap.
        return if *has_identity_for_provider {
            Decision::Refuse(Refusal::AccountLinkConflict)
        } else {
            Decision::LinkIdentity { user_id: user_id.clone() }
        };
    }
    match &facts.invite {
        Some((_, true)) => Decision::Refuse(Refusal::InviteExpired),
        Some((invite_id, false)) => Decision::JoinWithInvite { invite_id: invite_id.clone() },
        None => Decision::Refuse(Refusal::NotInvited),
    }
}

/// The result of a sign in. The caller mints the session (or the ticket).
#[derive(Debug, Clone)]
pub enum SignIn {
    User(User),
    Ticket(VerifiedProfile),
    Refused { refusal: Refusal, email: Option<String> },
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> SignInFacts {
        SignInFacts { claimed: true, ..Default::default() }
    }

    #[test]
    fn known_identity_signs_in_even_when_unclaimed_or_uninvited() {
        let f = SignInFacts { identity_user: Some("u1".into()), claimed: false, ..Default::default() };
        assert_eq!(decide(&f), Decision::SignInExisting { user_id: "u1".into() });
    }

    #[test]
    fn unclaimed_server_only_gives_a_ticket() {
        let f = SignInFacts { claimed: false, invite: Some(("i".into(), false)), ..Default::default() };
        assert_eq!(decide(&f), Decision::Ticket);
    }

    #[test]
    fn same_email_links_unless_the_provider_is_already_linked() {
        let f = SignInFacts { email_user: Some(("u1".into(), false)), ..facts() };
        assert_eq!(decide(&f), Decision::LinkIdentity { user_id: "u1".into() });
        let f = SignInFacts { email_user: Some(("u1".into(), true)), ..facts() };
        assert_eq!(decide(&f), Decision::Refuse(Refusal::AccountLinkConflict));
    }

    #[test]
    fn stranger_needs_an_open_invite() {
        assert_eq!(decide(&facts()), Decision::Refuse(Refusal::NotInvited));
        let open = SignInFacts { invite: Some(("i1".into(), false)), ..facts() };
        assert_eq!(decide(&open), Decision::JoinWithInvite { invite_id: "i1".into() });
        let expired = SignInFacts { invite: Some(("i1".into(), true)), ..facts() };
        assert_eq!(decide(&expired), Decision::Refuse(Refusal::InviteExpired));
    }

    #[test]
    fn refusal_codes_are_stable() {
        assert_eq!(Refusal::EmailUnverified.code(), "email_unverified");
        assert_eq!(Refusal::NotInvited.code(), "not_invited");
        assert_eq!(Refusal::InviteExpired.code(), "invite_expired");
        assert_eq!(Refusal::AccountLinkConflict.code(), "account_link_conflict");
    }
}
