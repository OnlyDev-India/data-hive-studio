//! Saved team-server profiles and gateway passthrough — the Tauri-specific
//! shell around `dh_core::server::profiles`: this file resolves WHERE the
//! profiles file and tokens live (`AppHandle::path()`) and does the actual
//! token storage (OS keychain via `keyring`, or a dev-mode file — `dh-core`
//! has no keychain dependency since `dh-server` has no keychain to talk to).
//! Everything else forwards straight through, mirroring `commands.rs`'s
//! thin-forwarding pattern for the desktop DB commands.

use dh_core::server::client::ServerClient;
use dh_core::server::identity::AuthCtx;
use dh_core::server::profiles::{
    self, client_for, load_profiles, save_profiles, with_remote, ServerProfile,
};
use dh_core::server::vault::{ConnInput, ConnMeta};
use serde::Serialize;
use tauri::Manager;

const KEYRING_SERVICE: &str = "dh-studio-server";

#[derive(Serialize)]
pub struct ServerProfileView {
    pub id: String,
    pub name: String,
    pub url: String,
    pub connected: bool,
}

#[derive(Serialize)]
pub struct ServerSession {
    pub profile: ServerProfile,
    pub me: AuthCtx,
    pub connections: Vec<dh_core::server::gateway::ConnWithAccess>,
}

fn profiles_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("servers.json"))
}

fn keyring_entry(profile_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, profile_id).map_err(|e| e.to_string())
}

// ---- Token persistence -------------------------------------------------------
//
// Release builds use the OS keychain. Debug builds store the token in an
// app-data file with 0600 permissions instead: every `tauri dev` rebuild
// produces a new unsigned binary and macOS re-prompts for keychain access
// on each launch, which makes development unbearable.

#[cfg(debug_assertions)]
fn token_file(app: &tauri::AppHandle, profile_id: &str) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = dir.join("server-tokens");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(profile_id))
}

fn save_token(app: &tauri::AppHandle, profile_id: &str, token: &str) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let path = token_file(app, profile_id)?;
        std::fs::write(&path, token).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        keyring_entry(profile_id)?.set_password(token).map_err(|e| e.to_string())
    }
}

fn load_token(app: &tauri::AppHandle, profile_id: &str) -> Result<String, String> {
    #[cfg(debug_assertions)]
    {
        let path = token_file(app, profile_id)?;
        if path.exists() {
            return std::fs::read_to_string(path).map_err(|e| e.to_string());
        }
        // One-time migration from a previously used keychain entry. This may
        // prompt once; afterwards the file wins and macOS is never touched.
        if let Ok(token) = keyring_entry(profile_id)?
            .get_password()
            .map_err(|_| "no stored token for this profile".to_string())
        {
            save_token(app, profile_id, &token)?;
            return Ok(token);
        }
        Err("no stored token for this profile".into())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        keyring_entry(profile_id)?
            .get_password()
            .map_err(|_| "no stored token for this profile".to_string())
    }
}

fn delete_token(app: &tauri::AppHandle, profile_id: &str) {
    #[cfg(debug_assertions)]
    {
        if let Ok(path) = token_file(app, profile_id) {
            let _ = std::fs::remove_file(path);
        }
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        let _ = keyring_entry(profile_id).and_then(|e| e.delete_credential().map_err(|e| e.to_string()));
    }
}

#[tauri::command]
pub fn servers_list(app: tauri::AppHandle) -> Result<Vec<ServerProfileView>, String> {
    Ok(load_profiles(&profiles_path(&app)?)?
        .into_iter()
        .map(|p| ServerProfileView {
            connected: profiles::is_connected(&p.id),
            id: p.id,
            name: p.name,
            url: p.url,
        })
        .collect())
}

#[tauri::command]
pub async fn servers_add(
    app: tauri::AppHandle,
    name: String,
    url: String,
    token: String,
    team_name: Option<String>,
) -> Result<ServerProfile, String> {
    let token = token.trim().to_string();

    // Validate before persisting anything.
    let probe = ServerClient::new(&url, &token);
    probe.me().await.map_err(|e| format!("cannot reach server: {e}"))?;

    let profile = ServerProfile {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.trim().to_string(),
        url: dh_core::server::client::normalize_base(&url),
        team_name,
    };
    let _ = save_token(&app, &profile.id, &token);

    let path = profiles_path(&app)?;
    let mut all = load_profiles(&path)?;
    all.push(profile.clone());
    save_profiles(&path, &all)?;
    Ok(profile)
}

#[tauri::command]
pub fn servers_remove(app: tauri::AppHandle, profile_id: String) -> Result<(), String> {
    profiles::remove_client(&profile_id);
    delete_token(&app, &profile_id);
    let path = profiles_path(&app)?;
    let mut all = load_profiles(&path)?;
    all.retain(|p| p.id != profile_id);
    save_profiles(&path, &all)
}

#[tauri::command]
pub async fn servers_connect(
    app: tauri::AppHandle,
    profile_id: String,
) -> Result<ServerSession, String> {
    let token = load_token(&app, &profile_id)?;
    let profile = load_profiles(&profiles_path(&app)?)?
        .into_iter()
        .find(|p| p.id == profile_id)
        .ok_or("profile not found")?;

    let client = ServerClient::with_team(&profile.url, &token, profile.team_name.clone());
    let me = client.me().await?;
    let connections = client.connections().await?;
    profiles::insert_client(profile_id.clone(), client);
    Ok(ServerSession { profile, me, connections })
}

