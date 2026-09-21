//! REST API for the dh-studio server. Every `/v1/...` route requires a
//! Bearer access token except the sign in entry points themselves
//! (`/auth/...`, which establish or renew a session). Org membership/role is enforced per
//! call — see `gateway.rs`/`orgs.rs`.

use axum::response::IntoResponse;
mod access;
mod auth;
mod redirect;
mod session;
mod orgs;
mod connections;
mod browse;
mod query;
mod mongo;

pub use connections::GrantBody;
pub use redirect::insecure_public_url_warning;
pub use browse::{
    TargetQuery,
    FieldTreeQuery,
    SchemasInBody,
    SchemaObjectsBody,
    ExtensionsBody,
    DisconnectDatabaseBody,
    ActiveSchemaBody,
};
pub use query::{SqlBody, ExecuteOpBody, SchemaOpsBody, DuplicateBody};
pub use mongo::{
    MongoDocumentsBody,
    SaveDocumentBody,
    InsertDocumentBody,
    RunMongoBody,
    CreateCollectionBody,
};

use crate::server::auth::AuthCtx;
use crate::server::gateway::Gateway;
use crate::server::orgs::OrgRole;
use axum::extract::FromRequestParts;
use axum::http::{Method, StatusCode};
use axum::response::Response;
use axum::routing::{delete, get, post, put};
use axum::Router;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use self::access::{server_account_manage_roles, server_account_role, server_accounts_list, server_invites_create, server_invites_list, server_invites_revoke};
use self::auth::{auth_callback, auth_claim, auth_providers, auth_start, me};
use self::session::{auth_exchange, auth_refresh, logout, my_session_end, my_sessions, my_sessions_end_all, owner_end_sessions, unauthorized};
use self::browse::{conn_catalog, conn_databases, conn_disconnect_database, conn_extensions, conn_get_active_schema, conn_mongo_field_tree, conn_role_details, conn_roles, conn_schema, conn_schema_objects, conn_schemas, conn_schemas_in, conn_set_active_schema, conn_tables};
use self::connections::{conn_close, conn_credentials, create_conn, delete_conn, list_grants, org_connections, revoke_grant, set_grant, update_connection};
use self::query::{conn_duplicate, conn_op, conn_schema_ops, conn_sql};
use self::mongo::{conn_mongo_create_collection, conn_mongo_documents, conn_mongo_documents_ext, conn_mongo_insert_document, conn_mongo_run, conn_mongo_save_document};
use self::orgs::{create_invite, create_org, list_invites, list_members, list_orgs, org_audit, redeem_invite, remove_member, revoke_invite, set_member_role};

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
        .route("/auth/claim", post(auth_claim))
        .route("/auth/exchange", post(auth_exchange))
        .route("/auth/refresh", post(auth_refresh))
        .route("/v1/me", get(me))
        .route("/v1/auth/logout", post(logout))
        .route("/v1/me/sessions", get(my_sessions).delete(my_sessions_end_all))
        .route("/v1/me/sessions/{id}", delete(my_session_end))
        .route("/v1/admin/users/{user_id}/sessions", delete(owner_end_sessions))
        .route("/v1/server/invites", get(server_invites_list).post(server_invites_create))
        .route("/v1/server/invites/{id}", delete(server_invites_revoke))
        .route("/v1/server/accounts", get(server_accounts_list))
        .route("/v1/server/accounts/{user_id}/role", put(server_account_role))
        .route("/v1/server/accounts/{user_id}/manage-roles", put(server_account_manage_roles))
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
        .route("/v1/c/{conn_id}/mongo/field-tree/{*collection}", get(conn_mongo_field_tree))
        .route("/v1/c/{conn_id}/sql", post(conn_sql))
        .route("/v1/c/{conn_id}/op", post(conn_op))
        .route("/v1/c/{conn_id}/close", post(conn_close))
        .route("/v1/c/{conn_id}/databases", get(conn_databases))
        .route("/v1/c/{conn_id}/catalog", get(conn_catalog))
        .route("/v1/c/{conn_id}/schemas-in", post(conn_schemas_in))
        .route("/v1/c/{conn_id}/schema-objects", post(conn_schema_objects))
        .route("/v1/c/{conn_id}/roles", get(conn_roles))
        .route("/v1/c/{conn_id}/extensions", post(conn_extensions))
        .route("/v1/c/{conn_id}/role-details", get(conn_role_details))
        .route("/v1/c/{conn_id}/active-schema", get(conn_get_active_schema).put(conn_set_active_schema))
        .route("/v1/c/{conn_id}/disconnect-database", post(conn_disconnect_database))
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

/// Bearer access-token extractor; resolves to an [`AuthCtx`] or 401.
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
        match state.store.verify_access(token).await {
            Some(ctx) => Ok(Auth(ctx)),
            None => Err(unauthorized()),
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
