use axum::response::IntoResponse;
use dh_server_client::vault::ConnInput;
use dh_server_client::client::orgs::GrantBody;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use super::{read_only_guard, require_manage_members, AppState, Auth, err_res};

// ---------------------------------------------------------------------------
//  Connections (org-scoped list/create; everything else keyed by conn_id,
//  which already implies its org internally — see gateway.rs)
// ---------------------------------------------------------------------------
pub(super) async fn org_connections(State(gw): State<AppState>, auth: Auth, Path(org_id): Path<String>) -> Response {
    match gw.visible_connections(&auth.0, &org_id).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn create_conn(
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

pub(super) async fn update_connection(
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

pub(super) async fn delete_conn(State(gw): State<AppState>, auth: Auth, Path(id): Path<String>) -> Response {
    if let Some(r) = read_only_guard() {
        return r;
    }
    match gw.delete_connection(&auth.0, &id).await {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn conn_credentials(State(gw): State<AppState>, auth: Auth, Path(id): Path<String>) -> Response {
    match gw.conn_credentials(&auth.0, &id).await {
        Ok(creds) => Json(creds).into_response(),
        Err(e) => err_res(e),
    }
}

/// POST /v1/c/{conn_id}/close — release this connection's server-side pool
/// (called by a web client on page close to free resources immediately).
pub(super) async fn conn_close(State(gw): State<AppState>, auth: Auth, Path(id): Path<String>) -> Response {
    match gw.release_connection(&auth.0, &id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}

// ---- Per-connection grant overrides (Owner/Admin only) --------------------
pub(super) async fn list_grants(
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

pub(super) async fn set_grant(
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

pub(super) async fn revoke_grant(
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
