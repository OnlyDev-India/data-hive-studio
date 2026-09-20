use std::io::Write;
use std::io::Read;
use dh_core::server::client::{oauth_start_url, MeResult, ServerClient};
use dh_core::server::profiles;
use dh_core::server::profiles::load_profiles;
use serde::Serialize;
use super::ServerSession;
use super::profiles::{find_profile, profiles_path};
use super::tokens::load_token;

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
