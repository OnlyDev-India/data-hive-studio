use tauri::Manager;
use std::collections::BTreeMap;
use super::model::{LocalConnInput, LocalConnMeta, LocalConnectionSecret, meta_from_input};
use super::secrets::{SshSecrets, delete_password, delete_ssh_secrets, load_password, load_ssh_secrets, save_password, save_ssh_secrets};

fn connections_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("connections.json"))
}

fn load_meta_map(app: &tauri::AppHandle) -> Result<BTreeMap<String, LocalConnMeta>, String> {
    let path = connections_path(app)?;
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(BTreeMap::new());
    }
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn save_meta_map(
    app: &tauri::AppHandle,
    map: &BTreeMap<String, LocalConnMeta>,
) -> Result<(), String> {
    let path = connections_path(app)?;
    let raw = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())
}

// ---- Commands ------------------------------------------------------------
#[tauri::command]
pub fn list_local_connections(app: tauri::AppHandle) -> Result<Vec<LocalConnMeta>, String> {
    Ok(load_meta_map(&app)?.into_values().collect())
}

#[tauri::command]
pub fn save_local_connection(
    app: tauri::AppHandle,
    input: LocalConnInput,
) -> Result<LocalConnMeta, String> {
    let meta = meta_from_input(&input)?;
    if meta.remember_secret {
        let password = input
            .password
            .clone()
            .ok_or_else(|| "password is required to save a new connection".to_string())?;
        save_password(&app, &meta.name, &password)?;
        if input.ssh_host.is_some() {
            save_ssh_secrets(
                &app,
                &meta.name,
                &SshSecrets {
                    password: input.ssh_password.clone(),
                    key_passphrase: input.ssh_key_passphrase.clone(),
                },
            )?;
        }
    } else {
        delete_password(&app, &meta.name);
        delete_ssh_secrets(&app, &meta.name);
    }
    let mut map = load_meta_map(&app)?;
    map.insert(meta.name.clone(), meta.clone());
    save_meta_map(&app, &map)?;
    Ok(meta)
}

#[tauri::command]
pub fn update_local_connection(
    app: tauri::AppHandle,
    old_name: String,
    input: LocalConnInput,
) -> Result<LocalConnMeta, String> {
    let mut map = load_meta_map(&app)?;
    if !map.contains_key(&old_name) {
        return Err("connection not found".into());
    }
    let meta = meta_from_input(&input)?;
    let renamed = old_name != meta.name;
    if !meta.remember_secret {
        for name in [&old_name, &meta.name] {
            delete_password(&app, name);
            delete_ssh_secrets(&app, name);
        }
        map.remove(&old_name);
        map.insert(meta.name.clone(), meta.clone());
        save_meta_map(&app, &map)?;
        return Ok(meta);
    }
    match &input.password {
        Some(pw) => {
            save_password(&app, &meta.name, pw)?;
            if renamed {
                delete_password(&app, &old_name);
            }
        }
        None => {
            let pw = load_password(&app, &old_name)?;
            if renamed {
                save_password(&app, &meta.name, &pw)?;
                delete_password(&app, &old_name);
            }
        }
    }
    // Disabling the tunnel drops any stored SSH secrets; otherwise keep
    // whichever of password/key-passphrase wasn't provided this time.
    match &input.ssh_host {
        None => delete_ssh_secrets(&app, &old_name),
        Some(_) => {
            let existing = load_ssh_secrets(&app, &old_name);
            let secrets = SshSecrets {
                password: input.ssh_password.clone().or(existing.password),
                key_passphrase: input.ssh_key_passphrase.clone().or(existing.key_passphrase),
            };
            save_ssh_secrets(&app, &meta.name, &secrets)?;
            if renamed {
                delete_ssh_secrets(&app, &old_name);
            }
        }
    }
    map.remove(&old_name);
    map.insert(meta.name.clone(), meta.clone());
    save_meta_map(&app, &map)?;
    Ok(meta)
}

#[tauri::command]
pub fn delete_local_connection(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let mut map = load_meta_map(&app)?;
    map.remove(&name);
    save_meta_map(&app, &map)?;
    delete_password(&app, &name);
    delete_ssh_secrets(&app, &name);
    Ok(())
}

/// Fetch a saved connection's real secrets (DB password, and SSH
/// password/key-passphrase if it tunnels through SSH) — called right before
/// actually opening it (`connect_postgres`/`connect_mongodb`/…), never
/// stored back in plain state on the frontend beyond that.
#[tauri::command]
pub fn get_local_connection_secret(
    app: tauri::AppHandle,
    name: String,
) -> Result<LocalConnectionSecret, String> {
    let password = load_password(&app, &name)?;
    let ssh = load_ssh_secrets(&app, &name);
    Ok(LocalConnectionSecret {
        password,
        ssh_password: ssh.password,
        ssh_key_passphrase: ssh.key_passphrase,
    })
}

/// One-time import from the frontend's pre-keychain `localStorage` storage.
/// The frontend calls this exactly once, when `list_local_connections`
/// comes back empty but `localStorage` still has saved connections. Skips
/// any name already present, so it's safe to call more than once.
#[tauri::command]
pub fn migrate_local_connections(
    app: tauri::AppHandle,
    entries: Vec<LocalConnInput>,
) -> Result<usize, String> {
    let mut map = load_meta_map(&app)?;
    let mut migrated = 0usize;
    for input in entries {
        if map.contains_key(&input.name) {
            continue;
        }
        let Some(password) = input.password.as_deref() else {
            continue;
        };
        // Entries from before labels existed carry no guard, so this only
        // skips an entry whose label or colour is invalid.
        let Ok(meta) = meta_from_input(&input) else {
            continue;
        };
        save_password(&app, &meta.name, password)?;
        map.insert(meta.name.clone(), meta);
        migrated += 1;
    }
    save_meta_map(&app, &map)?;
    Ok(migrated)
}
