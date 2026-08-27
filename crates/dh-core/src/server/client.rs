//! Typed HTTP client used by desktop builds to talk to a dh-server.

use crate::api::{QueryOp, QueryResult, TableInfo, TableSchema};
use crate::server::router::{SqlBody, TokenMintBody};
use crate::server::grants::Grant;
use crate::server::identity::{AuthCtx, TokenGrantSpec};
use crate::server::router::GrantBody;
use crate::server::store::AuditEntry;
use crate::server::vault::{ConnInput, ConnMeta};

#[derive(Clone)]
pub struct ServerClient {
    base: String,
    token: String,
    /// Team name for tem_ tokens — sent as X-Team on every request.
    team_name: Option<String>,
    http: reqwest::Client,
}

pub fn normalize_base(url: &str) -> String {
    let t = url.trim().trim_end_matches('/');
    if t.starts_with("http") {
        t.to_string()
    } else {
        format!("https://{t}")
    }
}

impl ServerClient {
    pub fn new(base_url: &str, token: &str) -> Self {
        Self::with_team(base_url, token, None)
    }

    pub fn with_team(base_url: &str, token: &str, team_name: Option<String>) -> Self {
        Self {
            base: normalize_base(base_url),
            token: token.to_string(),
            team_name,
            http: reqwest::Client::new(),
        }
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let url = format!("{}{}", self.base, path);
        let mut req = self.http.get(url).bearer_auth(&self.token);
        if let Some(team) = &self.team_name {
            req = req.header("X-Team", team);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        decode(resp).await
    }

    async fn send<T: serde::de::DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: impl serde::Serialize,
    ) -> Result<T, String> {
        let url = format!("{}{}", self.base, path);
        let mut req = self.http.request(method, url).bearer_auth(&self.token);
        if let Some(team) = &self.team_name {
            req = req.header("X-Team", team);
        }
        let resp = req.json(&body).send().await.map_err(|e| e.to_string())?;
        decode(resp).await
    }

