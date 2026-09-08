//! Server-side core for dh-studio: OAuth identity + sessions, organizations
//! (membership/roles/invites), the encrypted connection vault, per-connection
//! grant overrides, and the query gateway. Shared by `dh-server` and tests.

pub mod auth;
pub mod crypto;
pub mod gateway;
pub mod grants;
pub mod orgs;
pub mod client;
pub mod profiles;
pub mod router;
pub mod store;
pub mod vault;

pub use auth::AuthCtx;
pub use gateway::Gateway;
pub use grants::{DataAccess, Grant};
pub use orgs::{OrgRole, Organization};
pub use vault::{ConnInput, ConnMeta};
