//! REST API for the dh-studio server. Every `/v1/...` route requires a
//! Bearer session token except the OAuth entry points themselves
//! (`/auth/...`, which establish one). Org membership/role is enforced per
//! call — see `gateway.rs`/`orgs.rs`.

use crate::api::{QueryOp, SchemaOp};
use crate::server::auth::AuthCtx;
use crate::server::gateway::Gateway;
use crate::server::orgs::OrgRole;
use crate::server::vault::ConnInput;
use axum::{
    extract::{FromRequestParts, Path, Query, State},
    http::{header, HeaderMap, Method, StatusCode},
    response::{IntoResponse, Redirect, Response},
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
        .route("/auth/providers", get(auth_providers))
        .route("/auth/{provider}/start", get(auth_start))
        .route("/auth/{provider}/callback", get(auth_callback))
        .route("/v1/me", get(me))
        .route("/v1/auth/logout", post(logout))
        .route("/v1/orgs", get(list_orgs).post(create_org))
        .route("/v1/orgs/{org_id}/members", get(list_members))
        .route(
            "/v1/orgs/{org_id}/members/{user_id}",
            put(set_member_role).delete(remove_member),
        )
        .route("/v1/orgs/{org_id}/invites", get(list_invites).post(create_invite))
        .route("/v1/orgs/{org_id}/invites/{code}", delete(revoke_invite))
        .route("/v1/invites/{code}/redeem", post(redeem_invite))
        .route("/v1/orgs/{org_id}/audit", get(org_audit))
        .route("/v1/orgs/{org_id}/connections", get(org_connections).post(create_conn))
        .route(
            "/v1/orgs/{org_id}/connections/{conn_id}/grants",
            get(list_grants),
        )
        .route(
            "/v1/orgs/{org_id}/connections/{conn_id}/grants/{user_id}",
            put(set_grant).delete(revoke_grant),
        )
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

/// Bearer session-token extractor; resolves to an [`AuthCtx`] or 401.
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
        match state.store.verify_session(token).await {
            Some(ctx) => Ok(Auth(ctx)),
            None => Err((StatusCode::UNAUTHORIZED, "invalid, missing, or expired session").into_response()),
        }
    }
}

fn err_res(e: String) -> Response {
    let status = if e == crate::server::gateway::ERR_FORBIDDEN
        || e == crate::server::gateway::ERR_READONLY
        || e == crate::server::orgs::ERR_NOT_A_MEMBER
        || e == crate::server::orgs::ERR_LAST_OWNER
    {
        StatusCode::FORBIDDEN
    } else if e == crate::server::vault::ERR_NOT_FOUND || e == crate::server::orgs::ERR_INVITE_INVALID {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::BAD_REQUEST
    };
    (status, e).into_response()
}

/// Requires the caller to manage members (Owner/Admin) in `org_id`.
/// Returns the role on success so callers that need it don't re-fetch.
async fn require_manage_members(
    gw: &Gateway,
    ctx: &AuthCtx,
    org_id: &str,
) -> Result<OrgRole, Response> {
    match gw.store.org_role(org_id, &ctx.user_id).await {
        Ok(Some(role)) if role.can_manage_members() => Ok(role),
        Ok(Some(_)) => Err((StatusCode::FORBIDDEN, "owner or admin role required").into_response()),
        Ok(None) => Err((StatusCode::FORBIDDEN, "not a member of this organization").into_response()),
        Err(e) => Err(err_res(e)),
    }
}

// ---------------------------------------------------------------------------
//  OAuth
// ---------------------------------------------------------------------------

const STATE_COOKIE: &str = "dh_oauth_state";

fn public_base_url() -> String {
    std::env::var("DH_PUBLIC_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".to_string())
}

fn read_cookie(headers: &HeaderMap, name: &str) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';').find_map(|pair| {
        let (k, v) = pair.trim().split_once('=')?;
        (k == name).then(|| v.to_string())
    })
}

/// Which OAuth providers this server has credentials for — unauthenticated,
/// so a sign-in form can ask "which buttons do I show?" before the user has
/// any token at all. Ordered so the frontend's rendering order is stable.
async fn auth_providers() -> Json<Vec<&'static str>> {
    Json(
        ["google", "github"]
            .into_iter()
            .filter(|p| crate::server::auth::provider_config(p).is_some())
            .collect(),
    )
}

