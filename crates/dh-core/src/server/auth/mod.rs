//! Server-side identity: OAuth2 (Google/GitHub) sign-in + bearer session
//! tokens. Every caller is a real user, authenticated via a provider, holding
//! a session token verified per-request against the `sessions` table (hash
//! and look up, see `crypto::hash_token`).
//!
//! The server is closed (spec 0010): a new server has no owner and is claimed
//! with a setup code (`claim`); after that an account exists only for a
//! verified email with an open invite (`invites`). Files, by job:
//! - `provider`: the OAuth calls and verified-email parsers
//! - `accounts`: the sign in decision and account creation
//! - `claim`: setup code, claim ticket, the claim itself
//! - `invites`: server invites (create, refresh, list, revoke)
//! - `roles`: server roles, accounts list, the can-manage-roles switch

mod accounts;
mod claim;
mod invites;
mod provider;
mod roles;

pub use accounts::{decide, Decision, Refusal, SignIn, SignInFacts};
pub use claim::{derive_setup_code, normalize_setup_code, ClaimError, ClaimTicket, TICKET_TTL_MS};
pub use invites::{invite_status, normalize_invite_email, Invite, InviteStatus, InviteWrite};
pub use provider::{
    authorize_url, exchange_code, normalize_email, provider_config, ProfileOutcome, ProviderConfig,
    VerifiedProfile,
};
pub use roles::{check_role_change, Account};

use super::crypto;
use super::store::{now_ms, Store};
use sqlx::Row;

pub const SESSION_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000; // 30 days
pub const SESSION_PREFIX: &str = "dhs_";

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

/// Auth context resolved from a Bearer session token. Carries the server
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

    /// Mint a new session for `user_id`. Returns the plaintext token — only
    /// its hash is ever stored (`crypto::hash_token`, the same scheme the
    /// old device-token model used).
    pub async fn session_create(&self, user_id: &str) -> Result<String, String> {
        let token = format!("{SESSION_PREFIX}{}", hex::encode(rand::random::<[u8; 24]>()));
        let id = crypto::hash_token(&token);
        let now = now_ms();
        sqlx::query(
            "INSERT INTO sessions (id, user_id, created_ms, expires_ms, last_used_ms) VALUES ($1,$2,$3,$4,$5)",
        )
        .bind(&id)
        .bind(user_id)
        .bind(now)
        .bind(now + SESSION_TTL_MS)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(token)
    }

    /// Verify a Bearer session token, returning the resolved identity.
    /// Bumps `last_used_ms` on success; lazily deletes and returns `None` if
    /// the session has expired. One query also reads the server role and the
    /// can-manage-roles switch, so a demotion applies on the next request.
    pub async fn verify_session(&self, bearer: &str) -> Option<AuthCtx> {
        let token = bearer.strip_prefix("Bearer ").unwrap_or(bearer);
        if token.is_empty() {
            return None;
        }
        let id = crypto::hash_token(token);
        let row = sqlx::query(
            "SELECT s.user_id AS user_id, s.expires_ms AS expires_ms,
                    u.email AS email, u.name AS name,
                    u.server_role AS server_role, u.can_manage_roles AS can_manage_roles
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.id = $1",
        )
        .bind(&id)
        .fetch_optional(&self.pool)
        .await
        .ok()??;
        let expires_ms: i64 = row.get("expires_ms");
        if expires_ms < now_ms() {
            let _ = sqlx::query("DELETE FROM sessions WHERE id=$1").bind(&id).execute(&self.pool).await;
            return None;
        }
        let _ = sqlx::query("UPDATE sessions SET last_used_ms=$1 WHERE id=$2")
            .bind(now_ms())
            .bind(&id)
            .execute(&self.pool)
            .await;
        let role: String = row.get("server_role");
        Some(AuthCtx {
            user_id: row.get("user_id"),
            email: row.get("email"),
            name: row.get("name"),
            server_role: ServerRole::parse(&role).unwrap_or(ServerRole::Member),
            can_manage_roles: row.get("can_manage_roles"),
        })
    }

    pub async fn session_revoke(&self, bearer: &str) -> Result<(), String> {
        let token = bearer.strip_prefix("Bearer ").unwrap_or(bearer);
        let id = crypto::hash_token(token);
        sqlx::query("DELETE FROM sessions WHERE id=$1")
            .bind(&id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::store::{test_store, test_user};

    #[tokio::test]
    #[ignore = "requires a live Postgres test database — see server::store::test_store"]
    async fn session_lifecycle() {
        let store = test_store().await;
        let user = test_user(&store, "u@x.com", ServerRole::Member).await;

        let token = store.session_create(&user.id).await.unwrap();
        assert!(token.starts_with(SESSION_PREFIX));

        let ctx = store.verify_session(&format!("Bearer {token}")).await.unwrap();
        assert_eq!(ctx.user_id, user.id);
        assert_eq!(ctx.email, "u@x.com");
        assert_eq!(ctx.server_role, ServerRole::Member);

        // Bearer prefix is optional — verify accepts the bare token too.
        assert!(store.verify_session(&token).await.is_some());

        // Garbage/unknown token → None, not an error.
        assert!(store.verify_session("Bearer nope").await.is_none());

        store.session_revoke(&token).await.unwrap();
        assert!(store.verify_session(&token).await.is_none());
    }

    #[test]
    fn permission_helpers() {
        let ctx = |role, switch| AuthCtx {
            user_id: "u".into(),
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
