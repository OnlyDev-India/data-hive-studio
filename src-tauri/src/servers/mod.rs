//! Saved team-server profiles and gateway passthrough — the Tauri-specific
//! shell around `dh_core::server::profiles`: this file resolves WHERE the
//! profiles file and tokens live (`AppHandle::path()`), does the actual
//! token storage (OS keychain via `keyring`, or a dev-mode file — `dh-core`
//! has no keychain dependency since `dh-server` has no keychain to talk
//! to), and — new in the OAuth/org model — runs the desktop sign-in flow
//! (open the system browser, catch the callback on a local loopback
//! listener). Everything else forwards straight through, mirroring
//! `commands.rs`'s thin-forwarding pattern for the desktop DB commands.

mod profiles;
mod tokens;
mod session;
mod proxy;
mod connections;
mod orgs;

pub use profiles::*;
pub use session::*;
pub use proxy::*;
pub use connections::*;
pub use orgs::*;

use dh_core::server::client::MeResult;
use dh_core::server::profiles::ServerProfile;
use serde::Serialize;

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