/// Redirects to the provider's consent screen. `?next=<url>` is where the
/// browser lands after a successful login (the session token is appended as
/// a `token=` query param — not a `#` fragment, since desktop's `next` is a
/// plain local-loopback HTTP listener and fragments are never sent to a
/// server); omit it to get the session token back as plain JSON from the
/// callback instead (useful for headless/manual testing).
async fn auth_start(Path(provider): Path<String>, Query(q): Query<StartQuery>) -> Response {
    let Some(cfg) = crate::server::auth::provider_config(&provider) else {
        return (StatusCode::NOT_FOUND, format!("OAuth provider '{provider}' is not configured")).into_response();
    };
    let csrf = hex::encode(rand::random::<[u8; 16]>());
    let redirect_uri = format!("{}/auth/{}/callback", public_base_url(), provider);
    let Some(url) =
        crate::server::auth::authorize_url(&provider, &cfg, &redirect_uri, &csrf)
    else {
        return (StatusCode::NOT_FOUND, "unknown provider").into_response();
    };
    // Cookie value carries both the CSRF check value and where to send the
    // browser afterward — kept together so this stays fully stateless
    // (no server-side "pending login" storage, which matters on serverless
    // hosts where nothing survives between the two requests otherwise).
    let cookie_value = format!("{csrf}:{}", q.next.as_deref().unwrap_or(""));
    let mut resp = Redirect::temporary(&url).into_response();
    resp.headers_mut().insert(
        header::SET_COOKIE,
        format!("{STATE_COOKIE}={cookie_value}; Max-Age=600; Path=/; HttpOnly; SameSite=Lax")
            .parse()
            .unwrap(),
    );
    resp
}

#[derive(serde::Deserialize)]
struct StartQuery {
    #[serde(default)]
    next: Option<String>,
}

#[derive(serde::Deserialize)]
struct CallbackQuery {
    code: String,
    state: String,
}

async fn auth_callback(
    State(gw): State<AppState>,
    Path(provider): Path<String>,
    headers: HeaderMap,
    Query(q): Query<CallbackQuery>,
) -> Response {
    let Some(cookie) = read_cookie(&headers, STATE_COOKIE) else {
        return (StatusCode::BAD_REQUEST, "missing oauth state cookie").into_response();
    };
    let Some((csrf, next)) = cookie.split_once(':') else {
        return (StatusCode::BAD_REQUEST, "malformed oauth state cookie").into_response();
    };
    if csrf != q.state {
        return (StatusCode::BAD_REQUEST, "oauth state mismatch").into_response();
    }
    let Some(cfg) = crate::server::auth::provider_config(&provider) else {
        return (StatusCode::NOT_FOUND, format!("OAuth provider '{provider}' is not configured")).into_response();
    };
    let redirect_uri = format!("{}/auth/{}/callback", public_base_url(), provider);
    let profile = match crate::server::auth::exchange_code(&provider, &cfg, &q.code, &redirect_uri).await {
        Ok(p) => p,
        Err(e) => return (StatusCode::BAD_GATEWAY, format!("oauth exchange failed: {e}")).into_response(),
    };
    if profile.email.is_empty() {
        return (StatusCode::BAD_GATEWAY, "provider did not return an email address").into_response();
    }
    let user = match gw
        .store
        .user_upsert_oauth(&provider, &profile.subject, &profile.email, &profile.name, profile.avatar_url.as_deref())
        .await
    {
        Ok(u) => u,
        Err(e) => return err_res(e),
    };
    let token = match gw.store.session_create(&user.id).await {
        Ok(t) => t,
        Err(e) => return err_res(e),
    };

    let mut resp = if next.is_empty() {
        Json(serde_json::json!({ "token": token, "user": user })).into_response()
    } else {
        let sep = if next.contains('?') { "&" } else { "?" };
        Redirect::temporary(&format!("{next}{sep}token={token}")).into_response()
    };
    // Clear the state cookie now that it's been used.
    resp.headers_mut().insert(
        header::SET_COOKIE,
        format!("{STATE_COOKIE}=; Max-Age=0; Path=/").parse().unwrap(),
    );
    resp
}

async fn logout(State(gw): State<AppState>, headers: HeaderMap) -> Response {
    let token = headers.get(header::AUTHORIZATION).and_then(|h| h.to_str().ok()).unwrap_or("");
    match gw.store.session_revoke(token).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Serialize)]
struct MeResponse {
    #[serde(flatten)]
    ctx: AuthCtx,
    orgs: Vec<MeOrg>,
}

#[derive(serde::Serialize)]
struct MeOrg {
    #[serde(flatten)]
    org: crate::server::orgs::Organization,
    role: OrgRole,
}

async fn me(State(gw): State<AppState>, auth: Auth) -> Response {
    match gw.store.orgs_for_user(&auth.0.user_id).await {
        Ok(orgs) => Json(MeResponse {
            ctx: auth.0,
            orgs: orgs.into_iter().map(|(org, role)| MeOrg { org, role }).collect(),
        })
        .into_response(),
        Err(e) => err_res(e),
    }
}

