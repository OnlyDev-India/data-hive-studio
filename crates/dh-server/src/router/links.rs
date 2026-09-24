//! Shareable link routes (spec 0011). A redeem answers 404 for every kind
//! of failure, whatever the reason.

use super::access::access_err;
use super::{err_res, AppState, Auth};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;

pub(super) async fn list_links(State(gw): State<AppState>, auth: Auth, Path(org_id): Path<String>) -> Response {
    match gw.store.links_for_org(&auth.0, &org_id).await {
        Ok(list) => Json(list).into_response(),
        Err(e) => access_err(e),
    }
}

#[derive(serde::Deserialize)]
pub(super) struct CreateLinkBody {
    max_uses: i32,
    expires_days: i64,
}

pub(super) async fn create_link(
    State(gw): State<AppState>,
    auth: Auth,
    Path(org_id): Path<String>,
    Json(body): Json<CreateLinkBody>,
) -> Response {
    match gw.store.link_create(&auth.0, &org_id, body.max_uses, body.expires_days).await {
        Ok(link) => (StatusCode::CREATED, Json(link)).into_response(),
        Err(e) => access_err(e),
    }
}

pub(super) async fn revoke_link(
    State(gw): State<AppState>,
    auth: Auth,
    Path((org_id, code)): Path<(String, String)>,
) -> Response {
    match gw.store.link_revoke(&auth.0, &org_id, &code).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => access_err(e),
    }
}

pub(super) async fn redeem_link(State(gw): State<AppState>, auth: Auth, Path(code): Path<String>) -> Response {
    match gw.store.link_redeem(&code, &auth.0.user_id).await {
        Ok(org) => Json(org).into_response(),
        Err(e) => err_res(e),
    }
}