    async fn empty(&self, method: reqwest::Method, path: &str) -> Result<(), String> {
        let url = format!("{}{}", self.base, path);
        let resp = self
            .http
            .request(method, url)
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(error_message(resp).await)
        }
    }

    pub async fn me(&self) -> Result<AuthCtx, String> {
        self.get("/v1/me").await
    }

    pub async fn connections(&self) -> Result<Vec<crate::server::gateway::ConnWithAccess>, String> {
        self.get("/v1/connections").await
    }

    pub async fn fetch_credentials(&self, conn_id: &str) -> Result<serde_json::Value, String> {
        self.get(&format!("/v1/connections/{conn_id}/credentials")).await
    }

    pub async fn update_connection(&self, id: &str, input: &ConnInput) -> Result<ConnMeta, String> {
        self.send(reqwest::Method::PUT, &format!("/v1/connections/{id}"), input).await
    }

    pub async fn list_tables(&self, conn_id: &str) -> Result<Vec<TableInfo>, String> {
        self.get(&format!("/v1/c/{conn_id}/tables")).await
    }

    pub async fn list_schemas(&self, conn_id: &str) -> Result<Vec<String>, String> {
        self.get(&format!("/v1/c/{conn_id}/schemas")).await
    }

    pub async fn table_schema(&self, conn_id: &str, table: &str) -> Result<TableSchema, String> {
        self.get(&format!("/v1/c/{conn_id}/schema/{table}")).await
    }

    pub async fn run_sql(&self, conn_id: &str, sql: &str) -> Result<QueryResult, String> {
        self.send(reqwest::Method::POST, &format!("/v1/c/{conn_id}/sql"), SqlBody { sql: sql.into() })
            .await
    }

    pub async fn execute_op(&self, conn_id: &str, op: &QueryOp) -> Result<QueryResult, String> {
        self.send(reqwest::Method::POST, &format!("/v1/c/{conn_id}/op"), op).await
    }

    // Admin surface

    /// Publish a new shared connection. Admin scope only.
    pub async fn create_connection(&self, input: &ConnInput) -> Result<ConnMeta, String> {
        self.send(reqwest::Method::POST, "/v1/connections", input).await
    }

    /// Delete (archive) a shared connection. Allowed for admins and devices
    /// holding a `can_delete` grant on it.
    pub async fn delete_connection(&self, conn_id: &str) -> Result<(), String> {
        self.empty(reqwest::Method::DELETE, &format!("/v1/connections/{conn_id}"))
            .await
    }

    /// Mint an ADMIN (`adm_…`) token for a named user.
    pub async fn admin_mint_admin_token(&self, user_name: &str) -> Result<String, String> {
        let body = TokenMintBody {
            kind: "admin".into(),
            user_name: Some(user_name.into()),
            team_name: None,
            grants: vec![],
        };
        let r: serde_json::Value =
            self.send(reqwest::Method::POST, "/v1/admin/tokens", Some(&body)).await?;
        Ok(r.get("token").and_then(|v| v.as_str()).unwrap_or_default().to_string())
    }

    /// Mint a scoped TEAM (`tem_…`) token bound to a team name + grants.
    pub async fn admin_mint_team_token(
        &self,
        user_name: &str,
        team_name: &str,
        grants: Vec<TokenGrantSpec>,
    ) -> Result<String, String> {
        let body = TokenMintBody {
            kind: "team".into(),
            user_name: Some(user_name.into()),
            team_name: Some(team_name.into()),
            grants,
        };
        let r: serde_json::Value =
            self.send(reqwest::Method::POST, "/v1/admin/tokens", Some(&body)).await?;
        Ok(r.get("token").and_then(|v| v.as_str()).unwrap_or_default().to_string())
    }

    pub async fn admin_devices(&self) -> Result<Vec<crate::server::identity::DeviceInfo>, String> {
        self.get("/v1/admin/devices").await
    }

    pub async fn admin_tokens_list(
        &self,
    ) -> Result<Vec<crate::server::identity::TokenInfo>, String> {
        self.get("/v1/admin/tokens").await
    }

    pub async fn admin_delete_token(&self, token: &str) -> Result<(), String> {
        self.empty(reqwest::Method::DELETE, &format!("/v1/admin/tokens/{token}")).await
    }

    pub async fn admin_revoke_device(&self, device_id: &str) -> Result<(), String> {
        self.empty(reqwest::Method::DELETE, &format!("/v1/admin/devices/{device_id}")).await
    }

    pub async fn admin_grants(&self, device_id: &str) -> Result<Vec<Grant>, String> {
        self.get(&format!("/v1/admin/grants/{device_id}")).await
    }

    pub async fn admin_set_grant(
        &self,
        device_id: &str,
        conn_id: &str,
        can_read: bool,
        can_update: bool,
        can_delete: bool,
    ) -> Result<(), String> {
        self.empty_with_body(
            reqwest::Method::PUT,
            &format!("/v1/admin/grants/{device_id}/{conn_id}"),
            GrantBody { can_read, can_update, can_delete },
        )
        .await
    }

    pub async fn admin_revoke_grant(&self, device_id: &str, conn_id: &str) -> Result<(), String> {
        self.empty(reqwest::Method::DELETE, &format!("/v1/admin/grants/{device_id}/{conn_id}"))
            .await
    }

    /// Wholesale-replace a device's connection access.
    pub async fn admin_replace_device_grants(
        &self,
        device_id: &str,
        specs: &[TokenGrantSpec],
    ) -> Result<(), String> {
        use std::collections::HashSet;
        let current = self.admin_grants(device_id).await?;
        let keep: HashSet<&str> = specs.iter().map(|s| s.conn_id.as_str()).collect();
        for g in &current {
            if !keep.contains(g.conn_id.as_str()) {
                self.admin_revoke_grant(device_id, &g.conn_id).await?;
            }
        }
        for s in specs {
            self.admin_set_grant(device_id, &s.conn_id, s.can_read, s.can_update, s.can_delete)
                .await?;
        }
        Ok(())
    }

    pub async fn admin_audit(&self, limit: i64) -> Result<Vec<AuditEntry>, String> {
        self.get(&format!("/v1/admin/audit?limit={limit}")).await
    }

    async fn empty_with_body(
        &self,
        method: reqwest::Method,
        path: &str,
        body: impl serde::Serialize,
    ) -> Result<(), String> {
        let url = format!("{}{}", self.base, path);
        let mut req = self.http.request(method, url).bearer_auth(&self.token);
        if let Some(team) = &self.team_name {
            req = req.header("X-Team", team);
        }
        let resp = req.json(&body).send().await.map_err(|e| e.to_string())?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(error_message(resp).await)
        }
    }
}

async fn decode<T: serde::de::DeserializeOwned>(resp: reqwest::Response) -> Result<T, String> {
    if resp.status().is_success() {
        resp.json::<T>().await.map_err(|e| format!("bad response: {e}"))
    } else {
        Err(error_message(resp).await)
    }
}

/// Prefer the server's error body (exact messages like `forbidden`,
/// `connection is read-only for this device`); fall back to the status code.
async fn error_message(resp: reqwest::Response) -> String {
    let status = resp.status();
    match resp.text().await {
        Ok(body) if !body.trim().is_empty() => body,
        _ => format!("server returned {status}"),
    }
}
