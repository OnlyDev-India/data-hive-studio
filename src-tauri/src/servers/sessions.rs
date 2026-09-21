//! The desktop's device sessions (spec 0010, sessions): one per server URL,
//! shared by every profile on that server, and held only in Rust. The renewal
//! token behind each is in the keychain (see `tokens.rs`); the access token
//! never leaves memory.

use dh_core::server::client::{normalize_base, DeviceParams, ServerClient, SessionState, TokenStore};
use dh_core::server::profiles::{self, load_profiles};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{Emitter, Manager};
use super::profiles::profiles_path;
use super::tokens::{delete_refresh_token, load_refresh_token, save_refresh_token};

/// Emitted to the window when a server's session ends without the person
/// asking (a renewal was refused), so the menu can show "Sign in again".
pub const SIGNED_OUT_EVENT: &str = "server-signed-out";

/// Keeps a server's renewal token in the keychain for its session.
struct KeychainStore {
    app: tauri::AppHandle,
    url: String,
}

impl TokenStore for KeychainStore {
    fn save(&self, refresh_token: &str) -> Result<(), String> {
        save_refresh_token(&self.app, &self.url, refresh_token)
    }

    fn clear(&self) {
        delete_refresh_token(&self.app, &self.url);
        let _ = self.app.emit(SIGNED_OUT_EVENT, &self.url);
    }
}

fn registry() -> &'static Mutex<HashMap<String, Arc<SessionState>>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<SessionState>>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The session for `url`, made from the saved renewal token the first time it
/// is asked for. Signed out (nothing saved) gives a session that says so.
pub(super) fn session_for(app: &tauri::AppHandle, url: &str) -> Arc<SessionState> {
    let url = normalize_base(url);
    registry()
        .lock()
        .unwrap()
        .entry(url.clone())
        .or_insert_with(|| {
            let saved = load_refresh_token(app, &url);
            SessionState::from_saved(&url, saved, Box::new(KeychainStore { app: app.clone(), url: url.clone() }))
        })
        .clone()
}

/// A client for `url` on its shared session.
pub(super) fn client_for_url(app: &tauri::AppHandle, url: &str) -> ServerClient {
    ServerClient::new(url, session_for(app, url))
}

/// Start using the session a sign in just made, saving its renewal token.
pub(super) fn install_session(
    app: &tauri::AppHandle,
    url: &str,
    reply: &dh_core::server::client::SessionReply,
) -> Result<ServerClient, String> {
    let url = normalize_base(url);
    let store = Box::new(KeychainStore { app: app.clone(), url: url.clone() });
    let session = SessionState::from_reply(&url, reply, store)?;
    registry().lock().unwrap().insert(url.clone(), session.clone());
    Ok(ServerClient::new(&url, session))
}

/// Whether the app holds a session for `url` (the profile is not signed out).
pub(super) fn signed_in(app: &tauri::AppHandle, url: &str) -> bool {
    session_for(app, url).signed_in()
}

/// Drop the connected clients of every profile on `url`, so each shows
/// disconnected. The session behind them is shared, so when it ends they all do.
pub(super) fn disconnect_server(app: &tauri::AppHandle, url: &str) {
    let url = normalize_base(url);
    if let Ok(all) = profiles_path(app).and_then(|p| load_profiles(&p)) {
        for p in all.iter().filter(|p| p.url == url) {
            profiles::remove_client(&p.id);
        }
    }
}

/// Stop tracking a server the app no longer has any profile for.
pub(super) fn forget_server(app: &tauri::AppHandle, url: &str) {
    let url = normalize_base(url);
    if let Some(session) = registry().lock().unwrap().remove(&url) {
        session.forget();
    } else {
        delete_refresh_token(app, &url);
    }
}

fn device_id_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("device-id"))
}

/// The random id this install signs in with, made once and kept in the app
/// data folder. It names the device, it is not a secret.
fn device_id(app: &tauri::AppHandle) -> Result<String, String> {
    let path = device_id_path(app)?;
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let existing = existing.trim();
        if !existing.is_empty() {
            return Ok(existing.to_string());
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    std::fs::write(&path, &id).map_err(|e| e.to_string())?;
    Ok(id)
}

/// This computer as the device list shows it: the machine name, or `Desktop`.
pub(super) fn device_params(app: &tauri::AppHandle) -> Result<DeviceParams, String> {
    let name = tauri_plugin_os::hostname();
    Ok(DeviceParams {
        device_id: device_id(app)?,
        device_name: if name.trim().is_empty() { "Desktop".to_string() } else { name },
    })
}
