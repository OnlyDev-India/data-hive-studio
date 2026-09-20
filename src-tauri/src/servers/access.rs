//! Server access (spec 0010): who may join this server and with what role.
//! Thin forwarding to the server's `/v1/server/...` routes; the server
//! decides who is allowed, so these never check a role themselves.

use dh_core::server::auth::{Account, Invite, ServerRole};
use dh_core::server::profiles::client_for;

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