#[tauri::command]
pub fn servers_disconnect(profile_id: String) -> Result<(), String> {
    profiles::remove_client(&profile_id);
    Ok(())
}

// ---- Gateway passthrough ----------------------------------------------------

#[tauri::command]
pub async fn server_list_tables(
    conn_id: String,
) -> Result<Vec<dh_core::api::TableInfo>, String> {
    with_remote(&conn_id, |c, r| Box::pin(async move { c.list_tables(&r).await })).await
}

#[tauri::command]
pub async fn server_list_schemas(conn_id: String) -> Result<Vec<String>, String> {
    with_remote(&conn_id, |c, r| Box::pin(async move { c.list_schemas(&r).await })).await
}

#[tauri::command]
pub async fn server_table_schema(
    conn_id: String,
    table: String,
) -> Result<dh_core::api::TableSchema, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.table_schema(&r, &table).await })
    })
    .await
}

#[tauri::command]
pub async fn server_run_sql(
    conn_id: String,
    sql: String,
) -> Result<dh_core::api::QueryResult, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.run_sql(&r, &sql).await })
    })
    .await
}

#[tauri::command]
pub async fn server_execute_op(
    conn_id: String,
    op: dh_core::api::QueryOp,
) -> Result<dh_core::api::QueryResult, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.execute_op(&r, &op).await })
    })
    .await
}

// ---- Admin surface ----------------------------------------------------------
//
// All admin calls run through the stored ServerClient so the token never
// leaves the keychain/Rust process — the frontend only ever passes profile ids.

#[tauri::command]
pub async fn servers_admin_devices(
    profile_id: String,
) -> Result<Vec<dh_core::server::identity::DeviceInfo>, String> {
    client_for(&profile_id)?.admin_devices().await
}

#[tauri::command]
pub async fn servers_admin_tokens_list(
    profile_id: String,
) -> Result<Vec<dh_core::server::identity::TokenInfo>, String> {
    client_for(&profile_id)?.admin_tokens_list().await
}

#[tauri::command]
/// Mint an adm_ or tem_ token directly (admin only).
pub async fn servers_admin_mint_token(
    profile_id: String,
    kind: String,
    user_name: String,
    team_name: Option<String>,
    grants: Vec<dh_core::server::identity::TokenGrantSpec>,
) -> Result<String, String> {
    let client = client_for(&profile_id)?;
    if kind == "admin" {
        client.admin_mint_admin_token(&user_name).await
    } else {
        client.admin_mint_team_token(&user_name, &team_name.unwrap_or_default(), grants).await
    }
}

#[tauri::command]
pub async fn servers_admin_delete_token(
    profile_id: String,
    token: String,
) -> Result<(), String> {
    client_for(&profile_id)?.admin_delete_token(&token).await
}

#[tauri::command]
pub async fn servers_admin_revoke_device(profile_id: String, device_id: String) -> Result<(), String> {
    client_for(&profile_id)?.admin_revoke_device(&device_id).await
}

#[tauri::command]
pub async fn servers_admin_grants(
    profile_id: String,
    device_id: String,
) -> Result<Vec<dh_core::server::grants::Grant>, String> {
    client_for(&profile_id)?.admin_grants(&device_id).await
}

#[tauri::command]
pub async fn servers_admin_set_grant(
    profile_id: String,
    device_id: String,
    conn_id: String,
    can_read: bool,
    can_update: bool,
    can_delete: bool,
) -> Result<(), String> {
    client_for(&profile_id)?
        .admin_set_grant(&device_id, &conn_id, can_read, can_update, can_delete)
        .await
}

/// Delete (archive) a shared connection. Admin scope or `can_delete` grant
/// required — enforced server-side.
#[tauri::command]
pub async fn servers_delete_connection(profile_id: String, conn_id: String) -> Result<(), String> {
    client_for(&profile_id)?.delete_connection(&conn_id).await
}

/// Fetch decrypted connection credentials from the server.
#[tauri::command]
pub async fn servers_fetch_credentials(
    profile_id: String,
    conn_id: String,
) -> Result<serde_json::Value, String> {
    client_for(&profile_id)?.fetch_credentials(&conn_id).await
}

#[tauri::command]
pub async fn servers_admin_revoke_grant(
    profile_id: String,
    device_id: String,
    conn_id: String,
) -> Result<(), String> {
    client_for(&profile_id)?.admin_revoke_grant(&device_id, &conn_id).await
}

#[tauri::command]
pub async fn servers_admin_connections(
    profile_id: String,
) -> Result<Vec<dh_core::server::gateway::ConnWithAccess>, String> {
    client_for(&profile_id)?.connections().await
}

/// Edit a shared connection's stored details (requires edit access on the
/// caller's grant, or admin scope — enforced server-side).
#[tauri::command]
pub async fn servers_update_connection(
    profile_id: String,
    conn_id: String,
    input: ConnInput,
) -> Result<ConnMeta, String> {
    client_for(&profile_id)?.update_connection(&conn_id, &input).await
}

/// Publish a new shared connection — admin scope only.
#[tauri::command]
pub async fn servers_create_connection(
    profile_id: String,
    input: ConnInput,
) -> Result<ConnMeta, String> {
    client_for(&profile_id)?.create_connection(&input).await
}

#[tauri::command]
pub async fn servers_admin_audit(
    profile_id: String,
    limit: i64,
) -> Result<Vec<dh_core::server::store::AuditEntry>, String> {
    client_for(&profile_id)?.admin_audit(limit).await
}
