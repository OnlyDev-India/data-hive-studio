use dh_core::server::profiles::client_for;
use dh_core::server::vault::{ConnInput, ConnMeta};

// ---- Connections (org-scoped) ------------------------------------------------

/// Publish a new shared connection in the profile's org. Requires at least
/// `Member` there — enforced server-side.
#[tauri::command]
pub async fn servers_create_connection(
    profile_id: String,
    org_id: String,
    input: ConnInput,
) -> Result<ConnMeta, String> {
    client_for(&profile_id)?.create_connection(&org_id, &input).await
}

/// Edit a shared connection's stored details (requires update access —
/// enforced server-side).
#[tauri::command]
pub async fn servers_update_connection(
    profile_id: String,
    conn_id: String,
    input: ConnInput,
) -> Result<ConnMeta, String> {
    client_for(&profile_id)?.update_connection(&conn_id, &input).await
}

/// Delete (archive) a shared connection. Requires delete access — enforced
/// server-side.
#[tauri::command]
pub async fn servers_delete_connection(profile_id: String, conn_id: String) -> Result<(), String> {
    client_for(&profile_id)?.delete_connection(&conn_id).await
}

/// Fetch decrypted connection credentials from the server.
#[tauri::command]
pub async fn servers_fetch_credentials(
    profile_id: String,
    conn_id: String,
) -> Result<serde_json::Value, String> {
    client_for(&profile_id)?.fetch_credentials(&conn_id).await
}
