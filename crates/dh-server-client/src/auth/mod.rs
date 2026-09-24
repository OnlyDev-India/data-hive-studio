//! Identity types and pure logic shared between the desktop app and the
//! team server: server roles, the auth context, device session shapes,
//! sign in decisions, claim tickets, invites, and PKCE/token helpers. The
//! server-only halves (every `impl Store` method, the OAuth provider calls,
//! the Google/GitHub response parsers) live in `dh-server`'s own `auth`
//! module — see spec 0012.

mod accounts;
mod claim;
mod devices;
mod invites;
mod provider;
mod roles;
mod sessions;
mod tokens;

pub use accounts::{decide, Decision, Refusal, SignIn, SignInFacts};
pub use claim::{constant_time_eq, derive_setup_code, normalize_setup_code, ClaimError, ClaimTicket, TICKET_TTL_MS};
pub use invites::{invite_status, normalize_invite_email, Invite, InviteStatus, InviteWrite};
pub use provider::{ProfileOutcome, VerifiedProfile};
pub use devices::SessionInfo;
pub use roles::{check_role_change, may_create_org, Account};
pub use sessions::{clean_device_name, device_name_from_user_agent, AuthError, DeviceInfo, Issued, Platform};
pub use tokens::{
    new_access_token, new_login_code, new_refresh_token, pkce_challenge, pkce_pair, valid_challenge, valid_verifier,
    verifier_matches, ABSOLUTE_TTL_MS, ACCESS_PREFIX, ACCESS_TTL_MS, CODE_PREFIX, IDLE_TTL_MS, LAST_USED_THROTTLE_MS,
    LOGIN_CODE_TTL_MS, MAX_SESSIONS_PER_USER, REFRESH_PREFIX, REPLAY_WINDOW_MS,
};

/// A person's role on the whole server (not in an org). Owners hold every
/// server permission, admins invite and revoke, members have neither.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerRole {
    Owner,
    Admin,
    Member,
}

impl ServerRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            ServerRole::Owner => "owner",
            ServerRole::Admin => "admin",
            ServerRole::Member => "member",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "owner" => Some(ServerRole::Owner),
            "admin" => Some(ServerRole::Admin),
            "member" => Some(ServerRole::Member),
            _ => None,
        }
    }
}

/// Auth context resolved from a Bearer access token. Carries the server
/// role because that one is global; it deliberately carries no org role — a
/// user can belong to several organizations with a different role in each,
/// so which org (and role) a given request concerns is resolved per-call
/// against the specific org/connection in play (see `orgs.rs`'s `org_role`,
/// `gateway.rs`'s `authorize`), not baked into the identity itself.
///
/// The server role and switch are read from `users` on every request, so a
/// demotion applies at once without ending any session.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct AuthCtx {
    pub user_id: String,
    /// The device session this request's token belongs to. Server side only:
    /// it is never sent out with the identity.
    #[serde(default, skip_serializing)]
    pub session_id: String,
    pub email: String,
    pub name: String,
    pub server_role: ServerRole,
    pub can_manage_roles: bool,
    /// The per admin "can create organizations" switch (spec 0011). Only an
    /// admin can have it on.
    #[serde(default)]
    pub can_create_orgs: bool,
}

impl AuthCtx {
    pub fn is_owner(&self) -> bool {
        self.server_role == ServerRole::Owner
    }

    /// Owners and admins may invite and revoke.
    pub fn can_invite(&self) -> bool {
        matches!(self.server_role, ServerRole::Owner | ServerRole::Admin)
    }

    /// Owners, and admins whose switch is on, may list accounts and change roles.
    pub fn can_manage_accounts(&self) -> bool {
        self.is_owner() || (self.server_role == ServerRole::Admin && self.can_manage_roles)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub server_role: ServerRole,
    pub can_manage_roles: bool,
    pub can_create_orgs: bool,
    pub created_ms: i64,
}

impl User {
    /// The auth context this user would have on a request.
    pub fn ctx(&self) -> AuthCtx {
        AuthCtx {
            user_id: self.id.clone(),
            session_id: String::new(),
            email: self.email.clone(),
            name: self.name.clone(),
            server_role: self.server_role,
            can_manage_roles: self.can_manage_roles,
            can_create_orgs: self.can_create_orgs,
        }
    }
}

/// Why an invite or role call was refused. The router maps each to a status.
/// No `From<sqlx::Error>` here: that impl would need `sqlx`, which this
/// crate never depends on (spec 0012, AC-8) — `dh-server`'s producing call
/// sites use an explicit `.map_err` instead (the same fix `ClaimError` and
/// `AuthError` need, for the same reason).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccessError {
    /// 400, with a message the person can act on.
    BadRequest(String),
    /// 403: the caller's server role or switch does not allow this.
    Forbidden,
    NotFound,
    /// 409 `already_has_account`: the invited email already has an account.
    AlreadyHasAccount,
    /// 409: the invite was already used.
    AlreadyUsed,
    /// 409 `last_owner`: the server must keep at least one owner.
    LastOwner,
    /// 409 `not_an_admin`: the switch only exists on an admin.
    NotAnAdmin,
    /// 409 `already_member`: the invited email is already in the org.
    AlreadyMember,
    /// 409 `org_limit`: a non owner may create one organization, ever.
    OrgLimit,
    /// 409 `invite_expired`: the invite is past its expiry.
    InviteExpired,
    /// 500.
    Other(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_helpers() {
        let ctx = |role, switch| AuthCtx {
            user_id: "u".into(),
            session_id: "s".into(),
            email: "u@x.com".into(),
            name: "U".into(),
            server_role: role,
            can_manage_roles: switch,
            can_create_orgs: false,
        };
        let owner = ctx(ServerRole::Owner, false);
        assert!(owner.is_owner() && owner.can_invite() && owner.can_manage_accounts());
        let admin = ctx(ServerRole::Admin, false);
        assert!(!admin.is_owner() && admin.can_invite() && !admin.can_manage_accounts());
        let admin_switch = ctx(ServerRole::Admin, true);
        assert!(admin_switch.can_invite() && admin_switch.can_manage_accounts());
        let member = ctx(ServerRole::Member, false);
        assert!(!member.can_invite() && !member.can_manage_accounts());
    }
}
