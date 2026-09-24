//! Server access (spec 0010, 0011): who may join this server, with what
//! role, and who may create organizations.
//! Thin forwarding to the server's `/v1/server/...` routes; the server
//! decides who is allowed, so these never check a role themselves.

use dh_server_client::auth::{Account, Invite, ServerRole};
use dh_server_client::orgs::{ServerOrg, ServerSettings};
use dh_server_client::profiles::client_for;

#[tauri::command]
pub async fn servers_access_invites_list(profile_id: String) -> Result<Vec<Invite>, String> {
    client_for(&profile_id)?.server_invites().await
}

#[tauri::command]
pub async fn servers_access_invite_create(
    profile_id: String,
    email: String,
    expires_days: Option<i64>,
) -> Result<Invite, String> {
    client_for(&profile_id)?.server_invite_create(&email, expires_days).await
}

#[tauri::command]
pub async fn servers_access_invite_revoke(profile_id: String, invite_id: String) -> Result<(), String> {
    client_for(&profile_id)?.server_invite_revoke(&invite_id).await
}

#[tauri::command]
pub async fn servers_access_accounts_list(profile_id: String) -> Result<Vec<Account>, String> {
    client_for(&profile_id)?.server_accounts().await
}

#[tauri::command]
pub async fn servers_access_set_role(profile_id: String, user_id: String, role: ServerRole) -> Result<(), String> {
    client_for(&profile_id)?.server_set_role(&user_id, role).await
}

#[tauri::command]
pub async fn servers_access_set_manage_roles(
    profile_id: String,
    user_id: String,
    enabled: bool,
) -> Result<(), String> {
    client_for(&profile_id)?.server_set_manage_roles(&user_id, enabled).await
}

#[tauri::command]
pub async fn servers_access_set_create_orgs(
    profile_id: String,
    user_id: String,
    enabled: bool,
) -> Result<(), String> {
    client_for(&profile_id)?.server_set_create_orgs(&user_id, enabled).await
}

#[tauri::command]
pub async fn servers_access_orgs_list(profile_id: String) -> Result<Vec<ServerOrg>, String> {
    client_for(&profile_id)?.server_orgs().await
}

#[tauri::command]
pub async fn servers_access_settings_get(profile_id: String) -> Result<ServerSettings, String> {
    client_for(&profile_id)?.server_settings().await
}

#[tauri::command]
pub async fn servers_access_set_open_org_creation(profile_id: String, enabled: bool) -> Result<(), String> {
    client_for(&profile_id)?.server_set_open_org_creation(enabled).await
}
