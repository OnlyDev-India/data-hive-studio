use std::io::Write;
use std::io::Read;
use dh_core::server::client::{
    claim_server, oauth_start_url, parse_oauth_callback, MeResult, OAuthCallback, ServerClient,
};
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
// listener (`http://127.0.0.1:<port>/callback?token=...`, or `ticket=` when
// the server still needs its owner, or `error=` when refused) instead of
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
/// hits the loopback callback, then returns how the sign in ended.
async fn await_oauth_callback(listener: std::net::TcpListener) -> Result<OAuthCallback, String> {
    tokio::task::spawn_blocking(move || -> Result<OAuthCallback, String> {
        let (mut stream, _) = listener.accept().map_err(|e| e.to_string())?;
        let mut buf = [0u8; 8192];
        let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
        let req = String::from_utf8_lossy(&buf[..n]);
        let first_line = req.lines().next().unwrap_or("");
        let outcome = first_line.split_whitespace().nth(1).and_then(parse_oauth_callback);
        let (status, body) = match &outcome {
            Some(OAuthCallback::Token(_)) => (
                "200 OK",
                "<html><body>Signed in — you can close this tab and return to DH Studio.</body></html>",
            ),
            Some(OAuthCallback::Ticket(_)) => (
                "200 OK",
                "<html><body>Almost there — return to DH Studio and enter the setup code from the server log.</body></html>",
            ),
            Some(OAuthCallback::Refused { .. }) => (
                "200 OK",
                "<html><body>This sign-in was not accepted — return to DH Studio to see why.</body></html>",
            ),
            None => ("400 Bad Request", "<html><body>Sign-in failed — nothing usable in the callback.</body></html>"),
        };
        let resp = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len(),
        );
        let _ = stream.write_all(resp.as_bytes());
        outcome.ok_or_else(|| "sign-in was cancelled or failed".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct OAuthLoginResult {
    pub token: String,
    pub me: MeResult,
}

/// How a desktop sign in ended: signed in, needs the server claimed with its
/// setup code, or refused.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OAuthLoginOutcome {
    SignedIn { token: String, me: MeResult },
    Claim { ticket: String },
    Refused { error: String, email: String },
}

/// Which OAuth providers `url` has credentials configured for — lets the
/// sign-in form show only the buttons that will actually work.
#[tauri::command]
pub async fn servers_oauth_providers(url: String) -> Result<Vec<String>, String> {
    dh_core::server::client::oauth_providers(&url).await
}

/// Runs a full OAuth round trip against `url`. Signed in returns the session
/// token + identity/org list; a server with no owner returns a claim ticket
/// for `servers_claim`; a refusal returns its code and the person's email.
/// Does NOT persist anything — call `servers_save_profile` afterward once the
/// caller has picked (or created) which organization this profile should target.
#[tauri::command]
pub async fn servers_oauth_login(url: String, provider: String) -> Result<OAuthLoginOutcome, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let next = format!("http://127.0.0.1:{port}/callback");
    let start_url = oauth_start_url(&url, &provider, &next);
    open_in_browser(&start_url)?;
    match await_oauth_callback(listener).await? {
        OAuthCallback::Token(token) => {
            let me = ServerClient::new(&url, &token).me().await?;
            Ok(OAuthLoginOutcome::SignedIn { token, me })
        }
        OAuthCallback::Ticket(ticket) => Ok(OAuthLoginOutcome::Claim { ticket }),
        OAuthCallback::Refused { error, email } => Ok(OAuthLoginOutcome::Refused { error, email }),
    }
}

/// Claim a server that has no owner: the ticket from `servers_oauth_login`
/// plus the setup code from the server log. The caller becomes the owner and
/// gets a session, the same result as a normal sign in. A refusal comes back
/// as the server's code (`ticket_invalid`, `code_invalid`, `already_claimed`).
#[tauri::command]
pub async fn servers_claim(url: String, ticket: String, code: String) -> Result<OAuthLoginResult, String> {
    let token = claim_server(&url, &ticket, &code).await?;
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
