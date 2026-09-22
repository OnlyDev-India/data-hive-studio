//! The dh-studio team server library: the Axum router, the connection
//! gateway's execution engine, and the Postgres backed store. `main.rs` is a
//! thin binary that only wires configuration and calls into this crate (see
//! spec 0012).

pub mod auth;
pub mod gateway;
pub mod grants;
pub mod orgs;
pub mod router;
pub mod store;
pub mod vault;
