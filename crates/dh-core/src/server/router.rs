//! REST API for the dh-studio server. Every route requires a bearer token
//! except enrollment; grants and admin scope are enforced per call.

use crate::api::{QueryOp, SchemaOp};
use crate::server::gateway::Gateway;
use crate::server::identity::{AuthCtx, TokenGrantSpec};

/// Body for POST /v1/admin/devices — mints a ready dhk_ token.
#[derive(serde::Deserialize)]
pub struct CreateDeviceInput {
    pub name: String,
    #[serde(default)]
    pub admin: bool,
}

use crate::server::vault::ConnInput;
use axum::{
    extract::{FromRequestParts, Path, Query, State},
    http::{Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

type AppState = Arc<Gateway>;

/// When `DH_READ_ONLY=1`, write endpoints (create / update / delete connections)
/// return 403 with the message from `DH_READ_ONLY_MSG` (or a default).
fn read_only_guard() -> Option<Response> {
    let ro = std::env::var("DH_READ_ONLY").unwrap_or_default();
    if ro == "1" || ro.eq_ignore_ascii_case("true") {
        let msg = std::env::var("DH_READ_ONLY_MSG")
            .unwrap_or_else(|_| "Saving connections is disabled in demo mode.".into());
        return Some((StatusCode::FORBIDDEN, msg).into_response());
    }
    None
}

pub fn build_router(gateway: Arc<Gateway>) -> Router {
    Router::new()
        .route("/v1/me", get(me))
        .route("/v1/connections", get(connections).post(create_conn))
        .route("/v1/connections/{id}", put(update_connection).delete(delete_conn))
        .route("/v1/connections/{id}/credentials", get(conn_credentials))
        .route("/v1/c/{conn_id}/tables", get(conn_tables))
        .route("/v1/c/{conn_id}/schemas", get(conn_schemas))
        .route("/v1/c/{conn_id}/schema/{*table}", get(conn_schema))
        .route("/v1/c/{conn_id}/sql", post(conn_sql))
        .route("/v1/c/{conn_id}/op", post(conn_op))
        .route("/v1/c/{conn_id}/close", post(conn_close))
        .route("/v1/c/{conn_id}/databases", get(conn_databases))
        .route("/v1/c/{conn_id}/catalog", get(conn_catalog))
        .route("/v1/c/{conn_id}/active-schema", get(conn_get_active_schema).put(conn_set_active_schema))
        .route("/v1/c/{conn_id}/schema-ops", post(conn_schema_ops))
        .route("/v1/c/{conn_id}/duplicate", post(conn_duplicate))
        .route("/v1/c/{conn_id}/mongo/documents", post(conn_mongo_documents))
        .route("/v1/c/{conn_id}/mongo/documents/ext", post(conn_mongo_documents_ext))
        .route("/v1/c/{conn_id}/mongo/documents/save", post(conn_mongo_save_document))
        .route("/v1/c/{conn_id}/mongo/documents/insert", post(conn_mongo_insert_document))
        .route("/v1/c/{conn_id}/mongo/run", post(conn_mongo_run))
        .route("/v1/c/{conn_id}/mongo/collections", post(conn_mongo_create_collection))
        .route("/v1/admin/connections", get(admin_list_connections).post(admin_create_conn))
        .route("/v1/admin/tokens", get(admin_list_tokens).post(admin_mint_tokens))
        .route("/v1/admin/tokens/{token}", delete(admin_delete_token))
        .route("/v1/admin/devices", get(admin_devices))
        .route("/v1/admin/devices/{id}", delete(admin_revoke_device))
        .route("/v1/admin/grants/{device_id}", get(admin_list_grants))
        .route(
            "/v1/admin/grants/{device_id}/{conn_id}",
            put(admin_set_grant).delete(admin_revoke_grant),
        )
        .route("/v1/admin/audit", get(admin_audit))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::DELETE,
                    Method::OPTIONS,
                ])
                .allow_headers(Any),
        )
        .with_state(gateway)
}

/// Bearer-token extractor; resolves to an [`AuthCtx`] or 401.
struct Auth(AuthCtx);

impl FromRequestParts<Arc<Gateway>> for Auth {
    type Rejection = Response;
    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &Arc<Gateway>,
    ) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");
        let team = parts.headers.get(crate::server::identity::TEAM_HEADER)
            .and_then(|h| h.to_str().ok());
        match state.store.verify(token, team).await {
            Some(ctx) => Ok(Auth(ctx)),
            None => Err((StatusCode::UNAUTHORIZED, "invalid or missing token").into_response()),
        }
    }
}

