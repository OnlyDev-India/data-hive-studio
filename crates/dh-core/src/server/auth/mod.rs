//! Server-side identity: OAuth2 (Google/GitHub) sign-in + device sessions.
//! Every caller is a real user, authenticated via a provider, holding a short
//! lived access token verified per-request against `access_tokens` and
//! `device_sessions` (hash and look up, see `crypto::hash_token`).
//!
//! The server is closed (spec 0010): a new server has no owner and is claimed
//! with a setup code (`claim`); after that an account exists only for a
//! verified email with an open invite (`invites`). Files, by job:
//! - `provider`: the OAuth calls and verified-email parsers
//! - `accounts`: the sign in decision and account creation
//! - `claim`: setup code, claim ticket, the claim itself
//! - `invites`: server invites (create, refresh, list, revoke)
//! - `roles`: server roles, accounts list, the can-manage-roles switch
//!
//! Sessions (spec 0010, short lived sessions and devices):
//! - `tokens`: token formats, lifetimes and the PKCE helpers
//! - `login_codes`: the one time code that ends a provider sign in
//! - `sessions`: start, renew, verify
//! - `devices`: the device list, sign out, end every session of a person

mod accounts;
mod claim;
mod devices;
mod invites;
mod login_codes;
mod provider;
mod roles;
mod sessions;
mod tokens;

pub use accounts::{decide, Decision, Refusal, SignIn, SignInFacts};
pub use claim::{derive_setup_code, normalize_setup_code, ClaimError, ClaimTicket, TICKET_TTL_MS};
pub use invites::{invite_status, normalize_invite_email, Invite, InviteStatus, InviteWrite};
pub use provider::{
    authorize_url, exchange_code, normalize_email, provider_config, ProfileOutcome, ProviderConfig,
    VerifiedProfile,
};
pub use devices::SessionInfo;
pub use roles::{check_role_change, Account};
pub use sessions::{clean_device_name, device_name_from_user_agent, AuthError, DeviceInfo, Issued, Platform};
pub use tokens::{
    pkce_challenge, pkce_pair, valid_challenge, valid_verifier, ABSOLUTE_TTL_MS, ACCESS_PREFIX, ACCESS_TTL_MS,
    IDLE_TTL_MS, LOGIN_CODE_TTL_MS, MAX_SESSIONS_PER_USER, REFRESH_PREFIX, REPLAY_WINDOW_MS,
};

use super::store::Store;
use sqlx::Row;

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
        }
    }
}

pub(crate) fn user_from_row(r: &sqlx::postgres::PgRow) -> User {
    let role: String = r.get("server_role");
    User {
        id: r.get("id"),
        email: r.get("email"),
        name: r.get("name"),
        avatar_url: r.get("avatar_url"),
        server_role: ServerRole::parse(&role).unwrap_or(ServerRole::Member),
        can_manage_roles: r.get("can_manage_roles"),
        created_ms: r.get("created_ms"),
    }
}

pub(crate) const USER_COLUMNS: &str = "id, email, name, avatar_url, server_role, can_manage_roles, created_ms";

/// Why an invite or role call was refused. The router maps each to a status.
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
    /// 500.
    Other(String),
}

impl From<sqlx::Error> for AccessError {
    fn from(e: sqlx::Error) -> Self {
        AccessError::Other(e.to_string())
    }
}

impl Store {
    pub async fn user_get(&self, id: &str) -> Result<Option<User>, String> {
        let row = sqlx::query(&format!("SELECT {USER_COLUMNS} FROM users WHERE id=$1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(row.as_ref().map(user_from_row))
    }

    /// Whether `user_id` is a server owner. Other slices (sessions and
    /// devices) gate their owner-only calls on this.
    pub async fn is_server_owner(&self, user_id: &str) -> Result<bool, String> {
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM users WHERE id=$1 AND server_role='owner')")
            .bind(user_id)
            .fetch_one(&self.pool)
            .await
            .map_err(|e| e.to_string())
    }
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
