use axum::response::IntoResponse;
use dh_server_client::orgs::OrgRole;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use super::{AppState, Auth, err_res, require_manage_members};
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
    if body.name.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, "name must not be empty").into_response();
    }
    match gw.store.org_create(body.name.trim(), &auth.0.user_id).await {
        Ok(org) => (StatusCode::CREATED, Json(org)).into_response(),
        Err(e) => err_res(e),
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
pub(super) async fn remove_member(
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

pub(super) async fn list_invites(State(gw): State<AppState>, auth: Auth, Path(org_id): Path<String>) -> Response {
    if let Err(r) = require_manage_members(&gw, &auth.0, &org_id).await {
        return r;
    }
    match gw.store.invites_for_org(&org_id).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize)]
pub(super) struct CreateInviteBody {
    pub(super) role: OrgRole,
    #[serde(default)]
    max_uses: Option<i32>,
    #[serde(default)]
    expires_ms: Option<i64>,
}

pub(super) async fn create_invite(
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

pub(super) async fn revoke_invite(
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

pub(super) async fn redeem_invite(State(gw): State<AppState>, auth: Auth, Path(code): Path<String>) -> Response {
    match gw.store.invite_redeem(&code, &auth.0.user_id).await {
        Ok(org) => Json(org).into_response(),
        Err(e) => err_res(e),
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