fn err_res(e: String) -> Response {
    let status = if e == crate::server::gateway::ERR_FORBIDDEN
        || e == crate::server::gateway::ERR_READONLY
    {
        StatusCode::FORBIDDEN
    } else if e == crate::server::vault::ERR_NOT_FOUND {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::BAD_REQUEST
    };
    (status, e).into_response()
}

async fn me(State(_gw): State<AppState>, auth: Auth) -> Response {
    Json(auth.0).into_response()
}

async fn connections(State(gw): State<AppState>, auth: Auth) -> Response {
    match gw.visible_connections(&auth.0).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => err_res(e),
    }
}

async fn update_connection(
    State(gw): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
    Json(input): Json<ConnInput>,
) -> Response {
    if let Some(r) = read_only_guard() { return r; }
    match gw.update_conn_details(&auth.0, &id, input).await {
        Ok(meta) => Json(meta).into_response(),
        Err(e) => err_res(e),
    }
}

async fn conn_tables(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
) -> Response {
    match gw.list_tables(&auth.0, &conn_id).await {
        Ok(t) => Json(t).into_response(),
        Err(e) => err_res(e),
    }
}

async fn conn_schemas(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
) -> Response {
    match gw.list_schemas(&auth.0, &conn_id).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => err_res(e),
    }
}

