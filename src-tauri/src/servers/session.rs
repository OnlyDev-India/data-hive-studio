use std::io::Write;
use std::io::Read;
use dh_core::server::auth::pkce_pair;
use dh_core::server::client::{
    claim_server, exchange_code, oauth_start_url, parse_oauth_callback, MeResult, OAuthCallback, SessionReply,
    ERR_SIGNED_OUT,
};
use dh_core::server::profiles;
use serde::Serialize;
use super::ServerSession;
use super::profiles::find_profile;
use super::sessions::{client_for_url, device_params, install_session, signed_in};

/// What a person sees when a newer server or app is needed (a server from
/// before device sessions answers with `token=`). Nothing is stored.
const OLD_SERVER_MESSAGE: &str = "This server needs updating to work with this version of DH Studio";

// ---- OAuth sign-in ------------------------------------------------------
//
// The web build just redirects the browser tab to `/auth/{provider}/start`
// and reads the login code back out of the callback URL — there's already a
// page to redirect TO. Desktop has none of that, so it opens the OS
// browser and catches the callback itself via a short-lived local loopback
// listener (`http://127.0.0.1:<port>/callback?code=...`, or `ticket=` when
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
            Some(OAuthCallback::Code(_)) => (
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
            Some(OAuthCallback::OldServer) => (
                "200 OK",
                "<html><body>This server needs updating to work with this version of DH Studio.</body></html>",
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

/// The person's identity after a sign in. The session itself stays in Rust:
/// the JavaScript side never holds a token.
#[derive(Serialize)]
pub struct OAuthLoginResult {
    pub me: MeResult,
}

/// How a desktop sign in ended: signed in, needs the server claimed with its
/// setup code, or refused.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OAuthLoginOutcome {
    SignedIn { me: MeResult },
    Claim { ticket: String },
    Refused { error: String, email: String },
}

/// Which OAuth providers `url` has credentials configured for — lets the
/// sign-in form show only the buttons that will actually work.
#[tauri::command]
pub async fn servers_oauth_providers(url: String) -> Result<Vec<String>, String> {
    dh_core::server::client::oauth_providers(&url).await
}

/// Start using a session a sign in just made, and say who it is.
async fn sign_in_with(app: &tauri::AppHandle, url: &str, reply: &SessionReply) -> Result<MeResult, String> {
    install_session(app, url, reply)?.me().await
}

/// Runs a full OAuth round trip against `url`. Signed in returns the identity
/// and org list; a server with no owner returns a claim ticket for
/// `servers_claim`; a refusal returns its code and the person's email. The
/// session is kept in Rust under the server's address and its renewal token
/// saved at once. Does NOT save a profile: call `servers_save_profile`
/// afterward once the caller has picked (or created) which organization this
/// profile should target.
#[tauri::command]
pub async fn servers_oauth_login(
    app: tauri::AppHandle,
    url: String,
    provider: String,
) -> Result<OAuthLoginOutcome, String> {
    // The verifier is a secret only this app knows. The server sees its hash
    // now and the verifier itself only when the login code is traded, so a
    // code copied out of the loopback request is useless.
    let (verifier, challenge) = pkce_pair();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let next = format!("http://127.0.0.1:{port}/callback");
    open_in_browser(&oauth_start_url(&url, &provider, &next, &challenge))?;
    match await_oauth_callback(listener).await? {
        OAuthCallback::Code(code) => {
            let reply = exchange_code(&url, &code, &verifier, &device_params(&app)?).await?;
            Ok(OAuthLoginOutcome::SignedIn { me: sign_in_with(&app, &url, &reply).await? })
        }
        OAuthCallback::Ticket(ticket) => Ok(OAuthLoginOutcome::Claim { ticket }),
        OAuthCallback::Refused { error, email } => Ok(OAuthLoginOutcome::Refused { error, email }),
        OAuthCallback::OldServer => Err(OLD_SERVER_MESSAGE.to_string()),
    }
}

/// Claim a server that has no owner: the ticket from `servers_oauth_login`
/// plus the setup code from the server log. The caller becomes the owner and
/// is signed in, the same result as a normal sign in. A refusal comes back
/// as the server's code (`ticket_invalid`, `code_invalid`, `already_claimed`).
#[tauri::command]
pub async fn servers_claim(
    app: tauri::AppHandle,
    url: String,
    ticket: String,
    code: String,
) -> Result<OAuthLoginResult, String> {
    let reply = claim_server(&url, &ticket, &code, &device_params(&app)?).await?;
    Ok(OAuthLoginResult { me: sign_in_with(&app, &url, &reply).await? })
}

/// Look for a still-usable session this app already holds for `url` (one per
/// server, shared by every saved profile pointed at it). Lets "add another org
/// on a server I've already signed in to" skip the OAuth round trip entirely.
/// Never errors: `None` just means "nothing usable, do a normal sign-in".
#[tauri::command]
pub async fn servers_reuse_session(app: tauri::AppHandle, url: String) -> Result<Option<OAuthLoginResult>, String> {
    if !signed_in(&app, &url) {
        return Ok(None);
    }
    Ok(client_for_url(&app, &url).me().await.ok().map(|me| OAuthLoginResult { me }))
}

/// Connect a saved profile. A server the app is signed out of answers
/// `signed_out` (the profile, its org and everything open stay), and the
/// caller offers Sign in again.
#[tauri::command]
pub async fn servers_connect(app: tauri::AppHandle, profile_id: String) -> Result<ServerSession, String> {
    let profile = find_profile(&app, &profile_id)?;
    let client = client_for_url(&app, &profile.url);
    if !client.session().signed_in() {
        return Err(ERR_SIGNED_OUT.to_string());
    }
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
