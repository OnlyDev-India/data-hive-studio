//! Sign out and My devices (spec 0010, sessions). Thin forwarding to the
//! server's `/v1/me/sessions` routes; the server decides what a person may see
//! and end, so none of this checks anything itself.

use dh_server_client::auth::SessionInfo;
use super::profiles::find_profile;
use super::sessions::{client_for_url, disconnect_server};

/// Sign out of a server, ending this device's session there. Every profile on
/// that server is signed out with it (they share one session). Returns whether
/// the server was told: `false` means it could not be reached, so the app is
/// signed out here but the device may still be listed under My devices.
#[tauri::command]
pub async fn servers_sign_out(app: tauri::AppHandle, profile_id: String) -> Result<bool, String> {
    let profile = find_profile(&app, &profile_id)?;
    let client = client_for_url(&app, &profile.url);
    let told = match client.sign_out().await {
        Ok(()) => true,
        Err(_) => {
            client.session().forget();
            false
        }
    };
    disconnect_server(&app, &profile.url);
    Ok(told)
}

#[tauri::command]
pub async fn servers_sessions_list(app: tauri::AppHandle, profile_id: String) -> Result<Vec<SessionInfo>, String> {
    let profile = find_profile(&app, &profile_id)?;
    client_for_url(&app, &profile.url).sessions_list().await
}

/// End one device. Returns true when it was this device, so the app is signed
/// out (and every profile on the server with it).
#[tauri::command]
pub async fn servers_session_end(
    app: tauri::AppHandle,
    profile_id: String,
    session_id: String,
) -> Result<bool, String> {
    let profile = find_profile(&app, &profile_id)?;
    let client = client_for_url(&app, &profile.url);
    client.session_end(&session_id).await?;
    let signed_out = !client.session().signed_in();
    if signed_out {
        disconnect_server(&app, &profile.url);
    }
    Ok(signed_out)
}

/// Sign out everywhere: every device, this one included. Every profile on the
/// server shows signed out afterward.
#[tauri::command]
pub async fn servers_sessions_end_all(app: tauri::AppHandle, profile_id: String) -> Result<(), String> {
    let profile = find_profile(&app, &profile_id)?;
    client_for_url(&app, &profile.url).sessions_end_all().await?;
    disconnect_server(&app, &profile.url);
    Ok(())
}

/// The server owner ends every session of a person. The server answers 403 to
/// anyone else. No screen calls this yet (see the scope's follow up list).
#[tauri::command]
pub async fn servers_owner_end_sessions(
    app: tauri::AppHandle,
    profile_id: String,
    user_id: String,
) -> Result<u64, String> {
    let profile = find_profile(&app, &profile_id)?;
    client_for_url(&app, &profile.url).owner_end_sessions(&user_id).await
}
