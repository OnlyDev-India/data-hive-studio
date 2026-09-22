//! Saved team-server profiles and gateway passthrough — the Tauri-specific
//! shell around `dh_server_client::profiles`: this file resolves WHERE the
//! profiles file and tokens live (`AppHandle::path()`), does the actual
//! renewal-token storage (OS keychain via `keyring`, or a dev-mode file —
//! `dh-core` has no keychain dependency since `dh-server` has no keychain to
//! talk to), and — new in the OAuth/org model — runs the desktop sign-in flow
//! (open the system browser, catch the callback on a local loopback
//! listener). Everything else forwards straight through, mirroring
//! `commands.rs`'s thin-forwarding pattern for the desktop DB commands.

mod profiles;
mod tokens;
mod sessions;
mod session;
mod devices;
mod proxy;
mod connections;
mod orgs;
mod access;

pub use profiles::*;
pub use session::*;
pub use devices::*;
pub use proxy::*;
pub use connections::*;
pub use orgs::*;
pub use access::*;

use dh_server_client::client::MeResult;
use dh_server_client::profiles::ServerProfile;
use serde::Serialize;

#[cfg(not(debug_assertions))]
const KEYRING_SERVICE: &str = "dh-studio-server";

#[derive(Serialize)]
pub struct ServerProfileView {
    pub id: String,
    pub name: String,
    pub url: String,
    pub org_id: String,
    pub connected: bool,
    /// False when the app holds no session for this server (a renewal was
    /// refused, or the person signed out): the menu offers Sign in again.
    pub signed_in: bool,
}

#[derive(Serialize)]
pub struct ServerSession {
    pub profile: ServerProfile,
    pub me: MeResult,
    pub connections: Vec<dh_server_client::gateway::ConnWithAccess>,
}
