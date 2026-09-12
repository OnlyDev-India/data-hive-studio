//! Saved team-server profiles and gateway passthrough — the Tauri-specific
//! shell around `dh_core::server::profiles`: this file resolves WHERE the
//! profiles file and tokens live (`AppHandle::path()`), does the actual
//! token storage (OS keychain via `keyring`, or a dev-mode file — `dh-core`
//! has no keychain dependency since `dh-server` has no keychain to talk
//! to), and — new in the OAuth/org model — runs the desktop sign-in flow
//! (open the system browser, catch the callback on a local loopback
//! listener). Everything else forwards straight through, mirroring
//! `commands.rs`'s thin-forwarding pattern for the desktop DB commands.

use dh_core::server::client::{oauth_start_url, MeResult, ServerClient};
use dh_core::server::orgs::{OrgInvite, OrgMember, OrgRole, Organization};
use dh_core::server::profiles::{
    self, client_for, load_profiles, save_profiles, with_remote, ServerProfile,
};
use dh_core::server::vault::{ConnInput, ConnMeta};
use serde::Serialize;
use std::io::{Read, Write};
use tauri::Manager;

const KEYRING_SERVICE: &str = "dh-studio-server";

#[derive(Serialize)]
pub struct ServerProfileView {
    pub id: String,
    pub name: String,
    pub url: String,
    pub org_id: String,
    pub connected: bool,
}

#[derive(Serialize)]
pub struct ServerSession {
    pub profile: ServerProfile,
    pub me: MeResult,
    pub connections: Vec<dh_core::server::gateway::ConnWithAccess>,
}

fn profiles_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("servers.json"))
}

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

