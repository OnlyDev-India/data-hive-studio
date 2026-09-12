//! Typed HTTP client used by desktop builds to talk to a dh-server. Holds a
//! session token (from an OAuth login — see `auth.rs`), not a team header:
//! which organization a call concerns is either in the URL path
//! (`/v1/orgs/{org_id}/...`) or implied by the connection id itself
//! (`/v1/c/{conn_id}/...` — the server resolves its org internally).

use crate::api::{
    MongoDocumentsResult, MongoExtDocumentsResult, MongoRunResult, QueryOp, QueryResult,
    SchemaOp, TableInfo, TableSchema,
};
use crate::db::CatalogOverview;
use crate::server::gateway::ConnWithAccess;
use crate::server::grants::Grant;
use crate::server::orgs::{OrgInvite, OrgMember, OrgRole, Organization};
use crate::server::router::{
    ActiveSchemaBody, CreateCollectionBody, DisconnectDatabaseBody, DuplicateBody, ExecuteOpBody,
    GrantBody, InsertDocumentBody, MongoDocumentsBody, RunMongoBody, SaveDocumentBody,
    SchemaObjectsBody, SchemaOpsBody, SchemasInBody, SqlBody,
};
use crate::server::store::AuditEntry;
use crate::server::vault::{ConnInput, ConnMeta};

/// `GET /v1/me`'s response shape — the caller's identity plus every org
/// they belong to (with their role in each), matching `router.rs`'s
/// `MeResponse`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MeResult {
    pub user_id: String,
    pub email: String,
    pub name: String,
    pub orgs: Vec<MeOrg>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MeOrg {
    #[serde(flatten)]
    pub org: crate::server::orgs::Organization,
    pub role: OrgRole,
}

#[derive(Clone)]
pub struct ServerClient {
    base: String,
    token: String,
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

/// Build the URL to send the browser/system-webview to for `provider`'s
/// OAuth consent screen (`GET server_base/auth/{provider}/start`). Desktop
/// callers open this in the system browser and capture the callback via a
/// local loopback HTTP listener (`src-tauri/src/servers.rs`, not
/// implemented in `dh-core` since it's platform-specific); `next` is where
/// the server redirects the browser afterward, with the new session token
/// appended as a `token=` query param (not a `#` fragment — fragments never
/// reach a plain server-side listener).
pub fn oauth_start_url(server_base: &str, provider: &str, next: &str) -> String {
    format!(
        "{}/auth/{provider}/start?next={}",
        normalize_base(server_base),
        urlencode(next),
    )
}

/// Which OAuth providers `server_base` has credentials configured for
/// (`GET /auth/providers`, unauthenticated) — lets a sign-in form show only
/// the buttons that will actually work instead of guessing.
pub async fn oauth_providers(server_base: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/auth/providers", normalize_base(server_base));
    let resp = reqwest::Client::new().get(url).send().await.map_err(|e| e.to_string())?;
    decode(resp).await
}

fn urlencode(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => c.encode_utf8(&mut [0u8; 4]).bytes().map(|b| format!("%{b:02X}")).collect(),
        })
        .collect()
}

impl ServerClient {
    pub fn new(base_url: &str, token: &str) -> Self {
        Self { base: normalize_base(base_url), token: token.to_string(), http: reqwest::Client::new() }
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let url = format!("{}{}", self.base, path);
        let resp = self.http.get(url).bearer_auth(&self.token).send().await.map_err(|e| e.to_string())?;
        decode(resp).await
    }

