use axum::response::IntoResponse;
use dh_server_client::orgs::OrgRole;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use super::access::access_err;
use super::{AppState, Auth, err_res};
use super::auth::MeOrg;

// ---------------------------------------------------------------------------
//  Organizations
// ---------------------------------------------------------------------------
pub(super) async fn list_orgs(State(gw): State<AppState>, auth: Auth) -> Response {
    match gw.store.orgs_for_user(&auth.0.user_id).await {
        Ok(orgs) => Json(
            orgs.into_iter().map(|(org, role)| MeOrg { org, role }).collect::<Vec<_>>(),
        )
        .into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize)]
pub(super) struct CreateOrgBody {
    pub(super) name: String,
}

pub(super) async fn create_org(State(gw): State<AppState>, auth: Auth, Json(body): Json<CreateOrgBody>) -> Response {
    match gw.store.org_create(&auth.0, &body.name).await {
        Ok(org) => (StatusCode::CREATED, Json(org)).into_response(),
        Err(e) => access_err(e),
    }
}

pub(super) async fn list_members(State(gw): State<AppState>, auth: Auth, Path(org_id): Path<String>) -> Response {
    if gw.store.org_role(&org_id, &auth.0.user_id).await.ok().flatten().is_none() {
        return (StatusCode::FORBIDDEN, "not a member of this organization").into_response();
    }
    match gw.store.org_members(&org_id).await {
        Ok(m) => Json(m).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize)]
pub(super) struct SetRoleBody {
    pub(super) role: OrgRole,
}

pub(super) async fn set_member_role(
    State(gw): State<AppState>,
    auth: Auth,
    Path((org_id, user_id)): Path<(String, String)>,
    Json(body): Json<SetRoleBody>,
) -> Response {
    match gw.store.org_member_set_role(&auth.0, &org_id, &user_id, body.role).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => access_err(e),
    }
}

/// Anyone may remove THEMSELVES ("leave"); removing someone else follows the
/// caller table in `dh-server`'s `orgs::members`.
pub(super) async fn remove_member(
    State(gw): State<AppState>,
    auth: Auth,
    Path((org_id, user_id)): Path<(String, String)>,
) -> Response {
    match gw.store.org_member_remove(&auth.0, &org_id, &user_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => access_err(e),
    }
}

pub(super) async fn org_audit(
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
pub(super) struct AuditQuery {
    #[serde(default = "default_limit")]
    pub(super) limit: i64,
}

fn default_limit() -> i64 {
    200
}