fn save_token(app: &tauri::AppHandle, profile_id: &str, token: &str) -> Result<(), String> {
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

fn load_token(app: &tauri::AppHandle, profile_id: &str) -> Result<String, String> {
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

fn delete_token(app: &tauri::AppHandle, profile_id: &str) {
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

fn find_profile(app: &tauri::AppHandle, profile_id: &str) -> Result<ServerProfile, String> {
    load_profiles(&profiles_path(app)?)?
        .into_iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| "profile not found".to_string())
}

#[tauri::command]
pub fn servers_list(app: tauri::AppHandle) -> Result<Vec<ServerProfileView>, String> {
    Ok(load_profiles(&profiles_path(&app)?)?
        .into_iter()
        .map(|p| ServerProfileView {
            connected: profiles::is_connected(&p.id),
            id: p.id,
            name: p.name,
            url: p.url,
            org_id: p.org_id,
        })
        .collect())
}

// ---- OAuth sign-in ------------------------------------------------------
//
// The web build just redirects the browser tab to `/auth/{provider}/start`
// and reads the token back out of the callback URL — there's already a
// page to redirect TO. Desktop has none of that, so it opens the OS
// browser and catches the callback itself via a short-lived local loopback
// listener (`http://127.0.0.1:<port>/callback?token=...`) instead of
// registering a custom URL scheme (`tauri-plugin-deep-link`) — no extra
// platform-specific setup (Info.plist / registry entries) needed for a
// flow that only ever runs once per sign-in and completes in seconds.

fn open_in_browser(url: &str) -> Result<(), String> {
    let result = if cfg!(target_os = "macos") {
        std::process::Command::new("open").arg(url).spawn()
    } else if cfg!(target_os = "windows") {
        std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn()
    } else {
        std::process::Command::new("xdg-open").arg(url).spawn()
    };
    result.map(|_| ()).map_err(|e| format!("couldn't open the system browser: {e}"))
}

/// Blocks (off the async runtime, via `spawn_blocking`) until the browser
/// hits the loopback callback, then returns the `token` query param.
async fn await_oauth_callback(listener: std::net::TcpListener) -> Result<String, String> {
    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let (mut stream, _) = listener.accept().map_err(|e| e.to_string())?;
        let mut buf = [0u8; 8192];
        let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
        let req = String::from_utf8_lossy(&buf[..n]);
        let first_line = req.lines().next().unwrap_or("");
        let token = first_line
            .split_whitespace()
            .nth(1)
            .and_then(|path_and_query| path_and_query.split_once('?'))
            .and_then(|(_, query)| {
                query.split('&').find_map(|kv| kv.strip_prefix("token=").map(str::to_string))
            });
        let (status, body) = match &token {
            Some(_) => ("200 OK", "<html><body>Signed in — you can close this tab and return to DH Studio.</body></html>"),
            None => ("400 Bad Request", "<html><body>Sign-in failed — no token in callback.</body></html>"),
        };
        let resp = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len(),
        );
        let _ = stream.write_all(resp.as_bytes());
        token.ok_or_else(|| "sign-in was cancelled or failed".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct OAuthLoginResult {
    pub token: String,
    pub me: MeResult,
}

/// Which OAuth providers `url` has credentials configured for — lets the
/// sign-in form show only the buttons that will actually work.
#[tauri::command]
pub async fn servers_oauth_providers(url: String) -> Result<Vec<String>, String> {
    dh_core::server::client::oauth_providers(&url).await
}

/// Runs a full OAuth round trip against `url` and returns the resulting
/// session token + identity/org list. Does NOT persist anything — call
/// `servers_save_profile` afterward once the caller has picked (or
/// created) which organization this profile should target.
#[tauri::command]
pub async fn servers_oauth_login(url: String, provider: String) -> Result<OAuthLoginResult, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let next = format!("http://127.0.0.1:{port}/callback");
    let start_url = oauth_start_url(&url, &provider, &next);
    open_in_browser(&start_url)?;
    let token = await_oauth_callback(listener).await?;
    let me = ServerClient::new(&url, &token).me().await?;
    Ok(OAuthLoginResult { token, me })
}

/// Look for a still-valid session this app already holds for `url`, from
/// ANY previously saved profile pointed at that same server — a session
/// token isn't org-scoped (see `auth.rs`), so a token minted while joining
/// one org on a server works for every org there. Lets "add another org on
/// a server I've already signed in to" skip the OAuth round trip entirely.
/// Never errors: `None` just means "nothing usable, do a normal sign-in".
#[tauri::command]
pub async fn servers_reuse_session(
    app: tauri::AppHandle,
    url: String,
) -> Result<Option<OAuthLoginResult>, String> {
    let target = dh_core::server::client::normalize_base(&url);
    let all = load_profiles(&profiles_path(&app)?)?;
    for p in all.into_iter().filter(|p| p.url == target) {
        let Ok(token) = load_token(&app, &p.id) else { continue };
        if let Ok(me) = ServerClient::new(&p.url, &token).me().await {
            return Ok(Some(OAuthLoginResult { token, me }));
        }
    }
    Ok(None)
}

/// Create a brand-new organization using a token from a just-completed
/// `servers_oauth_login` that isn't saved as a profile yet (e.g. the user
/// has no orgs and needs to make their first one before there's anything
/// to save).
#[tauri::command]
pub async fn servers_org_create_new(url: String, token: String, name: String) -> Result<Organization, String> {
    ServerClient::new(&url, &token).create_org(&name).await
}

/// Redeem an invite code using a not-yet-saved OAuth token — same
/// reasoning as `servers_org_create_new`.
#[tauri::command]
pub async fn servers_org_redeem_invite_new(
    url: String,
    token: String,
    code: String,
) -> Result<Organization, String> {
    ServerClient::new(&url, &token).redeem_invite(&code).await
}

/// Persist a profile (keychain token + `servers.json` entry) for a server
/// the user has already OAuth-signed-in to and chosen an org on.
#[tauri::command]
pub async fn servers_save_profile(
    app: tauri::AppHandle,
    name: String,
    url: String,
    token: String,
    org_id: String,
) -> Result<ServerProfile, String> {
    let profile = ServerProfile {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.trim().to_string(),
        url: dh_core::server::client::normalize_base(&url),
        org_id,
    };
    let _ = save_token(&app, &profile.id, &token);

    let path = profiles_path(&app)?;
    let mut all = load_profiles(&path)?;
    all.push(profile.clone());
    save_profiles(&path, &all)?;
    Ok(profile)
}

#[tauri::command]
pub fn servers_remove(app: tauri::AppHandle, profile_id: String) -> Result<(), String> {
    profiles::remove_client(&profile_id);
    delete_token(&app, &profile_id);
    let path = profiles_path(&app)?;
    let mut all = load_profiles(&path)?;
    all.retain(|p| p.id != profile_id);
    save_profiles(&path, &all)
}

#[tauri::command]
pub async fn servers_connect(
    app: tauri::AppHandle,
    profile_id: String,
) -> Result<ServerSession, String> {
    let token = load_token(&app, &profile_id)?;
    let profile = find_profile(&app, &profile_id)?;

    let client = ServerClient::new(&profile.url, &token);
    let me = client.me().await?;
    let connections = client.org_connections(&profile.org_id).await?;
    profiles::insert_client(profile_id, client);
    Ok(ServerSession { profile, me, connections })
}

#[tauri::command]
pub fn servers_disconnect(profile_id: String) -> Result<(), String> {
    profiles::remove_client(&profile_id);
    Ok(())
}

// ---- Gateway passthrough ----------------------------------------------------

#[tauri::command]
pub async fn server_list_tables(
    conn_id: String,
) -> Result<Vec<dh_core::api::TableInfo>, String> {
    with_remote(&conn_id, |c, r| Box::pin(async move { c.list_tables(&r).await })).await
}

#[tauri::command]
pub async fn server_list_schemas(conn_id: String) -> Result<Vec<String>, String> {
    with_remote(&conn_id, |c, r| Box::pin(async move { c.list_schemas(&r).await })).await
}

#[tauri::command]
pub async fn server_table_schema(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    table: String,
) -> Result<dh_core::api::TableSchema, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.table_schema(&r, database.as_deref(), schema.as_deref(), &table).await })
    })
    .await
}

