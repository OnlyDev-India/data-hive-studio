//! The dh-studio bare proxy (spec 0010). It knows nothing about people: the
//! web page hands it database details, it opens a pool and returns a handle,
//! and every data route works from that handle. It holds no persistent state.

pub mod bodies;
pub mod config;
pub mod connect;
pub mod guard;
pub mod registry;
pub mod routes;
