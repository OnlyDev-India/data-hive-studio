use tauri::Manager;
use serde::{Deserialize, Serialize};
use super::KEYRING_SERVICE;

fn keyring_entry(name: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, name).map_err(|e| e.to_string())
}

/// Connection names are free-form user text (could contain `/`, `..`, etc.)
/// — hex-encode before using as a filename so nothing escapes the directory.
#[cfg(debug_assertions)]
fn sanitize_filename(name: &str) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(name.len() * 2);
    for b in name.as_bytes() {
        let _ = write!(out, "{b:02x}");
    }
    out
}

#[cfg(debug_assertions)]
fn password_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = dir.join("connection-passwords");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[cfg(debug_assertions)]
fn password_file(app: &tauri::AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    Ok(password_dir(app)?.join(sanitize_filename(name)))
}

// ---- Password persistence ----------------------------------------------
//
// Release builds use the OS keychain. Debug builds store the password in an
// app-data file instead, ENCRYPTED (see `secret_file.rs`) rather than
// plain text — same rationale as `servers.rs`'s token storage (see that
// file's comment) for why the OS keychain is skipped in debug builds at all.
pub(super) fn save_password(app: &tauri::AppHandle, name: &str, password: &str) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let dir = password_dir(app)?;
        let key = crate::secret_file::master_key(&dir)?;
        crate::secret_file::save(&password_file(app, name)?, &key, password)
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        keyring_entry(name)?
            .set_password(password)
            .map_err(|e| e.to_string())
    }
}

pub(super) fn load_password(app: &tauri::AppHandle, name: &str) -> Result<String, String> {
    #[cfg(debug_assertions)]
    {
        let dir = password_dir(app)?;
        let key = crate::secret_file::master_key(&dir)?;
        if let Some(pw) = crate::secret_file::load(&password_file(app, name)?, &key)? {
            return Ok(pw);
        }
        // One-time migration from a previously used keychain entry (e.g. a
        // release build's data reused in dev). May prompt once; the file
        // wins afterwards and macOS is never touched again.
        if let Ok(pw) = keyring_entry(name)?
            .get_password()
            .map_err(|_| "no stored password for this connection".to_string())
        {
            save_password(app, name, &pw)?;
            return Ok(pw);
        }
        Err("no stored password for this connection".into())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        keyring_entry(name)?
            .get_password()
            .map_err(|_| "no stored password for this connection".to_string())
    }
}

pub(super) fn delete_password(app: &tauri::AppHandle, name: &str) {
    #[cfg(debug_assertions)]
    {
        if let Ok(path) = password_file(app, name) {
            let _ = std::fs::remove_file(path);
        }
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = app;
        let _ = keyring_entry(name).and_then(|e| e.delete_credential().map_err(|e| e.to_string()));
    }
}

// ---- SSH secret persistence -------------------------------------------
//
// Password + key passphrase, stored together as one JSON blob under a
// second keychain entry per connection (same `save_password`/`load_password`
// machinery as the main DB password, just a different entry name) — avoids
// a third keychain prompt/file for what's really one logical secret.
fn ssh_secret_key(name: &str) -> String {
    format!("{name}::ssh")
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub(super) struct SshSecrets {
    pub(super) password: Option<String>,
    pub(super) key_passphrase: Option<String>,
}

pub(super) fn save_ssh_secrets(app: &tauri::AppHandle, name: &str, secrets: &SshSecrets) -> Result<(), String> {
    let json = serde_json::to_string(secrets).map_err(|e| e.to_string())?;
    save_password(app, &ssh_secret_key(name), &json)
}

/// Missing/unreadable entry (no SSH tunnel configured, or first read after
/// enabling one) is `SshSecrets::default()`, not an error.
pub(super) fn load_ssh_secrets(app: &tauri::AppHandle, name: &str) -> SshSecrets {
    load_password(app, &ssh_secret_key(name))
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

pub(super) fn delete_ssh_secrets(app: &tauri::AppHandle, name: &str) {
    delete_password(app, &ssh_secret_key(name));
}
