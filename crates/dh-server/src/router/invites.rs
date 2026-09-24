//! Email invites into an org, and the signed in person's own invites (spec
//! 0011). The shareable link routes are in `orgs.rs`.

use super::access::{access_err, present};
use super::{err_res, AppState, Auth};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use dh_server_client::orgs::{OrgInviteWrite, OrgRole};

#[derive(serde::Deserialize)]
pub(super) struct OrgInviteBody {
    email: String,
    role: OrgRole,
    /// Absent means the default of 7 days; `null` means never.
    #[serde(default, deserialize_with = "present")]
    expires_days: Option<Option<i64>>,
}

pub(super) async fn org_invites_list(State(gw): State<AppState>, auth: Auth, Path(org_id): Path<String>) -> Response {
    match gw.store.org_invite_list(&auth.0, &org_id).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => access_err(e),
    }
}

pub(super) async fn org_invites_create(
    State(gw): State<AppState>,
    auth: Auth,
    Path(org_id): Path<String>,
    Json(body): Json<OrgInviteBody>,
) -> Response {
    let days = body.expires_days.unwrap_or(Some(7));
    match gw.store.org_invite_create(&auth.0, &org_id, &body.email, body.role, days).await {
        Ok(OrgInviteWrite::Created(invite)) => (StatusCode::CREATED, Json(invite)).into_response(),
        Ok(OrgInviteWrite::Refreshed(invite)) => Json(invite).into_response(),
        Err(e) => access_err(e),
    }
}

pub(super) async fn org_invites_revoke(
    State(gw): State<AppState>,
    auth: Auth,
    Path((org_id, invite_id)): Path<(String, String)>,
) -> Response {
    match gw.store.org_invite_revoke(&auth.0, &org_id, &invite_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => access_err(e),
    }
}

pub(super) async fn my_invites(State(gw): State<AppState>, auth: Auth) -> Response {
    match gw.store.invites_pending(&auth.0.user_id).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn my_invite_accept(State(gw): State<AppState>, auth: Auth, Path(id): Path<String>) -> Response {
    match gw.store.invite_accept(&auth.0.user_id, &id).await {
        Ok(org) => Json(org).into_response(),
        Err(e) => access_err(e),
    }
}

pub(super) async fn my_invite_decline(State(gw): State<AppState>, auth: Auth, Path(id): Path<String>) -> Response {
    match gw.store.invite_decline(&auth.0.user_id, &id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => access_err(e),
    }
}
