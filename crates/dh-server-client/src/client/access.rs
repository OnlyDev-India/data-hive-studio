//! Client calls for the Server access page: invites, accounts and roles
//! (`/v1/server/...`, spec 0010).

use crate::auth::{Account, Invite, ServerRole};
use super::ServerClient;

impl ServerClient {
    pub async fn server_invites(&self) -> Result<Vec<Invite>, String> {
        self.get("/v1/server/invites").await
    }

    /// `expires_days` is 1, 7 or 30, or `None` for an invite that never
    /// expires. A refreshed invite comes back the same as a new one.
    pub async fn server_invite_create(&self, email: &str, expires_days: Option<i64>) -> Result<Invite, String> {
        self.send(
            reqwest::Method::POST,
            "/v1/server/invites",
            serde_json::json!({ "email": email, "expires_days": expires_days }),
        )
        .await
    }

    pub async fn server_invite_revoke(&self, invite_id: &str) -> Result<(), String> {
        self.empty(reqwest::Method::DELETE, &format!("/v1/server/invites/{invite_id}")).await
    }

    pub async fn server_accounts(&self) -> Result<Vec<Account>, String> {
        self.get("/v1/server/accounts").await
    }

    pub async fn server_set_role(&self, user_id: &str, role: ServerRole) -> Result<(), String> {
        self.empty_with_body(
            reqwest::Method::PUT,
            &format!("/v1/server/accounts/{user_id}/role"),
            serde_json::json!({ "role": role }),
        )
        .await
    }

    pub async fn server_set_manage_roles(&self, user_id: &str, enabled: bool) -> Result<(), String> {
        self.empty_with_body(
            reqwest::Method::PUT,
            &format!("/v1/server/accounts/{user_id}/manage-roles"),
            serde_json::json!({ "enabled": enabled }),
        )
        .await
    }
}
