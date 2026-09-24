use dh_server_client::orgs::{OrgEmailInvite, OrgLink, OrgMember, OrgRole, Organization, PendingInvite};
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

/// Redeem a shareable link's code on a not-yet-saved server, same reasoning
/// as `servers_org_create_new`.
#[tauri::command]
pub async fn servers_org_redeem_link_new(
    app: tauri::AppHandle,
    url: String,
    code: String,
) -> Result<Organization, String> {
    client_for_url(&app, &url).redeem_link(&code).await
}

/// The signed in person's pending invites on a not-yet-saved server, so the
/// org picker can list them before any profile exists.
#[tauri::command]
pub async fn servers_my_invites_new(app: tauri::AppHandle, url: String) -> Result<Vec<PendingInvite>, String> {
    client_for_url(&app, &url).my_invites().await
}

#[tauri::command]
pub async fn servers_invite_accept_new(
    app: tauri::AppHandle,
    url: String,
    invite_id: String,
) -> Result<Organization, String> {
    client_for_url(&app, &url).accept_invite(&invite_id).await
}

#[tauri::command]
pub async fn servers_invite_decline_new(app: tauri::AppHandle, url: String, invite_id: String) -> Result<(), String> {
    client_for_url(&app, &url).decline_invite(&invite_id).await
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
pub async fn servers_org_invites_list(profile_id: String, org_id: String) -> Result<Vec<OrgEmailInvite>, String> {
    client_for(&profile_id)?.list_org_invites(&org_id).await
}

#[tauri::command]
pub async fn servers_org_invite_create(
    profile_id: String,
    org_id: String,
    email: String,
    role: OrgRole,
    expires_days: Option<i64>,
) -> Result<OrgEmailInvite, String> {
    client_for(&profile_id)?.create_org_invite(&org_id, &email, role, expires_days).await
}

#[tauri::command]
pub async fn servers_org_invite_revoke(profile_id: String, org_id: String, invite_id: String) -> Result<(), String> {
    client_for(&profile_id)?.revoke_org_invite(&org_id, &invite_id).await
}

#[tauri::command]
pub async fn servers_my_invites(profile_id: String) -> Result<Vec<PendingInvite>, String> {
    client_for(&profile_id)?.my_invites().await
}

#[tauri::command]
pub async fn servers_invite_accept(profile_id: String, invite_id: String) -> Result<Organization, String> {
    client_for(&profile_id)?.accept_invite(&invite_id).await
}

#[tauri::command]
pub async fn servers_invite_decline(profile_id: String, invite_id: String) -> Result<(), String> {
    client_for(&profile_id)?.decline_invite(&invite_id).await
}

#[tauri::command]
pub async fn servers_org_links_list(profile_id: String, org_id: String) -> Result<Vec<OrgLink>, String> {
    client_for(&profile_id)?.list_links(&org_id).await
}

#[tauri::command]
pub async fn servers_org_link_create(
    profile_id: String,
    org_id: String,
    max_uses: i32,
    expires_days: i64,
) -> Result<OrgLink, String> {
    client_for(&profile_id)?.create_link(&org_id, max_uses, expires_days).await
}

#[tauri::command]
pub async fn servers_org_link_revoke(profile_id: String, org_id: String, code: String) -> Result<(), String> {
    client_for(&profile_id)?.revoke_link(&org_id, &code).await
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
