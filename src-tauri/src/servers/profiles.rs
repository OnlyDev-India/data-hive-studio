use tauri::Manager;
use dh_core::server::profiles;
use dh_core::server::profiles::{load_profiles, save_profiles, ServerProfile};
use super::ServerProfileView;
use super::tokens::{delete_token, save_token};

pub(super) fn profiles_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("servers.json"))
}

pub(super) fn find_profile(app: &tauri::AppHandle, profile_id: &str) -> Result<ServerProfile, String> {
    load_profiles(&profiles_path(app)?)?
        .into_iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| "profile not found".to_string())
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
            org_id: p.org_id,
        })
        .collect())
}

/// Persist a profile (keychain token + `servers.json` entry) for a server
/// the user has already OAuth-signed-in to and chosen an org on.
#[tauri::command]
pub async fn servers_save_profile(
    app: tauri::AppHandle,
    name: String,
    url: String,
    token: String,
    org_id: String,
) -> Result<ServerProfile, String> {
    let profile = ServerProfile {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.trim().to_string(),
        url: dh_core::server::client::normalize_base(&url),
        org_id,
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