async fn conn_schema(
    State(gw): State<AppState>,
    auth: Auth,
    Path((conn_id, table)): Path<(String, String)>,
) -> Response {
    match gw.table_schema(&auth.0, &conn_id, &table).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SqlBody {
    pub sql: String,
}

async fn conn_sql(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<SqlBody>,
) -> Response {
    match gw.run_sql(&auth.0, &conn_id, &body.sql).await {
        Ok(r) => Json(r).into_response(),
        Err(e) => err_res(e),
    }
}

async fn conn_op(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(op): Json<QueryOp>,
) -> Response {
    match gw.execute_op(&auth.0, &conn_id, &op).await {
        Ok(r) => Json(r).into_response(),
        Err(e) => err_res(e),
    }
}

// ---- MongoDB surface --------------------------------------------------
//
// See `Gateway`'s "MongoDB surface" section: every handler below is a thin
// wrapper the same shape as `conn_sql`/`conn_op` above.

async fn conn_databases(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
) -> Response {
    match gw.list_databases(&auth.0, &conn_id).await {
        Ok(d) => Json(d).into_response(),
        Err(e) => err_res(e),
    }
}

async fn conn_catalog(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
) -> Response {
    match gw.catalog_overview(&auth.0, &conn_id).await {
        Ok(c) => Json(c).into_response(),
        Err(e) => err_res(e),
    }
}

async fn conn_get_active_schema(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
) -> Response {
    match gw.active_schema(&auth.0, &conn_id).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct ActiveSchemaBody {
    pub schema: String,
}

async fn conn_set_active_schema(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<ActiveSchemaBody>,
) -> Response {
    match gw.set_active_schema(&auth.0, &conn_id, &body.schema).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SchemaOpsBody {
    pub ops: Vec<SchemaOp>,
}

async fn conn_schema_ops(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<SchemaOpsBody>,
) -> Response {
    match gw.apply_schema_ops_batch(&auth.0, &conn_id, &body.ops).await {
        Ok(stmts) => Json(stmts).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct DuplicateBody {
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub copy_data: bool,
}

async fn conn_duplicate(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<DuplicateBody>,
) -> Response {
    match gw.duplicate_table(&auth.0, &conn_id, &body.source, &body.target, body.copy_data).await {
        Ok(stmts) => Json(stmts).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct MongoDocumentsBody {
    pub collection: String,
    #[serde(default)]
    pub filter: Option<serde_json::Value>,
    #[serde(default)]
    pub skip: u64,
    #[serde(default = "default_doc_limit")]
    pub limit: u64,
}

fn default_doc_limit() -> u64 {
    50
}

async fn conn_mongo_documents(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<MongoDocumentsBody>,
) -> Response {
    match gw
        .list_documents(&auth.0, &conn_id, &body.collection, body.filter, body.skip, body.limit)
        .await
    {
        Ok(r) => Json(r).into_response(),
        Err(e) => err_res(e),
    }
}

async fn conn_mongo_documents_ext(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<MongoDocumentsBody>,
) -> Response {
    match gw
        .list_documents_ext(&auth.0, &conn_id, &body.collection, body.filter, body.skip, body.limit)
        .await
    {
        Ok(r) => Json(r).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SaveDocumentBody {
    pub collection: String,
    pub id: String,
    pub document_text: String,
}

async fn conn_mongo_save_document(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<SaveDocumentBody>,
) -> Response {
    match gw
        .save_document(&auth.0, &conn_id, &body.collection, &body.id, &body.document_text)
        .await
    {
        Ok(saved) => Json(saved).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct InsertDocumentBody {
    pub collection: String,
    pub document_text: String,
}

async fn conn_mongo_insert_document(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<InsertDocumentBody>,
) -> Response {
    match gw.insert_document(&auth.0, &conn_id, &body.collection, &body.document_text).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct RunMongoBody {
    pub database: String,
    #[serde(default)]
    pub collection: Option<String>,
    pub script: String,
}

async fn conn_mongo_run(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<RunMongoBody>,
) -> Response {
    match gw
        .run_mongo(&auth.0, &conn_id, &body.database, body.collection.as_deref(), &body.script)
        .await
    {
        Ok(r) => Json(r).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct CreateCollectionBody {
    pub name: String,
}

async fn conn_mongo_create_collection(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<CreateCollectionBody>,
) -> Response {
    match gw.create_collection(&auth.0, &conn_id, &body.name).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}

fn require_admin(auth: &Auth) -> Option<Response> {
    if auth.0.is_admin {
        None
    } else {
        Some((StatusCode::FORBIDDEN, "admin scope required").into_response())
    }
}

/// Publish a NEW shared connection. Admin scope only.
/// Creators get full access to their own connection (readwrite + edit + delete).
async fn create_conn(
    State(gw): State<AppState>,
    auth: Auth,
    Json(input): Json<ConnInput>,
) -> Response {
    if let Some(r) = read_only_guard() { return r; }
    if let Some(resp) = require_admin(&auth) { return resp; }
    match gw.store.conn_add(&input, &auth.0.token).await {
        Ok(meta) => {
            if !auth.0.is_admin {
                let _ = gw
                    .store
                    .grant_upsert(
                        &auth.0.token,
                        &meta.id,
                        true,
                        true,
                        true,
                    )
                    .await;
            }
            let _ = gw.store.audit(&auth.0, "conn.create", &meta.id, Some(&meta.name)).await;
            (StatusCode::CREATED, Json(meta)).into_response()
        }
        Err(e) => err_res(e),
    }
}

/// List all active tokens (admin UI).
async fn admin_list_tokens(State(gw): State<AppState>, auth: Auth) -> Response {
    if let Some(resp) = require_admin(&auth) { return resp; }
    match gw.store.tokens_list().await {
        Ok(list) => Json(list).into_response(),
        Err(e) => err_res(e),
    }
}

/// Body for POST /v1/admin/tokens — mints `adm_…` or `tem_…` tokens.
#[derive(serde::Deserialize, serde::Serialize)]
pub struct TokenMintBody {
    pub kind: String, // "admin" | "team"
    #[serde(default)]
    pub user_name: Option<String>,
    #[serde(default)]
    pub team_name: Option<String>,
    #[serde(default)]
    pub grants: Vec<TokenGrantSpec>,
}

/// Admin-only: mint an `adm_…` or `tem_…` token. The plaintext is returned
/// exactly once; only its hash is stored server-side.
async fn admin_mint_tokens(
    State(gw): State<AppState>,
    auth: Auth,
    Json(body): Json<TokenMintBody>,
) -> Response {
    if let Some(r) = read_only_guard() { return r; }
    if let Some(resp) = require_admin(&auth) {
        return resp;
    }
    let result = if body.kind == "admin" {
        gw.store.mint_admin(body.user_name.as_deref().unwrap_or("")).await
    } else if body.kind == "team" {
        gw.store
            .mint_team_token(body.user_name.as_deref().unwrap_or(""), body.team_name.as_deref().unwrap_or(""), &body.grants)
            .await
    } else {
        Err("kind must be \"admin\" or \"team\"".into())
    };
    match result {
        Ok(token) => (StatusCode::CREATED, Json(serde_json::json!({ "token": token }))).into_response(),
        Err(e) => err_res(e),
    }
}

async fn admin_delete_token(
    State(gw): State<AppState>,
    auth: Auth,
    Path(token): Path<String>,
) -> Response {
    if let Some(resp) = require_admin(&auth) {
        return resp;
    }
    match gw.store.token_revoke(&token).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}

/// Admin view of every shared connection — same shape the devices see, but
/// unrestricted (admins implicitly hold read/write/delete on all).
async fn admin_list_connections(
    State(gw): State<AppState>,
    auth: Auth,
) -> Response {
    if let Some(resp) = require_admin(&auth) {
        return resp;
    }
    match gw.visible_connections(&auth.0).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => err_res(e),
    }
}

async fn admin_create_conn(
    State(gw): State<AppState>,
    auth: Auth,
    Json(input): Json<ConnInput>,
) -> Response {
    if let Some(r) = read_only_guard() { return r; }
    if let Some(resp) = require_admin(&auth) {
        return resp;
    }
    match gw.store.conn_add(&input, &auth.0.token).await {
        Ok(meta) => {
            let _ = gw.store.audit(&auth.0, "conn.create", &meta.id, Some(&meta.name)).await;
            (StatusCode::CREATED, Json(meta)).into_response()
        }
        Err(e) => err_res(e),
    }
}

/// Delete (archive) a shared connection — admin scope or `can_delete` grant.
async fn delete_conn(
    State(gw): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
) -> Response {
    if let Some(r) = read_only_guard() { return r; }
    match gw.delete_connection(&auth.0, &id).await {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}

/// Return decrypted connection credentials for authorized callers.
async fn conn_credentials(
    State(gw): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
) -> Response {
    match gw.conn_credentials(&auth.0, &id).await {
        Ok(creds) => Json(creds).into_response(),
        Err(e) => err_res(e),
    }
}

/// POST /v1/c/{conn_id}/close — release this connection's server-side pool
/// (called by a web client on page close to free resources immediately).
async fn conn_close(
    State(gw): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
) -> Response {
    match gw.release_connection(&auth.0, &id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}



async fn admin_devices(State(gw): State<AppState>, auth: Auth) -> Response {    if let Some(resp) = require_admin(&auth) {
        return resp;
    }
    match gw.store.devices_list().await {
        Ok(d) => Json(d).into_response(),
        Err(e) => err_res(e),
    }
}

async fn admin_revoke_device(
    State(gw): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
) -> Response {
    if let Some(resp) = require_admin(&auth) {
        return resp;
    }
    match gw.store.device_revoke(&id).await {
        Ok(_) => {
            let _ = gw.store.audit(&auth.0, "device.revoke", &id, None).await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => err_res(e),
    }
}

async fn admin_list_grants(
    State(gw): State<AppState>,
    auth: Auth,
    Path(device_id): Path<String>,
) -> Response {
    if let Some(resp) = require_admin(&auth) {
        return resp;
    }
    match gw.store.grants_for_device(&device_id).await {
        Ok(g) => Json(g).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct GrantBody {
    #[serde(default)]
    pub can_read: bool,
    #[serde(default)]
    pub can_update: bool,
    #[serde(default)]
    pub can_delete: bool,
}

async fn admin_set_grant(
    State(gw): State<AppState>,
    auth: Auth,
    Path((device_id, conn_id)): Path<(String, String)>,
    Json(body): Json<GrantBody>,
) -> Response {
    if let Some(resp) = require_admin(&auth) {
        return resp;
    }
    match gw
        .store
        .grant_upsert(&device_id, &conn_id, body.can_read, body.can_update, body.can_delete)
        .await
    {
        Ok(_) => {
            let _ = gw.store.audit(&auth.0, "grant.set", &conn_id, Some(&device_id)).await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => err_res(e),
    }
}

async fn admin_revoke_grant(
    State(gw): State<AppState>,
    auth: Auth,
    Path((device_id, conn_id)): Path<(String, String)>,
) -> Response {
    if let Some(resp) = require_admin(&auth) {
        return resp;
    }
    match gw.store.grant_revoke(&device_id, &conn_id).await {
        Ok(_) => {
            let _ = gw.store.audit(&auth.0, "grant.revoke", &conn_id, Some(&device_id)).await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize)]
pub struct AuditQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    200
}

async fn admin_audit(
    State(gw): State<AppState>,
    auth: Auth,
    Query(q): Query<AuditQuery>,
) -> Response {
    if let Some(resp) = require_admin(&auth) {
        return resp;
    }
    match gw.store.audit_recent(q.limit).await {
        Ok(a) => Json(a).into_response(),
        Err(e) => err_res(e),
    }
}
