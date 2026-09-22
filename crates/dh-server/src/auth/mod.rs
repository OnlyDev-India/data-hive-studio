//! Server-side identity: OAuth2 (Google/GitHub) sign-in + device sessions.
//! Every caller is a real user, authenticated via a provider, holding a short
//! lived access token verified per-request against `access_tokens` and
//! `device_sessions` (hash and look up, see `dh_server_client::crypto::hash_token`).
//!
//! The server is closed (spec 0010): a new server has no owner and is claimed
//! with a setup code (`claim`); after that an account exists only for a
//! verified email with an open invite (`invites`). The shared shapes (roles,
//! the auth context, sign in decisions, claim tickets, invites, tokens) live
//! in `dh_server_client::auth` (spec 0012); this module holds only the
//! `impl Store` methods and the OAuth provider calls that genuinely run only
//! on the server. Files, by job:
//! - `provider`: the OAuth calls and verified-email parsers
//! - `accounts`: the sign in database work
//! - `claim`: the claim database work
//! - `invites`: server invites (create, refresh, list, revoke)
//! - `roles`: accounts list, role changes, the can-manage-roles switch
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

pub use provider::{authorize_url, exchange_code, normalize_email, provider_config, ProviderConfig};

use crate::store::Store;
use dh_server_client::auth::ServerRole;
use sqlx::Row;

pub(crate) fn user_from_row(r: &sqlx::postgres::PgRow) -> dh_server_client::auth::User {
    let role: String = r.get("server_role");
    dh_server_client::auth::User {
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

impl Store {
    pub async fn user_get(&self, id: &str) -> Result<Option<dh_server_client::auth::User>, String> {
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

