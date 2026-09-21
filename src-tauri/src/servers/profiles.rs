use tauri::Manager;
use dh_core::server::profiles;
use dh_core::server::profiles::{load_profiles, save_profiles, ServerProfile};
use super::ServerProfileView;
use super::sessions::{disconnect_server, forget_server, session_for, signed_in};
use super::tokens::scrub_old_tokens;

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
    let all = load_profiles(&profiles_path(&app)?)?;
    scrub_old_tokens(&app, &all.iter().map(|p| p.id.clone()).collect::<Vec<_>>());
    Ok(all
        .into_iter()
        .map(|p| ServerProfileView {
            connected: profiles::is_connected(&p.id),
            signed_in: signed_in(&app, &p.url),
            id: p.id,
            name: p.name,
            url: p.url,
            org_id: p.org_id,
        })
        .collect())
}

/// Persist a profile (`servers.json` entry) for a server the user has already
/// OAuth-signed-in to and chosen an org on. No token is passed in or stored
/// with it: the profile finds the session by its server address.
#[tauri::command]
pub async fn servers_save_profile(
    app: tauri::AppHandle,
    name: String,
    url: String,
    org_id: String,
) -> Result<ServerProfile, String> {
    let profile = ServerProfile {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.trim().to_string(),
        url: dh_core::server::client::normalize_base(&url),
        org_id,
    };
    let path = profiles_path(&app)?;
    let mut all = load_profiles(&path)?;
    all.push(profile.clone());
    save_profiles(&path, &all)?;
    Ok(profile)
}

/// Remove a saved profile. When it was the last profile for its server, the
/// device session on that server ends too (best effort: the saved token is
/// forgotten either way).
#[tauri::command]
pub async fn servers_remove(app: tauri::AppHandle, profile_id: String) -> Result<(), String> {
    let path = profiles_path(&app)?;
    let mut all = load_profiles(&path)?;
    let Some(removed) = all.iter().find(|p| p.id == profile_id).cloned() else {
        return Ok(());
    };
    profiles::remove_client(&profile_id);
    all.retain(|p| p.id != profile_id);
    save_profiles(&path, &all)?;
    if !all.iter().any(|p| p.url == removed.url) {
        let session = session_for(&app, &removed.url);
        if session.signed_in() {
            let _ = super::sessions::client_for_url(&app, &removed.url).sign_out().await;
        }
        disconnect_server(&app, &removed.url);
        forget_server(&app, &removed.url);
    }
    Ok(())
}
