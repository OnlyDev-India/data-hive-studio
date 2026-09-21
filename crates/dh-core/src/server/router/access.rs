//! Server access routes (spec 0010): invites, accounts and roles. The caller's
//! server role comes from the database on every request (`Auth`), and the
//! store re-checks it, so a demotion applies on the very next call.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Deserializer};
use crate::server::auth::{AccessError, InviteWrite, ServerRole};
use super::{AppState, Auth, err_res};

pub(super) fn access_err(e: AccessError) -> Response {
    match e {
        AccessError::BadRequest(m) => (StatusCode::BAD_REQUEST, m).into_response(),
        AccessError::Forbidden => (StatusCode::FORBIDDEN, "forbidden").into_response(),
        AccessError::NotFound => (StatusCode::NOT_FOUND, "not found").into_response(),
        AccessError::AlreadyHasAccount => (StatusCode::CONFLICT, "already_has_account").into_response(),
        AccessError::AlreadyUsed => (StatusCode::CONFLICT, "already_used").into_response(),
        AccessError::LastOwner => (StatusCode::CONFLICT, "last_owner").into_response(),
        AccessError::NotAnAdmin => (StatusCode::CONFLICT, "not_an_admin").into_response(),
        AccessError::Other(e) => err_res(e),
    }
}

/// Tells "field left out" (`None`, so the default of 7 days) from
/// "field is null" (`Some(None)`, so never expires).
fn present<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Some(Option::deserialize(d)?))
}

#[derive(Deserialize)]
pub(super) struct CreateInviteBody {
    email: String,
    #[serde(default, deserialize_with = "present")]
    expires_days: Option<Option<i64>>,
}

pub(super) async fn server_invites_list(State(gw): State<AppState>, auth: Auth) -> Response {
    match gw.store.server_invite_list(&auth.0).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => access_err(e),
    }
}

pub(super) async fn server_invites_create(
    State(gw): State<AppState>,
    auth: Auth,
    Json(body): Json<CreateInviteBody>,
) -> Response {
    let days = body.expires_days.unwrap_or(Some(7));
    match gw.store.server_invite_create(&auth.0, &body.email, days).await {
        Ok(InviteWrite::Created(invite)) => (StatusCode::CREATED, Json(invite)).into_response(),
        Ok(InviteWrite::Refreshed(invite)) => Json(invite).into_response(),
        Err(e) => access_err(e),
    }
}

pub(super) async fn server_invites_revoke(
    State(gw): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
) -> Response {
    match gw.store.server_invite_revoke(&auth.0, &id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => access_err(e),
    }
}

pub(super) async fn server_accounts_list(State(gw): State<AppState>, auth: Auth) -> Response {
    match gw.store.accounts_list(&auth.0).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => access_err(e),
    }
}

#[derive(Deserialize)]
pub(super) struct RoleBody {
    role: ServerRole,
}

pub(super) async fn server_account_role(
    State(gw): State<AppState>,
    auth: Auth,
    Path(user_id): Path<String>,
    Json(body): Json<RoleBody>,
) -> Response {
    match gw.store.role_set(&auth.0, &user_id, body.role).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => access_err(e),
    }
}

#[derive(Deserialize)]
pub(super) struct ManageRolesBody {
    enabled: bool,
}

pub(super) async fn server_account_manage_roles(
    State(gw): State<AppState>,
    auth: Auth,
    Path(user_id): Path<String>,
    Json(body): Json<ManageRolesBody>,
) -> Response {
    match gw.store.manage_roles_set(&auth.0, &user_id, body.enabled).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => access_err(e),
    }
}