#[tauri::command]
pub async fn server_run_sql(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    sql: String,
) -> Result<dh_core::api::QueryResult, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.run_sql(&r, database.as_deref(), schema.as_deref(), &sql).await })
    })
    .await
}

#[tauri::command]
pub async fn server_execute_op(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    op: dh_core::api::QueryOp,
) -> Result<dh_core::api::QueryResult, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.execute_op(&r, database.as_deref(), schema.as_deref(), &op).await })
    })
    .await
}

// ---- MongoDB / generic-catalog surface --------------------------------------
//
// Same `with_remote` passthrough pattern as `server_execute_op` above — these
// exist so a desktop app pointed at a shared team-server connection gets the
// same Mongo features (document grid, console, index manager, collection
// create/drop/rename/duplicate, database switcher) as a local connection.

#[tauri::command]
pub async fn server_list_databases(conn_id: String) -> Result<Vec<String>, String> {
    with_remote(&conn_id, |c, r| Box::pin(async move { c.list_databases(&r).await })).await
}

#[tauri::command]
pub async fn server_catalog_overview(
    conn_id: String,
) -> Result<dh_core::db::CatalogOverview, String> {
    with_remote(&conn_id, |c, r| Box::pin(async move { c.catalog_overview(&r).await })).await
}

#[tauri::command]
pub async fn server_list_schemas_in(
    conn_id: String,
    database: Option<String>,
) -> Result<Vec<String>, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.list_schemas_in(&r, database.as_deref()).await })
    })
    .await
}

#[tauri::command]
pub async fn server_list_schema_objects(
    conn_id: String,
    database: Option<String>,
    schema: String,
    kind: dh_core::db::SchemaObjectKind,
) -> Result<Vec<dh_core::db::SchemaObject>, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.list_schema_objects(&r, database.as_deref(), &schema, kind).await })
    })
    .await
}

#[tauri::command]
pub async fn server_list_roles(conn_id: String) -> Result<Vec<dh_core::db::SchemaObject>, String> {
    with_remote(&conn_id, |c, r| Box::pin(async move { c.list_roles(&r).await })).await
}

#[tauri::command]
pub async fn server_list_role_details(
    conn_id: String,
) -> Result<Vec<dh_core::db::RoleDetail>, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.list_role_details(&r).await })
    })
    .await
}

#[tauri::command]
pub async fn server_active_schema(conn_id: String) -> Result<String, String> {
    with_remote(&conn_id, |c, r| Box::pin(async move { c.active_schema(&r).await })).await
}

#[tauri::command]
pub async fn server_set_active_schema(conn_id: String, schema: String) -> Result<(), String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.set_active_schema(&r, &schema).await })
    })
    .await
}

#[tauri::command]
pub async fn server_disconnect_database(conn_id: String, database: String) -> Result<(), String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.disconnect_database(&r, &database).await })
    })
    .await
}

#[tauri::command]
pub async fn server_apply_schema_ops_batch(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    ops: Vec<dh_core::api::SchemaOp>,
) -> Result<Vec<String>, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.apply_schema_ops_batch(&r, database.as_deref(), schema.as_deref(), &ops).await })
    })
    .await
}

#[tauri::command]
pub async fn server_duplicate_table(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    source: String,
    target: String,
    copy_data: bool,
) -> Result<Vec<String>, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move {
            c.duplicate_table(&r, database.as_deref(), schema.as_deref(), &source, &target, copy_data).await
        })
    })
    .await
}

