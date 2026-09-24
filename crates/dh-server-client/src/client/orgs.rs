use crate::gateway::ConnWithAccess;
use crate::grants::Grant;
use crate::orgs::{OrgEmailInvite, OrgLink, OrgMember, OrgRole, Organization, PendingInvite};
use crate::store::AuditEntry;
use crate::vault::{ConnInput, ConnMeta};
use super::{MeResult, ServerClient};

/// Per-connection grant override request body (matches `dh-server`'s
/// `router::connections::GrantBody`).
#[derive(serde::Deserialize, serde::Serialize)]
pub struct GrantBody {
    #[serde(default)]
    pub can_read: bool,
    #[serde(default)]
    pub can_update: bool,
    #[serde(default)]
    pub can_delete: bool,
}

impl ServerClient {
    // ---- Identity / orgs ------------------------------------------------
    pub async fn me(&self) -> Result<MeResult, String> {
        self.get("/v1/me").await
    }

    pub async fn list_orgs(&self) -> Result<Vec<(Organization, OrgRole)>, String> {
        #[derive(serde::Deserialize)]
        struct Row {
            #[serde(flatten)]
            org: Organization,
            role: OrgRole,
        }
        let rows: Vec<Row> = self.get("/v1/orgs").await?;
        Ok(rows.into_iter().map(|r| (r.org, r.role)).collect())
    }

    pub async fn create_org(&self, name: &str) -> Result<Organization, String> {
        self.send(reqwest::Method::POST, "/v1/orgs", serde_json::json!({ "name": name })).await
    }

    pub async fn org_members(&self, org_id: &str) -> Result<Vec<OrgMember>, String> {
        self.get(&format!("/v1/orgs/{org_id}/members")).await
    }

    pub async fn set_member_role(&self, org_id: &str, user_id: &str, role: OrgRole) -> Result<(), String> {
        self.empty_with_body(
            reqwest::Method::PUT,
            &format!("/v1/orgs/{org_id}/members/{user_id}"),
            serde_json::json!({ "role": role }),
        )
        .await
    }

    pub async fn remove_member(&self, org_id: &str, user_id: &str) -> Result<(), String> {
        self.empty(reqwest::Method::DELETE, &format!("/v1/orgs/{org_id}/members/{user_id}")).await
    }

    // ---- Email invites (spec 0011) -----------------------------------------
    pub async fn list_org_invites(&self, org_id: &str) -> Result<Vec<OrgEmailInvite>, String> {
        self.get(&format!("/v1/orgs/{org_id}/invites")).await
    }

    /// `expires_days` is 1, 7 or 30, or `None` for never. A refreshed invite
    /// comes back the same as a new one.
    pub async fn create_org_invite(
        &self,
        org_id: &str,
        email: &str,
        role: OrgRole,
        expires_days: Option<i64>,
    ) -> Result<OrgEmailInvite, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/orgs/{org_id}/invites"),
            serde_json::json!({ "email": email, "role": role, "expires_days": expires_days }),
        )
        .await
    }

    pub async fn revoke_org_invite(&self, org_id: &str, invite_id: &str) -> Result<(), String> {
        self.empty(reqwest::Method::DELETE, &format!("/v1/orgs/{org_id}/invites/{invite_id}")).await
    }

    /// The signed in person's own pending invites.
    pub async fn my_invites(&self) -> Result<Vec<PendingInvite>, String> {
        self.get("/v1/me/invites").await
    }

    pub async fn accept_invite(&self, invite_id: &str) -> Result<Organization, String> {
        self.send(reqwest::Method::POST, &format!("/v1/me/invites/{invite_id}/accept"), ()).await
    }

    pub async fn decline_invite(&self, invite_id: &str) -> Result<(), String> {
        self.empty(reqwest::Method::POST, &format!("/v1/me/invites/{invite_id}/decline")).await
    }

    // ---- Shareable links ------------------------------------------------------
    pub async fn list_links(&self, org_id: &str) -> Result<Vec<OrgLink>, String> {
        self.get(&format!("/v1/orgs/{org_id}/links")).await
    }

    /// `max_uses` is 1 to 100 and `expires_days` is 1, 7 or 30. The link
    /// always grants the member role.
    pub async fn create_link(&self, org_id: &str, max_uses: i32, expires_days: i64) -> Result<OrgLink, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/orgs/{org_id}/links"),
            serde_json::json!({ "max_uses": max_uses, "expires_days": expires_days }),
        )
        .await
    }

    pub async fn revoke_link(&self, org_id: &str, code: &str) -> Result<(), String> {
        self.empty(reqwest::Method::DELETE, &format!("/v1/orgs/{org_id}/links/{code}")).await
    }

    pub async fn redeem_link(&self, code: &str) -> Result<Organization, String> {
        self.send(reqwest::Method::POST, &format!("/v1/links/{code}/redeem"), ()).await
    }

    pub async fn org_audit(&self, org_id: &str, limit: i64) -> Result<Vec<AuditEntry>, String> {
        self.get(&format!("/v1/orgs/{org_id}/audit?limit={limit}")).await
    }

    // ---- Connections ------------------------------------------------------
    pub async fn org_connections(&self, org_id: &str) -> Result<Vec<ConnWithAccess>, String> {
        self.get(&format!("/v1/orgs/{org_id}/connections")).await
    }

    /// Publish a new shared connection in `org_id`. Requires being a member
    /// of that org (see `dh-server`'s `gateway::create_connection`).
    pub async fn create_connection(&self, org_id: &str, input: &ConnInput) -> Result<ConnMeta, String> {
        self.send(reqwest::Method::POST, &format!("/v1/orgs/{org_id}/connections"), input).await
    }

    pub async fn update_connection(&self, id: &str, input: &ConnInput) -> Result<ConnMeta, String> {
        self.send(reqwest::Method::PUT, &format!("/v1/connections/{id}"), input).await
    }

    pub async fn delete_connection(&self, conn_id: &str) -> Result<(), String> {
        self.empty(reqwest::Method::DELETE, &format!("/v1/connections/{conn_id}")).await
    }

    pub async fn fetch_credentials(&self, conn_id: &str) -> Result<serde_json::Value, String> {
        self.get(&format!("/v1/connections/{conn_id}/credentials")).await
    }

    pub async fn list_grants(&self, org_id: &str, conn_id: &str) -> Result<Vec<Grant>, String> {
        self.get(&format!("/v1/orgs/{org_id}/connections/{conn_id}/grants")).await
    }

    pub async fn set_grant(
        &self,
        org_id: &str,
        conn_id: &str,
        user_id: &str,
        can_read: bool,
        can_update: bool,
        can_delete: bool,
    ) -> Result<(), String> {
        self.empty_with_body(
            reqwest::Method::PUT,
            &format!("/v1/orgs/{org_id}/connections/{conn_id}/grants/{user_id}"),
            GrantBody { can_read, can_update, can_delete },
        )
        .await
    }

    pub async fn revoke_grant(&self, org_id: &str, conn_id: &str, user_id: &str) -> Result<(), String> {
        self.empty(
            reqwest::Method::DELETE,
            &format!("/v1/orgs/{org_id}/connections/{conn_id}/grants/{user_id}"),
        )
        .await
    }
}
