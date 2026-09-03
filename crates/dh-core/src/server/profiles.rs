//! Saved team-server profiles: the in-process client registry, the
//! `srv:<profile_id>:<conn_id>` addressing scheme, and profile-list
//! persistence — everything about this that has no Tauri dependency.
//!
//! What stays in `src-tauri` instead: resolving WHERE the profiles file and
//! tokens live (`AppHandle::path()`), and token storage itself (the OS
//! keychain via the `keyring` crate, which `dh-core` doesn't and shouldn't
//! depend on — `dh-server` has no keychain to talk to). Desktop just calls
//! `load_profiles`/`save_profiles` with the path it resolved.

use super::client::ServerClient;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServerProfile {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub team_name: Option<String>,
}

/// Process-wide registry of connected server clients, keyed by profile id.
fn clients() -> &'static Mutex<HashMap<String, ServerClient>> {
    static CLIENTS: OnceLock<Mutex<HashMap<String, ServerClient>>> = OnceLock::new();
    CLIENTS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn is_connected(profile_id: &str) -> bool {
    clients().lock().unwrap().contains_key(profile_id)
}

pub fn insert_client(profile_id: String, client: ServerClient) {
    clients().lock().unwrap().insert(profile_id, client);
}

pub fn remove_client(profile_id: &str) {
    clients().lock().unwrap().remove(profile_id);
}

pub fn client_for(profile_id: &str) -> Result<ServerClient, String> {
    clients()
        .lock()
        .unwrap()
        .get(profile_id)
        .cloned()
        .ok_or_else(|| "not connected to this server".to_string())
}

/// Read the saved profile list from `path`. Missing file = no profiles yet.
pub fn load_profiles(path: &Path) -> Result<Vec<ServerProfile>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

/// Write the profile list to `path` (pretty JSON, matches the existing
/// on-disk format so this is a drop-in replacement for the file).
pub fn save_profiles(path: &Path, profiles: &[ServerProfile]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(profiles).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())
}

// ---- Gateway passthrough addressing ----------------------------------------
//
// The frontend addresses server-backed connections with namespaced ids of the
// form `srv:<profile_id>:<conn_id>`; these split them back apart so every
// existing grid/console component keeps working unchanged.

pub fn split_conn_id(conn_id: &str) -> Option<(String, String)> {
    let rest = conn_id.strip_prefix("srv:")?;
    let (profile_id, remote) = rest.split_once(':')?;
    Some((profile_id.to_string(), remote.to_string()))
}

pub async fn with_remote<T>(
    conn_id: &str,
    f: impl FnOnce(ServerClient, String) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<T, String>> + Send>>,
) -> Result<T, String> {
    let (profile_id, remote) =
        split_conn_id(conn_id).ok_or_else(|| "not a server connection".to_string())?;
    let client = client_for(&profile_id)?;
    f(client, remote).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_conn_id_parses_well_formed_ids() {
        assert_eq!(
            split_conn_id("srv:p1:c1"),
            Some(("p1".to_string(), "c1".to_string()))
        );
    }

    #[test]
    fn split_conn_id_rejects_malformed_ids() {
        assert_eq!(split_conn_id("local-id"), None);
        assert_eq!(split_conn_id("srv:p1"), None);
        assert_eq!(split_conn_id("srv:p1:"), Some(("p1".to_string(), "".to_string())));
    }

    #[test]
    fn client_for_reports_not_connected_when_absent() {
        assert_eq!(
            client_for("unknown-profile-id-for-test").err().unwrap(),
            "not connected to this server"
        );
    }

    #[test]
    fn load_profiles_of_missing_file_is_empty() {
        let path = std::env::temp_dir().join(format!("dh-core-test-missing-{}.json", uuid::Uuid::new_v4()));
        assert_eq!(load_profiles(&path).unwrap(), Vec::new());
    }

    #[test]
    fn save_then_load_profiles_round_trips() {
        let path = std::env::temp_dir().join(format!("dh-core-test-profiles-{}.json", uuid::Uuid::new_v4()));
        let profiles = vec![ServerProfile {
            id: "p1".into(),
            name: "Team".into(),
            url: "https://example.test".into(),
            team_name: Some("acme".into()),
        }];
        save_profiles(&path, &profiles).unwrap();
        let loaded = load_profiles(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "p1");
        assert_eq!(loaded[0].team_name.as_deref(), Some("acme"));
    }
}
