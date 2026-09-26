use tauri::Manager;
use std::collections::BTreeMap;
use std::path::Path;
use super::model::{LocalConnInput, LocalConnMeta, LocalConnectionSecret, meta_from_input};
use crate::secret_store::{self, SecretRecord};

fn connections_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("connections.json"))
}

fn load_meta_map(app: &tauri::AppHandle) -> Result<BTreeMap<String, LocalConnMeta>, String> {
    let path = connections_path(app)?;
    load_meta_map_in(path.parent().expect("connections.json has a folder"))
}

fn load_meta_map_in(dir: &Path) -> Result<BTreeMap<String, LocalConnMeta>, String> {
    let path = dir.join("connections.json");
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(BTreeMap::new());
    }
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

/// Names of the connections saved in `dir`, for the secret store.
pub(crate) fn saved_names_in(dir: &Path) -> Result<Vec<String>, String> {
    Ok(load_meta_map_in(dir)?.into_keys().collect())
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

/// The SSH fields only count while the tunnel is on.
fn ssh_field(input: &LocalConnInput, value: &Option<String>, stored: Option<String>) -> Option<String> {
    input.ssh_host.as_ref().and(value.clone().or(stored))
}

#[tauri::command]
pub fn save_local_connection(
    app: tauri::AppHandle,
    input: LocalConnInput,
) -> Result<LocalConnMeta, String> {
    let meta = meta_from_input(&input)?;
    let store = secret_store::store(&app)?;
    if meta.remember_secret {
        let password = input
            .password
            .clone()
            .ok_or_else(|| "password is required to save a new connection".to_string())?;
        let record = SecretRecord {
            password: Some(password),
            ssh_password: ssh_field(&input, &input.ssh_password, None),
            ssh_key_passphrase: ssh_field(&input, &input.ssh_key_passphrase, None),
        };
        store.put(&meta.name, record)?;
    } else {
        store.remove(&meta.name)?;
    }
    let mut map = load_meta_map(&app)?;
    map.insert(meta.name.clone(), meta.clone());
    save_meta_map(&app, &map)?;
    Ok(meta)
}

/// A field left blank keeps the stored one; a secret that was missing stays
/// missing without an error.
fn merged_record(input: &LocalConnInput, existing: &SecretRecord) -> SecretRecord {
    SecretRecord {
        password: input.password.clone().or(existing.password.clone()),
        ssh_password: ssh_field(input, &input.ssh_password, existing.ssh_password.clone()),
        ssh_key_passphrase: ssh_field(
            input,
            &input.ssh_key_passphrase,
            existing.ssh_key_passphrase.clone(),
        ),
    }
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
    let store = secret_store::store(&app)?;
    if meta.remember_secret {
        let existing = store.get(&old_name)?.unwrap_or_default();
        let record = merged_record(&input, &existing);
        store.rename(&old_name, &meta.name)?;
        if record != existing {
            store.put(&meta.name, record)?;
        }
    } else {
        store.remove(&old_name)?;
        store.remove(&meta.name)?;
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
    if let Ok(store) = secret_store::store(&app) {
        let _ = store.remove(&name);
    }
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
    let record = secret_store::store(&app)?.get(&name)?.unwrap_or_default();
    let password = record
        .password
        .ok_or_else(|| "no stored password for this connection".to_string())?;
    Ok(LocalConnectionSecret {
        password,
        ssh_password: record.ssh_password,
        ssh_key_passphrase: record.ssh_key_passphrase,
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
    let store = secret_store::store(&app)?;
    let mut migrated = 0usize;
    for input in entries {
        if map.contains_key(&input.name) {
            continue;
        }
        let Some(password) = input.password.clone() else {
            continue;
        };
        // Entries from before labels existed carry no guard, so this only
        // skips an entry whose label or colour is invalid.
        let Ok(meta) = meta_from_input(&input) else {
            continue;
        };
        store.put(&meta.name, SecretRecord { password: Some(password), ..Default::default() })?;
        map.insert(meta.name.clone(), meta);
        migrated += 1;
    }
    save_meta_map(&app, &map)?;
    Ok(migrated)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(extra: serde_json::Value) -> LocalConnInput {
        let mut base = serde_json::json!({
            "name": "a", "kind": "postgres", "host": "h", "port": 5432, "user": "u", "database": "d"
        });
        base.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        serde_json::from_value(base).unwrap()
    }

    fn stored() -> SecretRecord {
        SecretRecord {
            password: Some("pw".into()),
            ssh_password: Some("sp".into()),
            ssh_key_passphrase: Some("kp".into()),
        }
    }

    #[test]
    fn blank_fields_keep_the_stored_secrets() {
        let edit = input(serde_json::json!({ "ssh_host": "jump" }));
        assert_eq!(merged_record(&edit, &stored()), stored());
    }

    #[test]
    fn new_values_replace_the_stored_ones() {
        let edit = input(serde_json::json!({ "password": "new", "ssh_host": "jump", "ssh_password": "s2" }));
        let merged = merged_record(&edit, &stored());
        assert_eq!(merged.password.as_deref(), Some("new"));
        assert_eq!(merged.ssh_password.as_deref(), Some("s2"));
        assert_eq!(merged.ssh_key_passphrase.as_deref(), Some("kp"));
    }

    #[test]
    fn turning_the_tunnel_off_clears_the_ssh_fields() {
        let merged = merged_record(&input(serde_json::json!({})), &stored());
        assert_eq!(merged.password.as_deref(), Some("pw"));
        assert!(merged.ssh_password.is_none() && merged.ssh_key_passphrase.is_none());
    }

    #[test]
    fn editing_with_a_missing_secret_leaves_it_missing() {
        let merged = merged_record(&input(serde_json::json!({})), &SecretRecord::default());
        assert!(merged.is_empty());
    }
}
