use tauri::Manager;
use super::KEYRING_SERVICE;

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
fn token_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = dir.join("server-tokens");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[cfg(debug_assertions)]
fn token_file(app: &tauri::AppHandle, profile_id: &str) -> Result<std::path::PathBuf, String> {
    Ok(token_dir(app)?.join(profile_id))
}

pub(super) fn save_token(app: &tauri::AppHandle, profile_id: &str, token: &str) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let dir = token_dir(app)?;
        let key = crate::secret_file::master_key(&dir)?;
        crate::secret_file::save(&token_file(app, profile_id)?, &key, token)
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        keyring_entry(profile_id)?.set_password(token).map_err(|e| e.to_string())
    }
}

pub(super) fn load_token(app: &tauri::AppHandle, profile_id: &str) -> Result<String, String> {
    #[cfg(debug_assertions)]
    {
        let dir = token_dir(app)?;
        let key = crate::secret_file::master_key(&dir)?;
        if let Some(token) = crate::secret_file::load(&token_file(app, profile_id)?, &key)? {
            return Ok(token);
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

pub(super) fn delete_token(app: &tauri::AppHandle, profile_id: &str) {
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