#[tauri::command]
pub async fn server_list_documents(
    conn_id: String,
    collection: String,
    filter: Option<serde_json::Value>,
    skip: u64,
    limit: u64,
) -> Result<dh_core::api::MongoDocumentsResult, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.list_documents(&r, &collection, filter, skip, limit).await })
    })
    .await
}

#[tauri::command]
pub async fn server_list_documents_ext(
    conn_id: String,
    collection: String,
    filter: Option<serde_json::Value>,
    skip: u64,
    limit: u64,
) -> Result<dh_core::api::MongoExtDocumentsResult, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.list_documents_ext(&r, &collection, filter, skip, limit).await })
    })
    .await
}

#[tauri::command]
pub async fn server_save_document(
    conn_id: String,
    collection: String,
    id: String,
    document_text: String,
) -> Result<bool, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.save_document(&r, &collection, &id, &document_text).await })
    })
    .await
}

#[tauri::command]
pub async fn server_insert_document(
    conn_id: String,
    collection: String,
    document_text: String,
) -> Result<(), String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.insert_document(&r, &collection, &document_text).await })
    })
    .await
}

#[tauri::command]
pub async fn server_run_mongo(
    conn_id: String,
    database: String,
    collection: Option<String>,
    script: String,
) -> Result<dh_core::api::MongoRunResult, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.run_mongo(&r, &database, collection.as_deref(), &script).await })
    })
    .await
}

#[tauri::command]
pub async fn server_create_collection(
    conn_id: String,
    database: Option<String>,
    name: String,
) -> Result<(), String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.create_collection(&r, database.as_deref(), &name).await })
    })
    .await
}

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

// ---- Organizations ------------------------------------------------------

#[tauri::command]
pub async fn servers_org_members(profile_id: String, org_id: String) -> Result<Vec<OrgMember>, String> {
    client_for(&profile_id)?.org_members(&org_id).await
}

#[tauri::command]
pub async fn servers_org_set_member_role(
    profile_id: String,
    org_id: String,
    user_id: String,
    role: OrgRole,
) -> Result<(), String> {
    client_for(&profile_id)?.set_member_role(&org_id, &user_id, role).await
}

#[tauri::command]
pub async fn servers_org_remove_member(
    profile_id: String,
    org_id: String,
    user_id: String,
) -> Result<(), String> {
    client_for(&profile_id)?.remove_member(&org_id, &user_id).await
}

#[tauri::command]
pub async fn servers_org_invites_list(profile_id: String, org_id: String) -> Result<Vec<OrgInvite>, String> {
    client_for(&profile_id)?.list_invites(&org_id).await
}

#[tauri::command]
pub async fn servers_org_invite_create(
    profile_id: String,
    org_id: String,
    role: OrgRole,
    max_uses: Option<i32>,
    expires_ms: Option<i64>,
) -> Result<OrgInvite, String> {
    client_for(&profile_id)?.create_invite(&org_id, role, max_uses, expires_ms).await
}

#[tauri::command]
pub async fn servers_org_invite_revoke(profile_id: String, org_id: String, code: String) -> Result<(), String> {
    client_for(&profile_id)?.revoke_invite(&org_id, &code).await
}

#[tauri::command]
pub async fn servers_org_audit(
    profile_id: String,
    org_id: String,
    limit: i64,
) -> Result<Vec<dh_core::server::store::AuditEntry>, String> {
    client_for(&profile_id)?.org_audit(&org_id, limit).await
}

// ---- Per-connection grant overrides --------------------------------------

#[tauri::command]
pub async fn servers_grants_list(
    profile_id: String,
    org_id: String,
    conn_id: String,
) -> Result<Vec<dh_core::server::grants::Grant>, String> {
    client_for(&profile_id)?.list_grants(&org_id, &conn_id).await
}

#[tauri::command]
pub async fn servers_grant_set(
    profile_id: String,
    org_id: String,
    conn_id: String,
    user_id: String,
    can_read: bool,
    can_update: bool,
    can_delete: bool,
) -> Result<(), String> {
    client_for(&profile_id)?
        .set_grant(&org_id, &conn_id, &user_id, can_read, can_update, can_delete)
        .await
}

#[tauri::command]
pub async fn servers_grant_revoke(
    profile_id: String,
    org_id: String,
    conn_id: String,
    user_id: String,
) -> Result<(), String> {
    client_for(&profile_id)?.revoke_grant(&org_id, &conn_id, &user_id).await
}
