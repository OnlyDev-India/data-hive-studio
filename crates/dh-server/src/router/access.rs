//! Server access routes (spec 0010): invites, accounts and roles. The caller's
//! server role comes from the database on every request (`Auth`), and the
//! store re-checks it, so a demotion applies on the very next call.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Deserializer};
use dh_server_client::auth::{AccessError, InviteWrite, ServerRole};
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::to_bytes;

    async fn body_text(resp: Response) -> String {
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    #[tokio::test]
    async fn access_err_maps_each_variant_to_its_status_and_code() {
        let r = access_err(AccessError::BadRequest("bad email".into()));
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
        assert_eq!(body_text(r).await, "bad email");

        assert_eq!(access_err(AccessError::Forbidden).status(), StatusCode::FORBIDDEN);
        assert_eq!(access_err(AccessError::NotFound).status(), StatusCode::NOT_FOUND);

        let r = access_err(AccessError::AlreadyHasAccount);
        assert_eq!(r.status(), StatusCode::CONFLICT);
        assert_eq!(body_text(r).await, "already_has_account");

        let r = access_err(AccessError::AlreadyUsed);
        assert_eq!(r.status(), StatusCode::CONFLICT);
        assert_eq!(body_text(r).await, "already_used");

        let r = access_err(AccessError::LastOwner);
        assert_eq!(r.status(), StatusCode::CONFLICT);
        assert_eq!(body_text(r).await, "last_owner");

        let r = access_err(AccessError::NotAnAdmin);
        assert_eq!(r.status(), StatusCode::CONFLICT);
        assert_eq!(body_text(r).await, "not_an_admin");

        // Falls through to the shared error mapper for anything else.
        assert_eq!(access_err(AccessError::Other("weird".into())).status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn create_invite_body_tells_omitted_from_null_from_a_value() {
        // Field left out entirely: default applies later (AC-8, 7 days).
        let omitted: CreateInviteBody = serde_json::from_str(r#"{"email":"a@x.com"}"#).unwrap();
        assert_eq!(omitted.expires_days, None);

        // Explicit null: never expires.
        let never: CreateInviteBody =
            serde_json::from_str(r#"{"email":"a@x.com","expires_days":null}"#).unwrap();
        assert_eq!(never.expires_days, Some(None));

        // An explicit day count.
        let days: CreateInviteBody =
            serde_json::from_str(r#"{"email":"a@x.com","expires_days":30}"#).unwrap();
        assert_eq!(days.expires_days, Some(Some(30)));
    }

    #[test]
    fn default_expiry_is_seven_days_only_when_the_field_was_omitted() {
        let omitted: CreateInviteBody = serde_json::from_str(r#"{"email":"a@x.com"}"#).unwrap();
        assert_eq!(omitted.expires_days.unwrap_or(Some(7)), Some(7));

        let never: CreateInviteBody =
            serde_json::from_str(r#"{"email":"a@x.com","expires_days":null}"#).unwrap();
        assert_eq!(never.expires_days.unwrap_or(Some(7)), None, "explicit null must not fall back to 7");

        let one_day: CreateInviteBody =
            serde_json::from_str(r#"{"email":"a@x.com","expires_days":1}"#).unwrap();
        assert_eq!(one_day.expires_days.unwrap_or(Some(7)), Some(1));
    }
}
