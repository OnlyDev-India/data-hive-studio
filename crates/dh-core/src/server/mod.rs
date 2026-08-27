//! Server-side core for dh-studio: encrypted connection vault, grants,
//! device identity, and the query gateway. Shared by `dh-server` and tests.

pub mod crypto;
pub mod gateway;
pub mod grants;
pub mod identity;
pub mod client;
pub mod router;
pub mod store;
pub mod vault;

pub use gateway::Gateway;
pub use grants::{DataAccess, Grant};
pub use identity::AuthCtx;
pub use vault::{ConnInput, ConnMeta};