// ---------------------------------------------------------------------------
//  Organizations
// ---------------------------------------------------------------------------

async fn list_orgs(State(gw): State<AppState>, auth: Auth) -> Response {
    match gw.store.orgs_for_user(&auth.0.user_id).await {
        Ok(orgs) => Json(
            orgs.into_iter().map(|(org, role)| MeOrg { org, role }).collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize)]
struct CreateOrgBody {
    name: String,
}

async fn create_org(State(gw): State<AppState>, auth: Auth, Json(body): Json<CreateOrgBody>) -> Response {
    if body.name.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "name must not be empty").into_response();
    }
    match gw.store.org_create(body.name.trim(), &auth.0.user_id).await {
        Ok(org) => (StatusCode::CREATED, Json(org)).into_response(),
        Err(e) => err_res(e),
    }
}

async fn list_members(State(gw): State<AppState>, auth: Auth, Path(org_id): Path<String>) -> Response {
    if gw.store.org_role(&org_id, &auth.0.user_id).await.ok().flatten().is_none() {
        return (StatusCode::FORBIDDEN, "not a member of this organization").into_response();
    }
    match gw.store.org_members(&org_id).await {
        Ok(m) => Json(m).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize)]
struct SetRoleBody {
    role: OrgRole,
}

async fn set_member_role(
    State(gw): State<AppState>,
    auth: Auth,
    Path((org_id, user_id)): Path<(String, String)>,
    Json(body): Json<SetRoleBody>,
) -> Response {
    if let Err(r) = require_manage_members(&gw, &auth.0, &org_id).await {
        return r;
    }
    match gw.store.org_member_set_role(&org_id, &user_id, body.role).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}

/// Members may remove THEMSELVES ("leave") without the manage-members role;
/// removing anyone else needs it.
async fn remove_member(
    State(gw): State<AppState>,
    auth: Auth,
    Path((org_id, user_id)): Path<(String, String)>,
) -> Response {
    if user_id != auth.0.user_id {
        if let Err(r) = require_manage_members(&gw, &auth.0, &org_id).await {
            return r;
        }
    }
    match gw.store.org_member_remove(&org_id, &user_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}

async fn list_invites(State(gw): State<AppState>, auth: Auth, Path(org_id): Path<String>) -> Response {
    if let Err(r) = require_manage_members(&gw, &auth.0, &org_id).await {
        return r;
    }
    match gw.store.invites_for_org(&org_id).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize)]
struct CreateInviteBody {
    role: OrgRole,
    #[serde(default)]
    max_uses: Option<i32>,
    #[serde(default)]
    expires_ms: Option<i64>,
}

async fn create_invite(
    State(gw): State<AppState>,
    auth: Auth,
    Path(org_id): Path<String>,
    Json(body): Json<CreateInviteBody>,
) -> Response {
    if let Err(r) = require_manage_members(&gw, &auth.0, &org_id).await {
        return r;
    }
    match gw.store.invite_create(&org_id, body.role, &auth.0.user_id, body.max_uses, body.expires_ms).await {
        Ok(invite) => (StatusCode::CREATED, Json(invite)).into_response(),
        Err(e) => err_res(e),
    }
}

async fn revoke_invite(
    State(gw): State<AppState>,
    auth: Auth,
    Path((org_id, code)): Path<(String, String)>,
) -> Response {
    if let Err(r) = require_manage_members(&gw, &auth.0, &org_id).await {
        return r;
    }
    match gw.store.invite_revoke(&org_id, &code).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}

async fn redeem_invite(State(gw): State<AppState>, auth: Auth, Path(code): Path<String>) -> Response {
    match gw.store.invite_redeem(&code, &auth.0.user_id).await {
        Ok(org) => Json(org).into_response(),
        Err(e) => err_res(e),
    }
}

async fn org_audit(
    State(gw): State<AppState>,
    auth: Auth,
    Path(org_id): Path<String>,
    Query(q): Query<AuditQuery>,
) -> Response {
    if gw.store.org_role(&org_id, &auth.0.user_id).await.ok().flatten().is_none() {
        return (StatusCode::FORBIDDEN, "not a member of this organization").into_response();
    }
    match gw.store.audit_recent(&org_id, q.limit).await {
        Ok(a) => Json(a).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize)]
struct AuditQuery {
    #[serde(default = "default_limit")]
    limit: i64,
}

fn default_limit() -> i64 {
    200
}

// ---------------------------------------------------------------------------
//  Connections (org-scoped list/create; everything else keyed by conn_id,
//  which already implies its org internally — see gateway.rs)
// ---------------------------------------------------------------------------