    async fn send<T: serde::de::DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: impl serde::Serialize,
    ) -> Result<T, String> {
        let url = format!("{}{}", self.base, path);
        let resp = self
            .http
            .request(method, url)
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        decode(resp).await
    }

    async fn empty(&self, method: reqwest::Method, path: &str) -> Result<(), String> {
        let url = format!("{}{}", self.base, path);
        let resp =
            self.http.request(method, url).bearer_auth(&self.token).send().await.map_err(|e| e.to_string())?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(error_message(resp).await)
        }
    }

    async fn empty_with_body(
        &self,
        method: reqwest::Method,
        path: &str,
        body: impl serde::Serialize,
    ) -> Result<(), String> {
        let url = format!("{}{}", self.base, path);
        let resp = self
            .http
            .request(method, url)
            .bearer_auth(&self.token)
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(error_message(resp).await)
        }
    }

    // ---- Identity / orgs ------------------------------------------------

    pub async fn me(&self) -> Result<MeResult, String> {
        self.get("/v1/me").await
    }

    pub async fn logout(&self) -> Result<(), String> {
        self.empty(reqwest::Method::POST, "/v1/auth/logout").await
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

    pub async fn list_invites(&self, org_id: &str) -> Result<Vec<OrgInvite>, String> {
        self.get(&format!("/v1/orgs/{org_id}/invites")).await
    }

    pub async fn create_invite(
        &self,
        org_id: &str,
        role: OrgRole,
        max_uses: Option<i32>,
        expires_ms: Option<i64>,
    ) -> Result<OrgInvite, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/orgs/{org_id}/invites"),
            serde_json::json!({ "role": role, "max_uses": max_uses, "expires_ms": expires_ms }),
        )
        .await
    }

    pub async fn revoke_invite(&self, org_id: &str, code: &str) -> Result<(), String> {
        self.empty(reqwest::Method::DELETE, &format!("/v1/orgs/{org_id}/invites/{code}")).await
    }

    pub async fn redeem_invite(&self, code: &str) -> Result<Organization, String> {
        self.send(reqwest::Method::POST, &format!("/v1/invites/{code}/redeem"), ()).await
    }

    pub async fn org_audit(&self, org_id: &str, limit: i64) -> Result<Vec<AuditEntry>, String> {
        self.get(&format!("/v1/orgs/{org_id}/audit?limit={limit}")).await
    }

    // ---- Connections ------------------------------------------------------

    pub async fn org_connections(&self, org_id: &str) -> Result<Vec<ConnWithAccess>, String> {
        self.get(&format!("/v1/orgs/{org_id}/connections")).await
    }

    /// Publish a new shared connection in `org_id`. Requires at least
    /// `Member` in that org (see `gateway.rs::create_connection`).
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

    // ---- Connection data surface (unchanged from the pre-org model) -------

    pub async fn list_tables(&self, conn_id: &str) -> Result<Vec<TableInfo>, String> {
        self.get(&format!("/v1/c/{conn_id}/tables")).await
    }

    pub async fn list_schemas(&self, conn_id: &str) -> Result<Vec<String>, String> {
        self.get(&format!("/v1/c/{conn_id}/schemas")).await
    }

    /// `database`/`schema`: `None` = this connection's own primary database
    /// / active schema — see `DbAdapter::table_schema`'s doc comment.
    pub async fn table_schema(
        &self,
        conn_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
        table: &str,
    ) -> Result<TableSchema, String> {
        let mut query = String::new();
        if let Some(d) = database {
            query.push_str(&format!("?database={}", urlencode(d)));
        }
        if let Some(s) = schema {
            query.push_str(&format!("{}schema={}", if query.is_empty() { "?" } else { "&" }, urlencode(s)));
        }
        self.get(&format!("/v1/c/{conn_id}/schema/{table}{query}")).await
    }

    pub async fn run_sql(
        &self,
        conn_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
        sql: &str,
    ) -> Result<QueryResult, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/sql"),
            SqlBody {
                sql: sql.into(),
                database: database.map(str::to_string),
                schema: schema.map(str::to_string),
            },
        )
        .await
    }

    pub async fn execute_op(
        &self,
        conn_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
        op: &QueryOp,
    ) -> Result<QueryResult, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/op"),
            ExecuteOpBody {
                op: op.clone(),
                database: database.map(str::to_string),
                schema: schema.map(str::to_string),
            },
        )
        .await
    }

    pub async fn list_databases(&self, conn_id: &str) -> Result<Vec<String>, String> {
        self.get(&format!("/v1/c/{conn_id}/databases")).await
    }

    pub async fn catalog_overview(&self, conn_id: &str) -> Result<CatalogOverview, String> {
        self.get(&format!("/v1/c/{conn_id}/catalog")).await
    }

    pub async fn list_schemas_in(
        &self,
        conn_id: &str,
        database: Option<&str>,
    ) -> Result<Vec<String>, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/schemas-in"),
            SchemasInBody { database: database.map(str::to_string) },
        )
        .await
    }

    pub async fn list_schema_objects(
        &self,
        conn_id: &str,
        database: Option<&str>,
        schema: &str,
        kind: crate::db::SchemaObjectKind,
    ) -> Result<Vec<crate::db::SchemaObject>, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/schema-objects"),
            SchemaObjectsBody {
                database: database.map(str::to_string),
                schema: schema.to_string(),
                kind,
            },
        )
        .await
    }

    pub async fn list_roles(&self, conn_id: &str) -> Result<Vec<crate::db::SchemaObject>, String> {
        self.get(&format!("/v1/c/{conn_id}/roles")).await
    }

    pub async fn list_role_details(&self, conn_id: &str) -> Result<Vec<crate::db::RoleDetail>, String> {
        self.get(&format!("/v1/c/{conn_id}/role-details")).await
    }

    pub async fn disconnect_database(&self, conn_id: &str, database: &str) -> Result<(), String> {
        self.empty_with_body(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/disconnect-database"),
            DisconnectDatabaseBody { database: database.into() },
        )
        .await
    }

    pub async fn active_schema(&self, conn_id: &str) -> Result<String, String> {
        self.get(&format!("/v1/c/{conn_id}/active-schema")).await
    }

    pub async fn set_active_schema(&self, conn_id: &str, schema: &str) -> Result<(), String> {
        self.empty_with_body(
            reqwest::Method::PUT,
            &format!("/v1/c/{conn_id}/active-schema"),
            ActiveSchemaBody { schema: schema.into() },
        )
        .await
    }

    pub async fn apply_schema_ops_batch(
        &self,
        conn_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
        ops: &[SchemaOp],
    ) -> Result<Vec<String>, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/schema-ops"),
            SchemaOpsBody {
                ops: ops.to_vec(),
                database: database.map(str::to_string),
                schema: schema.map(str::to_string),
            },
        )
        .await
    }

    pub async fn duplicate_table(
        &self,
        conn_id: &str,
        database: Option<&str>,
        schema: Option<&str>,
        source: &str,
        target: &str,
        copy_data: bool,
    ) -> Result<Vec<String>, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/duplicate"),
            DuplicateBody {
                source: source.into(),
                target: target.into(),
                copy_data,
                database: database.map(str::to_string),
                schema: schema.map(str::to_string),
            },
        )
        .await
    }

    pub async fn list_documents(
        &self,
        conn_id: &str,
        collection: &str,
        filter: Option<serde_json::Value>,
        skip: u64,
        limit: u64,
    ) -> Result<MongoDocumentsResult, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/mongo/documents"),
            MongoDocumentsBody { collection: collection.into(), filter, skip, limit },
        )
        .await
    }

    pub async fn list_documents_ext(
        &self,
        conn_id: &str,
        collection: &str,
        filter: Option<serde_json::Value>,
        skip: u64,
        limit: u64,
    ) -> Result<MongoExtDocumentsResult, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/mongo/documents/ext"),
            MongoDocumentsBody { collection: collection.into(), filter, skip, limit },
        )
        .await
    }

    pub async fn save_document(
        &self,
        conn_id: &str,
        collection: &str,
        id: &str,
        document_text: &str,
    ) -> Result<bool, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/mongo/documents/save"),
            SaveDocumentBody {
                collection: collection.into(),
                id: id.into(),
                document_text: document_text.into(),
            },
        )
        .await
    }

    pub async fn insert_document(
        &self,
        conn_id: &str,
        collection: &str,
        document_text: &str,
    ) -> Result<(), String> {
        self.empty_with_body(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/mongo/documents/insert"),
            InsertDocumentBody { collection: collection.into(), document_text: document_text.into() },
        )
        .await
    }

    pub async fn run_mongo(
        &self,
        conn_id: &str,
        database: &str,
        collection: Option<&str>,
        script: &str,
    ) -> Result<MongoRunResult, String> {
        self.send(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/mongo/run"),
            RunMongoBody {
                database: database.into(),
                collection: collection.map(|s| s.into()),
                script: script.into(),
            },
        )
        .await
    }

    pub async fn create_collection(
        &self,
        conn_id: &str,
        database: Option<&str>,
        name: &str,
    ) -> Result<(), String> {
        self.empty_with_body(
            reqwest::Method::POST,
            &format!("/v1/c/{conn_id}/mongo/collections"),
            CreateCollectionBody {
                name: name.into(),
                database: database.map(str::to_string),
            },
        )
        .await
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
/// `connection is read-only for this user`); fall back to the status code.
async fn error_message(resp: reqwest::Response) -> String {
    let status = resp.status();
    match resp.text().await {
        Ok(body) if !body.trim().is_empty() => body,
        _ => format!("server returned {status}"),
    }
}
