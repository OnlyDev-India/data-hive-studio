use dh_server_client::orgs::{OrgInvite, OrgMember, OrgRole, Organization};
use dh_server_client::profiles::client_for;
use super::sessions::client_for_url;

/// Create a brand-new organization on a server the app just signed in to (via
/// `servers_oauth_login`) that isn't saved as a profile yet, e.g. the user has
/// no orgs and needs to make their first one before there's anything to save.
/// The session is the one Rust holds for `url`.
#[tauri::command]
pub async fn servers_org_create_new(app: tauri::AppHandle, url: String, name: String) -> Result<Organization, String> {
    client_for_url(&app, &url).create_org(&name).await
}

/// Redeem an invite code on a not-yet-saved server, same reasoning as
/// `servers_org_create_new`.
#[tauri::command]
pub async fn servers_org_redeem_invite_new(
    app: tauri::AppHandle,
    url: String,
    code: String,
) -> Result<Organization, String> {
    client_for_url(&app, &url).redeem_invite(&code).await
}

// ---- Organizations ------------------------------------------------------
#[tauri::command]
pub async fn servers_org_members(profile_id: String, org_id: String) -> Result<Vec<OrgMember>, String> {
    client_for(&profile_id)?.org_members(&org_id).await
}

#[tauri::command]
pub async fn servers_org_set_member_role(
    profile_id: String,
    org_id: String,
    user_id: String,
    role: OrgRole,
) -> Result<(), String> {
    client_for(&profile_id)?.set_member_role(&org_id, &user_id, role).await
}

#[tauri::command]
pub async fn servers_org_remove_member(
    profile_id: String,
    org_id: String,
    user_id: String,
) -> Result<(), String> {
    client_for(&profile_id)?.remove_member(&org_id, &user_id).await
}

#[tauri::command]
pub async fn servers_org_invites_list(profile_id: String, org_id: String) -> Result<Vec<OrgInvite>, String> {
    client_for(&profile_id)?.list_invites(&org_id).await
}

#[tauri::command]
pub async fn servers_org_invite_create(
    profile_id: String,
    org_id: String,
    role: OrgRole,
    max_uses: Option<i32>,
    expires_ms: Option<i64>,
) -> Result<OrgInvite, String> {
    client_for(&profile_id)?.create_invite(&org_id, role, max_uses, expires_ms).await
}

#[tauri::command]
pub async fn servers_org_invite_revoke(profile_id: String, org_id: String, code: String) -> Result<(), String> {
    client_for(&profile_id)?.revoke_invite(&org_id, &code).await
}

#[tauri::command]
pub async fn servers_org_audit(
    profile_id: String,
    org_id: String,
    limit: i64,
) -> Result<Vec<dh_server_client::store::AuditEntry>, String> {
    client_for(&profile_id)?.org_audit(&org_id, limit).await
}

// ---- Per-connection grant overrides --------------------------------------
#[tauri::command]
pub async fn servers_grants_list(
    profile_id: String,
    org_id: String,
    conn_id: String,
) -> Result<Vec<dh_server_client::grants::Grant>, String> {
    client_for(&profile_id)?.list_grants(&org_id, &conn_id).await
}

#[tauri::command]
pub async fn servers_grant_set(
    profile_id: String,
    org_id: String,
    conn_id: String,
    user_id: String,
    can_read: bool,
    can_update: bool,
    can_delete: bool,
) -> Result<(), String> {
    client_for(&profile_id)?
        .set_grant(&org_id, &conn_id, &user_id, can_read, can_update, can_delete)
        .await
}

#[tauri::command]
pub async fn servers_grant_revoke(
    profile_id: String,
    org_id: String,
    conn_id: String,
    user_id: String,
) -> Result<(), String> {
    client_for(&profile_id)?.revoke_grant(&org_id, &conn_id, &user_id).await
}
