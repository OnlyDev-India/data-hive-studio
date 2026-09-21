#[cfg(debug_assertions)]
use tauri::Manager;
#[cfg(not(debug_assertions))]
use super::KEYRING_SERVICE;

// ---- Renewal token persistence -------------------------------------------------
//
// The desktop keeps one renewal token per server URL (spec 0010, sessions), so
// two org profiles on one server share one device session. The short lived
// access token is never stored: it lives in Rust memory and is renewed from
// this token. The JavaScript side never holds either.
//
// Release builds use the OS keychain. Debug builds store the token in an
// app-data file with 0600 permissions instead: every `tauri dev` rebuild
// produces a new unsigned binary and macOS re-prompts for keychain access
// on each launch, which makes development unbearable.

/// A name that is safe as a file name and the same for every spelling of a URL
/// that `normalize_base` treats as one server.
#[cfg(debug_assertions)]
fn server_key(url: &str) -> String {
    dh_core::server::crypto::hash_token(&dh_core::server::client::normalize_base(url))
}

#[cfg(not(debug_assertions))]
fn keyring_entry(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, account).map_err(|e| e.to_string())
}

#[cfg(not(debug_assertions))]
fn refresh_account(url: &str) -> String {
    format!("refresh:{}", dh_core::server::client::normalize_base(url))
}

#[cfg(debug_assertions)]
fn token_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = dir.join("server-tokens");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub(super) fn save_refresh_token(app: &tauri::AppHandle, url: &str, token: &str) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let dir = token_dir(app)?;
        let key = crate::secret_file::master_key(&dir)?;
        crate::secret_file::save(&dir.join(server_key(url)), &key, token)
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        keyring_entry(&refresh_account(url))?.set_password(token).map_err(|e| e.to_string())
    }
}

/// `None` when nothing is saved for this server: the person is signed out.
pub(super) fn load_refresh_token(app: &tauri::AppHandle, url: &str) -> Option<String> {
    #[cfg(debug_assertions)]
    {
        let dir = token_dir(app).ok()?;
        let key = crate::secret_file::master_key(&dir).ok()?;
        crate::secret_file::load(&dir.join(server_key(url)), &key).ok().flatten()
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        keyring_entry(&refresh_account(url)).ok()?.get_password().ok()
    }
}

pub(super) fn delete_refresh_token(app: &tauri::AppHandle, url: &str) {
    #[cfg(debug_assertions)]
    {
        if let Ok(dir) = token_dir(app) {
            let _ = std::fs::remove_file(dir.join(server_key(url)));
        }
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        let _ = keyring_entry(&refresh_account(url)).and_then(|e| e.delete_credential().map_err(|e| e.to_string()));
    }
}

/// Delete the per profile token entries an older build saved (each was a
/// 30 day session token, keyed by profile id). They no longer work, and a
/// token at rest that cannot be used is only a liability. Runs once per start.
pub(super) fn scrub_old_tokens(app: &tauri::AppHandle, profile_ids: &[String]) {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        for id in profile_ids {
            #[cfg(debug_assertions)]
            if let Ok(dir) = token_dir(app) {
                let _ = std::fs::remove_file(dir.join(id));
            }
            #[cfg(not(debug_assertions))]
            {
                let _ = app;
                let _ = keyring_entry(id).and_then(|e| e.delete_credential().map_err(|e| e.to_string()));
            }
        }
    });
}
