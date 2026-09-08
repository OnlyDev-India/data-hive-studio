//! Locally saved connection profiles (desktop only — web mode has no local
//! connections; the team-server holds all credentials there, see
//! `src/shared/api/web.ts`'s doc comment).
//!
//! Metadata (host, port, user, database, kind, …) lives in a plain JSON file
//! in the app-data dir. Passwords live in the OS keychain, following the
//! same pattern `servers.rs` already established for server auth tokens —
//! including its debug-build file fallback, since every `tauri dev` rebuild
//! is a new unsigned binary and macOS would otherwise re-prompt for
//! keychain access on every single launch.
//!
//! Connections are keyed by their display `name`, matching how the frontend
//! already keyed `savedLocal` before this module existed (see
//! `src/shared/store/store.ts`) — renames are handled by moving the
//! keychain entry (delete old, create new) inside `update_local_connection`
//! rather than introducing a separate stable id.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::Manager;

const KEYRING_SERVICE: &str = "dh-studio-connections";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConnMeta {
    pub name: String,
    /// "postgres" | "mongodb" | "sqlite"
    pub kind: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub database: String,
    #[serde(default)]
    pub ssl_mode: Option<String>,
    #[serde(default)]
    pub auth_db: Option<String>,
    #[serde(default)]
    pub srv: bool,
    #[serde(default)]
    pub tls: bool,
    #[serde(default)]
    pub ssl_ca_file: Option<String>,
    #[serde(default)]
    pub ssl_client_cert_file: Option<String>,
    /// Postgres only.
    #[serde(default)]
    pub ssl_client_key_file: Option<String>,
    /// MongoDB only: disable retryable writes — required for Amazon
    /// DocumentDB.
    #[serde(default)]
    pub retry_writes: bool,
    /// MongoDB only: replica set name — required by a real Amazon
    /// DocumentDB cluster, typically `rs0`.
    #[serde(default)]
    pub replica_set: Option<String>,
    /// Max pool connections (Postgres default 12, MongoDB default 10 when unset).
    #[serde(default)]
    pub pool_max: Option<u32>,
    /// Min pool connections kept open (Postgres default 1, MongoDB default 0 when unset).
    #[serde(default)]
    pub pool_min: Option<u32>,
    /// Postgres: pool acquire timeout (default 30s). MongoDB: TCP connect
    /// timeout (default 10s).
    #[serde(default)]
    pub connect_timeout_secs: Option<u32>,
    /// Postgres default 15 minutes; MongoDB default never, when unset.
    #[serde(default)]
    pub idle_timeout_secs: Option<u32>,
    /// Postgres only (default 30 minutes when unset).
    #[serde(default)]
    pub max_lifetime_secs: Option<u32>,
    /// MongoDB only (default 30s when unset).
    #[serde(default)]
    pub server_selection_timeout_secs: Option<u32>,
    /// `Some` means this connection tunnels through SSH — no secrets here,
    /// those live in the keychain like the main password (see
    /// `ssh_secret_key`/`get_local_connection_secret`).
    #[serde(default)]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_user: Option<String>,
    /// "password" | "key".
    #[serde(default)]
    pub ssh_auth_mode: Option<String>,
    #[serde(default)]
    pub ssh_key_file: Option<String>,
    #[serde(default)]
    pub ssh_host_key_fingerprint: Option<String>,
    #[serde(default)]
    pub source_path: Option<String>,
}

/// Payload for creating/editing a saved connection.
#[derive(Debug, Clone, Deserialize)]
pub struct LocalConnInput {
    pub name: String,
    pub kind: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    /// `None` on update keeps the existing stored password. Required
    /// (non-empty) on create — `save_local_connection` rejects `None`.
    #[serde(default)]
    pub password: Option<String>,
    pub database: String,
    #[serde(default)]
    pub ssl_mode: Option<String>,
    #[serde(default)]
    pub auth_db: Option<String>,
    #[serde(default)]
    pub srv: bool,
    #[serde(default)]
    pub tls: bool,
    #[serde(default)]
    pub ssl_ca_file: Option<String>,
    #[serde(default)]
    pub ssl_client_cert_file: Option<String>,
    #[serde(default)]
    pub ssl_client_key_file: Option<String>,
    #[serde(default)]
    pub retry_writes: bool,
    #[serde(default)]
    pub replica_set: Option<String>,
    #[serde(default)]
    pub pool_max: Option<u32>,
    #[serde(default)]
    pub pool_min: Option<u32>,
    #[serde(default)]
    pub connect_timeout_secs: Option<u32>,
    #[serde(default)]
    pub idle_timeout_secs: Option<u32>,
    #[serde(default)]
    pub max_lifetime_secs: Option<u32>,
    #[serde(default)]
    pub server_selection_timeout_secs: Option<u32>,
    #[serde(default)]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_user: Option<String>,
    #[serde(default)]
    pub ssh_auth_mode: Option<String>,
    #[serde(default)]
    pub ssh_key_file: Option<String>,
    #[serde(default)]
    pub ssh_host_key_fingerprint: Option<String>,
    /// `None` on update keeps the existing stored SSH password. Ignored
    /// when `ssh_host` is `None` (tunnel disabled — stored SSH secrets are
    /// deleted).
    #[serde(default)]
    pub ssh_password: Option<String>,
    /// Same "`None` on update keeps the existing one" rule as `ssh_password`.
    #[serde(default)]
    pub ssh_key_passphrase: Option<String>,
    #[serde(default)]
    pub source_path: Option<String>,
}

