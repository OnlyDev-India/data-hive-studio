use sqlx::PgPool;
use sqlx::postgres::PgConnectOptions;
use std::sync::Arc;
use std::time::Instant;
use crate::db::read_only::ReadOnlyGuard;
use crate::db::{DbError, DbResult};
use super::{PgAdapter, SECONDARY_POOL_IDLE_SECS};
use super::params::{PgParams, build_pool, pg_connect_options};

impl PgAdapter {
    pub async fn connect(params: &PgParams) -> DbResult<Self> {
        // Through an SSH tunnel: connect the driver to a local forwarded
        // port instead of the real host — see `ssh_tunnel`'s module doc for
        // why this needs no special-casing beyond swapping host/port here.
        let tunnel = match &params.ssh {
            Some(ssh) => Some(
                crate::ssh_tunnel::open_tunnel(ssh, &params.host, params.port)
                    .await
                    .map_err(DbError::InvalidOperation)?,
            ),
            None => None,
        };
        let (connect_host, connect_port) = match &tunnel {
            Some(t) => ("127.0.0.1", t.local_port),
            None => (params.host.as_str(), params.port),
        };

        let pool = build_pool(connect_host, connect_port, params, &params.database).await?;
        // The session's real starting schema (search_path-dependent) — NOT
        // always "public". `list_tables`/`active_schema` read this ambient
        // value, so seeding it wrong here silently shows the wrong schema's
        // tables everywhere that calls them (command palette, quick-open,
        // new-table's default schema, …) until `set_active_schema` is
        // called, which today never happens from the UI.
        let initial_schema: String = sqlx::query_scalar("SELECT current_schema()::text")
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|_| "public".to_string());

        Ok(Self {
            pool,
            schema: std::sync::RwLock::new(initial_schema),
            type_cache: std::sync::Mutex::new(std::collections::HashMap::new()),
            database: params.database.clone(),
            params: params.clone(),
            guard: ReadOnlyGuard::new(params.guard.read_only),
            secondary_pools: std::sync::Mutex::new(std::collections::HashMap::new()),
            opening: std::sync::Mutex::new(std::collections::HashMap::new()),
            _ssh_tunnel: tunnel,
        })
    }

    /// The pool to run a schema/catalog query against — `database: None` (or
    /// this connection's own database) is the primary `self.pool`; any other
    /// name is a SIBLING database on the same server, served from a lazily
    /// opened, cached secondary pool (opened once per database, reused after
    /// that, evicted after `SECONDARY_POOL_IDLE_SECS` of disuse). SSH-tunneled
    /// connections reuse the SAME already-open tunnel/local port instead of
    /// opening a second SSH session per sibling database.
    pub(super) async fn pool_for(&self, database: Option<&str>) -> DbResult<PgPool> {
        let target = database.unwrap_or(self.database.as_str());
        if target == self.database {
            return Ok(self.pool.clone());
        }

        self.evict_idle_secondary_pools().await;

        // Fast path: already cached.
        {
            let mut pools = self.secondary_pools.lock().unwrap();
            if let Some(entry) = pools.get_mut(target) {
                entry.1 = Instant::now();
                return Ok(entry.0.clone());
            }
        }

        // Slow path: serialize concurrent first-opens of the same target so
        // two callers expanding the same sibling database at once share one
        // pool instead of racing to open two — locking only THIS target's
        // entry, not every target, so opening several different sibling
        // databases at once still runs in parallel.
        let target_lock = {
            let mut locks = self.opening.lock().unwrap();
            locks
                .entry(target.to_string())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
                .clone()
        };
        let _guard = target_lock.lock().await;
        {
            let mut pools = self.secondary_pools.lock().unwrap();
            if let Some(entry) = pools.get_mut(target) {
                entry.1 = Instant::now();
                return Ok(entry.0.clone());
            }
        }

        let (connect_host, connect_port) = match &self._ssh_tunnel {
            Some(t) => ("127.0.0.1".to_string(), t.local_port),
            None => (self.params.host.clone(), self.params.port),
        };
        let pool = build_pool(&connect_host, connect_port, &self.params, target).await?;
        self.secondary_pools
            .lock()
            .unwrap()
            .insert(target.to_string(), (pool.clone(), Instant::now()));
        Ok(pool)
    }

    async fn evict_idle_secondary_pools(&self) {
        let expired: Vec<PgPool> = {
            let mut pools = self.secondary_pools.lock().unwrap();
            let now = Instant::now();
            let expired_keys: Vec<String> = pools
                .iter()
                .filter(|(_, (_, last))| {
                    now.duration_since(*last).as_secs() > SECONDARY_POOL_IDLE_SECS
                })
                .map(|(k, _)| k.clone())
                .collect();
            expired_keys
                .into_iter()
                .filter_map(|k| pools.remove(&k).map(|(p, _)| p))
                .collect()
        };
        for pool in expired {
            pool.close().await;
        }
    }

    /// The schema unqualified operations currently target.
    pub(super) fn cur_schema(&self) -> String {
        self.schema.read().unwrap().clone()
    }

    /// Resolves a per-call `database: Option<&str>` to the exact string used
    /// as the `type_cache`/pool-selection key — `pool_for`'s own resolution
    /// (this connection's own database when `None`), exposed so callers that
    /// also need the resolved name (not just the pool) don't duplicate the
    /// `unwrap_or` themselves.
    pub(super) fn resolve_database<'a>(&'a self, database: Option<&'a str>) -> &'a str {
        database.unwrap_or(self.database.as_str())
    }

    /// Connect options for a one off connection to `database` on this
    /// server: the same host/port (the SSH tunnel's local port when there is
    /// one), credentials and TLS settings the pools use. Stop uses it to open
    /// the short lived connection that cancels a run, so the cancel never
    /// waits for a pool slot.
    pub(super) fn connect_options_for(&self, database: &str) -> PgConnectOptions {
        let (host, port) = match &self._ssh_tunnel {
            Some(t) => ("127.0.0.1".to_string(), t.local_port),
            None => (self.params.host.clone(), self.params.port),
        };
        pg_connect_options(&host, port, &self.params, database)
    }

    pub(super) async fn close(self: Arc<Self>) {
        self.pool.close().await;
        // Secondary pools (see `pool_for`) aren't referenced by anything
        // else once this adapter is closing — drain and close every one so
        // they don't leak connections until process exit.
        let secondary: Vec<PgPool> = self
            .secondary_pools
            .lock()
            .unwrap()
            .drain()
            .map(|(_, (pool, _))| pool)
            .collect();
        for pool in secondary {
            pool.close().await;
        }
    }
}