async fn org_connections(State(gw): State<AppState>, auth: Auth, Path(org_id): Path<String>) -> Response {
    match gw.visible_connections(&auth.0, &org_id).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => err_res(e),
    }
}

async fn create_conn(
    State(gw): State<AppState>,
    auth: Auth,
    Path(org_id): Path<String>,
    Json(input): Json<ConnInput>,
) -> Response {
    if let Some(r) = read_only_guard() {
        return r;
    }
    match gw.create_connection(&auth.0, &org_id, input).await {
        Ok(meta) => (StatusCode::CREATED, Json(meta)).into_response(),
        Err(e) => err_res(e),
    }
}

async fn update_connection(
    State(gw): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
    Json(input): Json<ConnInput>,
) -> Response {
    if let Some(r) = read_only_guard() {
        return r;
    }
    match gw.update_conn_details(&auth.0, &id, input).await {
        Ok(meta) => Json(meta).into_response(),
        Err(e) => err_res(e),
    }
}

async fn delete_conn(State(gw): State<AppState>, auth: Auth, Path(id): Path<String>) -> Response {
    if let Some(r) = read_only_guard() {
        return r;
    }
    match gw.delete_connection(&auth.0, &id).await {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}

async fn conn_credentials(State(gw): State<AppState>, auth: Auth, Path(id): Path<String>) -> Response {
    match gw.conn_credentials(&auth.0, &id).await {
        Ok(creds) => Json(creds).into_response(),
        Err(e) => err_res(e),
    }
}

/// POST /v1/c/{conn_id}/close — release this connection's server-side pool
/// (called by a web client on page close to free resources immediately).
async fn conn_close(State(gw): State<AppState>, auth: Auth, Path(id): Path<String>) -> Response {
    match gw.release_connection(&auth.0, &id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}

// ---- Per-connection grant overrides (Owner/Admin only) --------------------

async fn list_grants(
    State(gw): State<AppState>,
    auth: Auth,
    Path((org_id, conn_id)): Path<(String, String)>,
) -> Response {
    if let Err(r) = require_manage_members(&gw, &auth.0, &org_id).await {
        return r;
    }
    match gw.store.grants_for_conn(&conn_id).await {
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

async fn set_grant(
    State(gw): State<AppState>,
    auth: Auth,
    Path((org_id, conn_id, user_id)): Path<(String, String, String)>,
    Json(body): Json<GrantBody>,
) -> Response {
    if let Err(r) = require_manage_members(&gw, &auth.0, &org_id).await {
        return r;
    }
    match gw.store.grant_upsert(&conn_id, &user_id, body.can_read, body.can_update, body.can_delete).await {
        Ok(_) => {
            let _ = gw.store.audit(&auth.0, Some(&org_id), "grant.set", &conn_id, Some(&user_id)).await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => err_res(e),
    }
}

async fn revoke_grant(
    State(gw): State<AppState>,
    auth: Auth,
    Path((org_id, conn_id, user_id)): Path<(String, String, String)>,
) -> Response {
    if let Err(r) = require_manage_members(&gw, &auth.0, &org_id).await {
        return r;
    }
    match gw.store.grant_revoke(&conn_id, &user_id).await {
        Ok(_) => {
            let _ = gw.store.audit(&auth.0, Some(&org_id), "grant.revoke", &conn_id, Some(&user_id)).await;
            StatusCode::NO_CONTENT.into_response()
        }
        Err(e) => err_res(e),
    }
}

// ---------------------------------------------------------------------------
//  Connection data surface — unchanged shape from before; every method
//  resolves the connection's org/access internally (see gateway.rs).
// ---------------------------------------------------------------------------

async fn conn_tables(State(gw): State<AppState>, auth: Auth, Path(conn_id): Path<String>) -> Response {
    match gw.list_tables(&auth.0, &conn_id).await {
        Ok(t) => Json(t).into_response(),
        Err(e) => err_res(e),
    }
}

async fn conn_schemas(State(gw): State<AppState>, auth: Auth, Path(conn_id): Path<String>) -> Response {
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

async fn conn_databases(State(gw): State<AppState>, auth: Auth, Path(conn_id): Path<String>) -> Response {
    match gw.list_databases(&auth.0, &conn_id).await {
        Ok(d) => Json(d).into_response(),
        Err(e) => err_res(e),
    }
}

async fn conn_catalog(State(gw): State<AppState>, auth: Auth, Path(conn_id): Path<String>) -> Response {
    match gw.catalog_overview(&auth.0, &conn_id).await {
        Ok(c) => Json(c).into_response(),
        Err(e) => err_res(e),
    }
}

async fn conn_get_active_schema(State(gw): State<AppState>, auth: Auth, Path(conn_id): Path<String>) -> Response {
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
