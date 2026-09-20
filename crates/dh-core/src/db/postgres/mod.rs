//! PostgreSQL adapter (Phase 2 of `plan.md`): connects over TCP, serves the
//! same [`DbAdapter`] surface as SQLite, and translates the engine-agnostic
//! operation types into Postgres dialect (`$n` placeholders, `information_schema`
//! introspection). Storage-only concepts (WAL, byte export) fall back to the
//! trait's unsupported defaults.

mod params;
mod connect;
mod sql_text;
mod filters;
mod rows;
mod cancel;
mod exec;
mod catalog;
mod objects;
mod query;
mod edit;
mod ddl;
mod adapter;

pub use params::PgParams;

use sqlx::PgPool;
use std::sync::Arc;
use std::time::Instant;
use super::read_only::ReadOnlyGuard;
use super::{CatalogOverview, OpOutcome, inline_placeholders, sql_literal};
#[cfg(test)]
use super::{READ_ONLY_PREFIX, runs};

/// How long an unused secondary pool (see `PgAdapter::pool_for`) stays warm
/// before being closed — matches the team-server gateway's own per-connection
/// idle-eviction convention (`server::gateway::IDLE_TIMEOUT`).
const SECONDARY_POOL_IDLE_SECS: u64 = 15 * 60;

pub struct PgAdapter {
    /// One shared pool for everything (queries + catalog reads). sqlx pools
    /// are internally concurrent and Send+Sync, so queries never serialize.
    pool: PgPool,
    /// Schema every unqualified operation targets ("public" until switched).
    /// Data ops qualify explicitly (safe under PgBouncer transaction pooling,
    /// where session `search_path` is not preserved); the DDL batch uses a
    /// transaction-local search_path instead.
    schema: std::sync::RwLock<String>,
    /// Cached column name -> type maps per (database, schema, table). Writes
    /// used to pay an information_schema round trip on EVERY insert/update/
    /// delete; now only the first write to a table (or after DDL) does.
    /// Cleared by apply_schema_ops_batch so column changes are never stale.
    /// Keyed by database too — a sibling database queried via `pool_for`
    /// can have a same-named table/schema with unrelated column types.
    type_cache: std::sync::Mutex<
        std::collections::HashMap<
            (String, String, String),
            std::collections::HashMap<String, String>,
        >,
    >,
    /// Database name this connection attached to — used to refuse dropping
    /// it from underneath itself.
    database: String,
    /// The params this adapter was originally opened with — kept so a
    /// secondary pool for a sibling database (see `pool_for`) can be built
    /// later with the same user/password/ssl/pool settings. Already resident
    /// in memory for the duration of the original `connect` call; this just
    /// extends that to the adapter's lifetime, same exposure `ssl_client_key_file`
    /// etc. already have.
    params: PgParams,
    /// Refuses writes on a read only connection (spec 0007). Fixed for the
    /// life of the adapter.
    guard: ReadOnlyGuard,
    /// One extra pool per sibling database the sidebar's catalog tree has
    /// expanded, opened lazily on first expand and kept warm — this is what
    /// lets a Postgres connection browse another database inline (a single
    /// Postgres wire connection can't otherwise reach a database other than
    /// the one it dialed). Keyed by database name.
    secondary_pools: std::sync::Mutex<std::collections::HashMap<String, (PgPool, Instant)>>,
    /// Serializes concurrent first-opens of the SAME secondary database (two
    /// callers expanding the same sibling database at once should share one
    /// new pool, not race to open two) — keyed per target so opening several
    /// DIFFERENT sibling databases at once (the command palette's
    /// cross-database search fans out one call per schema across every
    /// sibling database) actually happens in parallel instead of queueing
    /// behind a single global lock. Each per-target lock is only ever held
    /// for the duration of opening that one pool, never a real query.
    opening: std::sync::Mutex<std::collections::HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// Kept alive for as long as this adapter is — dropping it tears the
    /// tunnel down out from under the pool, so it must outlive `pool`.
    /// `None` when this connection doesn't go through SSH.
    _ssh_tunnel: Option<crate::ssh_tunnel::LocalTunnel>,
}