fn meta_from_input(input: &LocalConnInput) -> LocalConnMeta {
    LocalConnMeta {
        name: input.name.clone(),
        kind: input.kind.clone(),
        host: input.host.clone(),
        port: input.port,
        user: input.user.clone(),
        database: input.database.clone(),
        ssl_mode: input.ssl_mode.clone(),
        auth_db: input.auth_db.clone(),
        srv: input.srv,
        tls: input.tls,
        ssl_ca_file: input.ssl_ca_file.clone(),
        ssl_client_cert_file: input.ssl_client_cert_file.clone(),
        ssl_client_key_file: input.ssl_client_key_file.clone(),
        retry_writes: input.retry_writes,
        replica_set: input.replica_set.clone(),
        pool_max: input.pool_max,
        pool_min: input.pool_min,
        connect_timeout_secs: input.connect_timeout_secs,
        idle_timeout_secs: input.idle_timeout_secs,
        max_lifetime_secs: input.max_lifetime_secs,
        server_selection_timeout_secs: input.server_selection_timeout_secs,
        ssh_host: input.ssh_host.clone(),
        ssh_port: input.ssh_port,
        ssh_user: input.ssh_user.clone(),
        ssh_auth_mode: input.ssh_auth_mode.clone(),
        ssh_key_file: input.ssh_key_file.clone(),
        ssh_host_key_fingerprint: input.ssh_host_key_fingerprint.clone(),
        source_path: input.source_path.clone(),
    }
}

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
fn password_file(app: &tauri::AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = dir.join("connection-passwords");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(sanitize_filename(name)))
}

// ---- Password persistence ----------------------------------------------
//
// Release builds use the OS keychain. Debug builds store the password in an
// app-data file with 0600 permissions instead — same rationale as
// `servers.rs`'s token storage (see that file's comment).

fn save_password(app: &tauri::AppHandle, name: &str, password: &str) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let path = password_file(app, name)?;
        std::fs::write(&path, password).map_err(|e| e.to_string())?;
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
        keyring_entry(name)?
            .set_password(password)
            .map_err(|e| e.to_string())
    }
}

fn load_password(app: &tauri::AppHandle, name: &str) -> Result<String, String> {
    #[cfg(debug_assertions)]
    {
        let path = password_file(app, name)?;
        if path.exists() {
            return std::fs::read_to_string(path).map_err(|e| e.to_string());
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

fn delete_password(app: &tauri::AppHandle, name: &str) {
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
struct SshSecrets {
    password: Option<String>,
    key_passphrase: Option<String>,
}

fn save_ssh_secrets(app: &tauri::AppHandle, name: &str, secrets: &SshSecrets) -> Result<(), String> {
    let json = serde_json::to_string(secrets).map_err(|e| e.to_string())?;
    save_password(app, &ssh_secret_key(name), &json)
}

/// Missing/unreadable entry (no SSH tunnel configured, or first read after
/// enabling one) is `SshSecrets::default()`, not an error.
fn load_ssh_secrets(app: &tauri::AppHandle, name: &str) -> SshSecrets {
    load_password(app, &ssh_secret_key(name))
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn delete_ssh_secrets(app: &tauri::AppHandle, name: &str) {
    delete_password(app, &ssh_secret_key(name));
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
    let password = input
        .password
        .clone()
        .ok_or_else(|| "password is required to save a new connection".to_string())?;
    let meta = meta_from_input(&input);
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
    let meta = meta_from_input(&input);
    let renamed = old_name != meta.name;
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

#[derive(Debug, Serialize)]
pub struct LocalConnectionSecret {
    pub password: String,
    pub ssh_password: Option<String>,
    pub ssh_key_passphrase: Option<String>,
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
        let meta = meta_from_input(&input);
        save_password(&app, &meta.name, password)?;
        map.insert(meta.name.clone(), meta);
        migrated += 1;
    }
    save_meta_map(&app, &map)?;
    Ok(migrated)
}
