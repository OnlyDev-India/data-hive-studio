//! PostgreSQL adapter (Phase 2 of `plan.md`): connects over TCP, serves the
//! same [`DbAdapter`] surface as SQLite, and translates the engine-agnostic
//! operation types into Postgres dialect (`$n` placeholders, `information_schema`
//! introspection). Storage-only concepts (WAL, byte export) fall back to the
//! trait's unsupported defaults.

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use futures_util::TryStreamExt;
use sqlx::postgres::PgRow;
use sqlx::{Column as _, Connection as _, Executor as _, Row as _, Statement as _, TypeInfo as _};
use sqlx::pool::PoolConnection;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{PgConnection, PgPool, Postgres};
use std::sync::Arc;
use std::time::Instant;

use crate::api::{
    ConnGuard, FilterOp, QueryChunk, QueryOp, QueryResult, SchemaOp, TableInfo, TableSchema,
    ColumnInfo, IndexInfo, TriggerInfo,
};
use super::{
    read_only::{Dialect, ReadOnlyGuard}, runs::Canceller, BatchSink, DbAdapter, DbError, DbResult, RoleDetail,
    RunHandle, SchemaObject, SchemaObjectKind,
};

/// Parameters for connecting to a PostgreSQL server.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PgParams {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    /// disable | prefer | require | verify-ca | verify-full (defaults to prefer).
    #[serde(default)]
    pub ssl_mode: Option<String>,
    /// Path to a CA certificate file used to verify the server's
    /// certificate — required for `ssl_mode` "verify-ca"/"verify-full" to
    /// actually verify anything (otherwise there's nothing to check
    /// against). Read from disk wherever the connection is made: the
    /// desktop app's own filesystem for a local connection, or the
    /// team-server's filesystem for a shared one.
    #[serde(default)]
    pub ssl_ca_file: Option<String>,
    /// Path to a client certificate file, for mutual TLS (mTLS). Paired
    /// with `ssl_client_key_file`.
    #[serde(default)]
    pub ssl_client_cert_file: Option<String>,
    /// Path to the client certificate's private key file (unencrypted —
    /// this app doesn't support an encrypted client key's passphrase).
    #[serde(default)]
    pub ssl_client_key_file: Option<String>,
    /// Reach the database through an SSH tunnel (a local port-forward to
    /// `host:port` through this jump host) instead of connecting directly.
    #[serde(default)]
    pub ssh: Option<crate::ssh_tunnel::SshConfig>,
    /// Max pool connections (default 12 when unset).
    #[serde(default)]
    pub pool_max: Option<u32>,
    /// Min pool connections kept open (default 1 when unset).
    #[serde(default)]
    pub pool_min: Option<u32>,
    /// How long to wait for a pooled connection — including opening a new
    /// one if the pool isn't full — before giving up (default 30s when
    /// unset). sqlx has no separate raw-socket connect timeout; this is the
    /// closest real equivalent.
    #[serde(default)]
    pub connect_timeout_secs: Option<u32>,
    /// How long a connection can sit idle in the pool before being closed
    /// (default 15 minutes when unset).
    #[serde(default)]
    pub idle_timeout_secs: Option<u32>,
    /// Max lifetime of a pooled connection regardless of activity, after
    /// which it's closed and replaced (sqlx's own default — currently 30
    /// minutes — applies when unset).
    #[serde(default)]
    pub max_lifetime_secs: Option<u32>,
    /// Read only flag and environment label (spec 0007). The adapter reads
    /// only `read_only`; the rest passes through to `ConnectionInfo`.
    #[serde(flatten)]
    pub guard: ConnGuard,
}

fn ssl_mode(v: Option<&str>) -> sqlx::postgres::PgSslMode {
    use sqlx::postgres::PgSslMode::*;
    match v.unwrap_or("prefer").to_lowercase().as_str() {
        "disable" => Disable,
        "require" => Require,
        "verify-ca" => VerifyCa,
        "verify-full" => VerifyFull,
        _ => Prefer,
    }
}

fn default_port() -> u16 {
    5432
}

/// Quote an identifier the Postgres way (double quotes).
fn q(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Schema-qualified reference: `"schema"."name"`. Free function (not an
/// inherent `PgAdapter` method) — `schema` is always an already-resolved
/// per-call target now (see each trait method's own resolution), never read
/// off `self.cur_schema()` implicitly, so a sibling-database/schema caller
/// can't accidentally qualify against the primary connection's active one.
fn tq(schema: &str, name: &str) -> String {
    format!("{}.{}", q(schema), q(name))
}

/// Qualified object reference for `$n::regclass` parameters: `"schema"."name"`.
/// NO surrounding single quotes — this value is always BOUND as a parameter
/// (the server applies its own quoting); embedding quotes would make
/// regclass input fail with "invalid name syntax". Named `qualify_regclass`
/// (not `regclass`) so it doesn't collide with the many local variables
/// named `regclass` that hold ITS result.
fn qualify_regclass(schema: &str, name: &str) -> String {
    format!("{}.{}", q(schema), q(name))
}

/// Convert SQLite-style `?` placeholders to Postgres `$1..$n`. Occurrences
/// inside single-quoted literals are left alone.
fn dollar_placeholders(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    let mut n = 0;
    let mut in_str = false;
    for ch in sql.chars() {
        match ch {
            '\'' => {
                in_str = !in_str;
                out.push(ch);
            }
            '?' if !in_str => {
                n += 1;
                out.push('$');
                out.push_str(&n.to_string());
            }
            _ => out.push(ch),
        }
    }
    out
}

/// The part of `PgAdapter::connect` that builds the actual pool, factored out
/// so a secondary pool to a SIBLING database on the same server (see
/// `PgAdapter::pool_for`) can share it instead of duplicating the
/// options/pool-settings wiring.
fn pg_connect_options(
    connect_host: &str,
    connect_port: u16,
    params: &PgParams,
    database: &str,
) -> PgConnectOptions {
    let mut options = PgConnectOptions::new()
        // PgBouncer (transaction mode) compatibility: sqlx caches named
        // prepared statements per connection; pooled proxies break that.
        .statement_cache_capacity(0)
        .host(connect_host)
        .port(connect_port)
        .username(&params.user)
        .password(&params.password)
        .database(database)
        .ssl_mode(ssl_mode(params.ssl_mode.as_deref()));
    if let Some(ca) = &params.ssl_ca_file {
        options = options.ssl_root_cert(ca);
    }
    if let Some(cert) = &params.ssl_client_cert_file {
        options = options.ssl_client_cert(cert);
    }
    if let Some(key) = &params.ssl_client_key_file {
        options = options.ssl_client_key(key);
    }
    // Read only lock (spec 0007): every pooled session, secondary pools and
    // the short lived Stop connection included, opens with new transactions
    // read only. The SQL check refuses the statements that could switch it
    // back off; this refuses the writes the check cannot see (a data changing
    // CTE, a writing function). Only set when asked, so a normal connection's
    // startup is unchanged.
    if params.guard.read_only {
        options = options.options([("default_transaction_read_only", "on")]);
    }
    options
}

async fn build_pool(
    connect_host: &str,
    connect_port: u16,
    params: &PgParams,
    database: &str,
) -> DbResult<PgPool> {
    let options = pg_connect_options(connect_host, connect_port, params, database);

    // ONE pool, ONE awaited connection: `connect_with` returns as soon as
    // the database answers — same as every other SQL client. Extra
    // connections are opened lazily by sqlx when queries need them (each
    // one gets its own forwarded SSH channel automatically, since the
    // tunnel's local listener accepts however many connections the pool
    // opens over its lifetime).
    let mut pool_opts = PgPoolOptions::new()
        .max_connections(params.pool_max.unwrap_or(12))
        .min_connections(params.pool_min.unwrap_or(1))
        .acquire_timeout(std::time::Duration::from_secs(
            params.connect_timeout_secs.unwrap_or(30) as u64,
        ))
        .idle_timeout(std::time::Duration::from_secs(
            params.idle_timeout_secs.unwrap_or(15 * 60) as u64,
        ));
    if let Some(secs) = params.max_lifetime_secs {
        pool_opts = pool_opts.max_lifetime(std::time::Duration::from_secs(secs as u64));
    }
    pool_opts
        .connect_with(options)
        .await
        .map_err(DbError::SqlEngine)
}

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
    async fn pool_for(&self, database: Option<&str>) -> DbResult<PgPool> {
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

    /// Column name -> type map for a table in `database`/`schema`, served
    /// from the cache when possible. The map feeds write ops (INSERT casts,
    /// UPDATE/DELETE NULL matching) and would otherwise cost one
    /// information_schema round trip per operation. `pool`/`schema` are the
    /// already-resolved target (see each trait method's own resolution at
    /// its top) — this never reads `self.pool`/`self.cur_schema()` itself,
    /// so a sibling-database caller can't accidentally hit the primary.
    async fn column_types_for(
        &self,
        pool: &PgPool,
        database: &str,
        schema: &str,
        table: &str,
    ) -> DbResult<std::collections::HashMap<String, String>> {
        let key = (database.to_string(), schema.to_string(), table.to_string());
        if let Some(hit) = self.type_cache.lock().unwrap().get(&key) {
            return Ok(hit.clone());
        }
        let mut conn = pool.acquire().await.map_err(DbError::SqlEngine)?;
        let types = column_types(&mut conn, schema, table).await?;
        drop(conn);
        self.type_cache
            .lock()
            .unwrap()
            .insert(key, types.clone());
        Ok(types)
    }

    /// The schema unqualified operations currently target.
    fn cur_schema(&self) -> String {
        self.schema.read().unwrap().clone()
    }

    /// Resolves a per-call `database: Option<&str>` to the exact string used
    /// as the `type_cache`/pool-selection key — `pool_for`'s own resolution
    /// (this connection's own database when `None`), exposed so callers that
    /// also need the resolved name (not just the pool) don't duplicate the
    /// `unwrap_or` themselves.
    fn resolve_database<'a>(&'a self, database: Option<&'a str>) -> &'a str {
        database.unwrap_or(self.database.as_str())
    }

    /// Connect options for a one off connection to `database` on this
    /// server: the same host/port (the SSH tunnel's local port when there is
    /// one), credentials and TLS settings the pools use. Stop uses it to open
    /// the short lived connection that cancels a run, so the cancel never
    /// waits for a pool slot.
    fn connect_options_for(&self, database: &str) -> PgConnectOptions {
        let (host, port) = match &self._ssh_tunnel {
            Some(t) => ("127.0.0.1".to_string(), t.local_port),
            None => (self.params.host.clone(), self.params.port),
        };
        pg_connect_options(&host, port, &self.params, database)
    }

    /// `run_sql` past the read only check. The session itself is also read
    /// only on a read only connection, so a write the check let through (a
    /// data changing CTE) fails here and the caller turns it into the typed
    /// refusal.
    async fn run_sql_locked(&self, database: Option<&str>, schema: Option<&str>, sql: &str) -> DbResult<QueryResult> {
        let pool = self.pool_for(database).await?;
        let start = Instant::now();
        let converted = dollar_placeholders(sql);
        let trimmed = converted.trim();
        let first_word = trimmed
            .split(|c: char| c == ' ' || c == '\n' || c == '\t')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        let is_select = first_word == "select" || first_word == "with";

        // A target schema (the SQL editor's own picker) resolves every
        // unqualified name in `sql` through a TRANSACTION-LOCAL search_path
        // — same mechanism/reasoning as `apply_schema_ops_batch`: SET LOCAL
        // dies with the transaction, so pooled connections stay clean
        // (PgBouncer-safe) whether this commits or errors out.
        if let Some(schema) = schema {
            let mut conn = pool.acquire().await.map_err(DbError::SqlEngine)?;
            let mut tx = conn.begin().await.map_err(DbError::SqlEngine)?;
            sqlx::query(&format!("SET LOCAL search_path = {}", q(schema)))
                .execute(&mut *tx)
                .await
                .map_err(DbError::SqlEngine)?;
            let result = if is_select {
                let columns = describe_columns_conn(&mut tx, trimmed).await?;
                let rows = sqlx::query(trimmed).fetch_all(&mut *tx).await.map_err(DbError::SqlEngine)?;
                let out: Vec<Vec<Option<String>>> = rows.iter().map(row_to_vec).collect();
                QueryResult {
                    columns,
                    rows: out,
                    rows_affected: 0,
                    is_select: true,
                    error: null_error(),
                    elapsed_ms: start.elapsed().as_millis(),
                    cancelled: false,
                }
            } else {
                let res = sqlx::query(trimmed).execute(&mut *tx).await.map_err(DbError::SqlEngine)?;
                QueryResult {
                    columns: vec![],
                    rows: vec![],
                    rows_affected: res.rows_affected(),
                    is_select: false,
                    error: null_error(),
                    elapsed_ms: start.elapsed().as_millis(),
                    cancelled: false,
                }
            };
            tx.commit().await.map_err(DbError::SqlEngine)?;
            return Ok(result);
        }

        if is_select {
            let columns = describe_columns(&pool, trimmed).await?;
            let rows = sqlx::query(trimmed).fetch_all(&pool).await.map_err(DbError::SqlEngine)?;
            // Reuse row_to_vec so every type (dates, timestamps, arrays,
            // booleans, numerics, …) renders as human-readable text.
            let out: Vec<Vec<Option<String>>> = rows.iter().map(row_to_vec).collect();
            return Ok(QueryResult {
                columns,
                rows: out,
                rows_affected: 0,
                is_select: true,
                error: null_error(),
                elapsed_ms: start.elapsed().as_millis(),
                cancelled: false,
            });
        }
        let res = sqlx::query(trimmed).execute(&pool).await.map_err(DbError::SqlEngine)?;
        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            rows_affected: res.rows_affected(),
            is_select: false,
            error: null_error(),
            elapsed_ms: start.elapsed().as_millis(),
            cancelled: false,
        })
    }

    /// The editor's Run for a stoppable run (spec 0006). Takes a dedicated
    /// pooled connection for the whole run so there is a backend to cancel,
    /// records that backend's pid, and lets Stop reach it through a separate
    /// short lived connection running `pg_cancel_backend`.
    async fn run_sql_cancellable(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        sql: &str,
        run: &RunHandle,
    ) -> DbResult<QueryResult> {
        let pool = self.pool_for(database).await?;
        let start = Instant::now();
        let converted = dollar_placeholders(sql);
        let trimmed = converted.trim();
        let is_select = is_select_statement(trimmed);

        let mut conn = RunConn::acquire(&pool).await?;
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *conn)
            .await
            .map_err(DbError::SqlEngine)?;
        let cancel_options = self.connect_options_for(self.resolve_database(database));
        let armed = run.set_canceller(pg_canceller(cancel_options, pid)).await;

        let ran = if !armed {
            // Stop already arrived: never start the statement.
            Err(DbError::Cancelled)
        } else if let Some(schema) = schema {
            // Same transaction local search_path as `run_sql`'s schema path.
            run_in_schema_tx(&mut conn, schema, trimmed, is_select, start, run).await
        } else {
            exec_statement(&mut conn, trimmed, is_select, start, run).await
        };

        // Unregister BEFORE the connection returns to the pool, so a late
        // cancel can never hit a later query that reused this backend.
        run.finish().await;
        conn.release(conn_reusable(&ran));
        ran
    }

    /// WHERE fragment + params for one filter condition ($n placeholders are
    /// renumbered later by [`dollar_placeholders`], so emit plain `?` here).
    /// One filter condition: SQL fragment with a `?` placeholder plus the
    /// bound value. Values are ALWAYS parameter-bound — interpolating them
    /// breaks on uuid/numeric parsing and invites injection.
    fn filter_sql(cond: &crate::api::GridFilterCond, params: &mut Vec<Option<String>>) -> String {
        let col = q(&cond.column);
        let v = cond.value.clone();
        let mut like = |pat: String| {
            params.push(Some(format!("%{pat}%")));
            format!("{col} ILIKE ?")
        };
        match cond.op {
            FilterOp::Eq => {
                params.push(Some(v));
                format!("{col} = ?")
            }
            FilterOp::Neq => {
                params.push(Some(v));
                format!("{col} <> ?")
            }
            FilterOp::Contains => like(v),
            FilterOp::StartsWith => {
                params.push(Some(format!("{v}%")));
                format!("{col} ILIKE ?")
            }
            FilterOp::EndsWith => {
                params.push(Some(format!("%{v}")));
                format!("{col} ILIKE ?")
            }
            FilterOp::Gt => {
                params.push(Some(v));
                format!("{col} > ?")
            }
            FilterOp::Gte => {
                params.push(Some(v));
                format!("{col} >= ?")
            }
            FilterOp::Lt => {
                params.push(Some(v));
                format!("{col} < ?")
            }
            FilterOp::Lte => {
                params.push(Some(v));
                format!("{col} <= ?")
            }
            FilterOp::IsNull => format!("{col} IS NULL"),
            FilterOp::IsNotNull => format!("{col} IS NOT NULL"),
            FilterOp::In => {
                if cond.values.is_empty() {
                    "1 = 0".to_string()
                } else {
                    let placeholders = vec!["?"; cond.values.len()].join(", ");
                    for v in &cond.values {
                        params.push(Some(v.clone()));
                    }
                    format!("{col} IN ({placeholders})")
                }
            }
        }
    }

    fn where_clause(
        filters: &[crate::api::GridFilterCond],
        custom_where: Option<&String>,
        params: &mut Vec<Option<String>>,
    ) -> String {
        let mut parts: Vec<String> = Vec::new();
        for f in filters {
            parts.push(Self::filter_sql(f, params));
        }
        if let Some(w) = custom_where {
            if !w.trim().is_empty() {
                parts.push(format!("({})", w));
            }
        }
        if parts.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", parts.join(" AND "))
        }
    }
}


/// Build the dialect SELECT for a [`QueryOp::Select`] request.
#[allow(clippy::too_many_arguments)]
fn build_select(
    schema: &str,
    table: &str,
    filters: &[crate::api::GridFilterCond],
    custom_where: Option<&String>,
    order_by: &[crate::api::OrderByCond],
    limit: Option<i64>,
    offset: Option<i64>,
    params: &mut Vec<Option<String>>,
) -> String {
    let where_sql = PgAdapter::where_clause(filters, custom_where, params);
    let order = if order_by.is_empty() {
        String::new()
    } else {
        format!(
            " ORDER BY {}",
            order_by
                .iter()
                .map(|o| {
                    let dir = if o.dir == "DESC" { "DESC" } else { "ASC" };
                    format!("{} {}", q(&o.column), dir)
                })
                .collect::<Vec<_>>()
                .join(", ")
        )
    };
    let lim = limit.map(|l| format!(" LIMIT {l}")).unwrap_or_default();
    let off = offset.map(|o| format!(" OFFSET {o}")).unwrap_or_default();
    format!(
        "SELECT * FROM {}.{}{where_sql}{order}{lim}{off}",
        q(schema),
        q(table)
    )
}

/// Render one row as text cells for every PostgreSQL type we may meet.
fn row_to_vec(r: &PgRow) -> Vec<Option<String>> {
    (0..r.columns().len())
        .map(|i| {
            let ty = r.column(i).type_info().name().to_string();
            match ty.as_str() {
                "INT2" => r.try_get::<Option<i16>, _>(i).ok().flatten().map(|v| v.to_string()),
                "INT4" => r.try_get::<Option<i32>, _>(i).ok().flatten().map(|v| v.to_string()),
                "INT8" => r.try_get::<Option<i64>, _>(i).ok().flatten().map(|v| v.to_string()),
                "FLOAT4" | "FLOAT8" => r.try_get::<Option<f64>, _>(i).ok().flatten().map(|v| v.to_string()),
                "NUMERIC" => r
                    .try_get::<Option<rust_decimal::Decimal>, _>(i)
                    .ok()
                    .flatten()
                    .map(|v| v.to_string()),
                "BOOL" => r.try_get::<Option<bool>, _>(i).ok().flatten().map(|v| v.to_string()),
                "UUID" => r.try_get::<Option<uuid::Uuid>, _>(i).ok().flatten().map(|v| v.to_string()),
                "TIMESTAMPTZ" => r
                    .try_get::<Option<DateTime<Utc>>, _>(i)
                    .ok()
                    .flatten()
                    .map(|v| v.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
                "TIMESTAMP" => r
                    .try_get::<Option<NaiveDateTime>, _>(i)
                    .ok()
                    .flatten()
                    .map(|v| v.to_string()),
                "DATE" => r.try_get::<Option<NaiveDate>, _>(i).ok().flatten().map(|v| v.to_string()),
                "TIME" | "TIMETZ" => r.try_get::<Option<NaiveTime>, _>(i).ok().flatten().map(|v| v.to_string()),
                "JSON" | "JSONB" => r
                    .try_get::<Option<serde_json::Value>, _>(i)
                    .ok()
                    .flatten()
                    .map(|v| v.to_string()),
                "BYTEA" => r
                    .try_get::<Option<Vec<u8>>, _>(i)
                    .ok()
                    .flatten()
                    .map(|b| format!("\\x{}", hex::encode(&b))),
                // ARRAY columns: sqlx names custom enum arrays `permission[]`
                // and built-in arrays `_text`/`_int4`. The binary wire format
                // is NOT readable as UTF-8 directly, so decode it and render a
                // Postgres array literal `{a,b,c}`.
                _ if ty.ends_with("[]") || ty.starts_with('_') => r
                    .try_get_unchecked::<Option<Vec<u8>>, _>(i)
                    .ok()
                    .flatten()
                    .map(|b| {
                        let els: Vec<String> = decode_pg_array(&b)
                            .into_iter()
                            .map(|e| e.unwrap_or_default())
                            .collect();
                        format!("{{{}}}", els.join(","))
                    }),
                // USER-DEFINED (domains, composites, custom enums not in
                // pg_enum, …): try a typed text decode first, then the
                // unchecked variant which reads the raw wire bytes as text.
                _ => r
                    .try_get::<Option<String>, _>(i)
                    .ok()
                    .flatten()
                    .or_else(|| {
                        r.try_get_unchecked::<Option<String>, _>(i)
                            .ok()
                            .flatten()
                    }),
            }
        })
        .collect()
}

/// Element type OIDs for fixed-width PostgreSQL base types. A fixed-width array
/// packs its elements back-to-back with no length word; every other element type
/// (text, varchar, enum, numeric, bytea, …) is varlena and length-prefixed.
fn fixed_typlen(elem_oid: u32) -> Option<usize> {
    let w = match elem_oid {
        16 => 1,    // bool
        18 => 1,    // char
        21 => 2,    // int2
        23 => 4,    // int4
        20 => 8,    // int8
        26 => 4,    // oid
        700 => 4,   // float4
        701 => 8,   // float8
        1082 => 4,  // date
        1114 => 8,  // timestamp
        1184 => 8,  // timestamptz
        1266 => 12, // timetz
        1700 => 0,  // numeric is varlena
        2950 => 16, // uuid
        _ => 0,
    };
    if w == 0 {
        None
    } else {
        Some(w)
    }
}

/// Render one fixed-width array element's raw bytes as human-readable text.
fn decode_fixed_elem(elem_oid: u32, b: &[u8]) -> String {
    let take = |n: usize| -> &[u8] { &b[..b.len().min(n)] };
    match elem_oid {
        16 => match b.first() {
            Some(&0) => "false".into(),
            Some(_) => "true".into(),
            None => String::new(),
        },
        18 | 25 => String::from_utf8_lossy(take(1)).into_owned(), // char
        21 => i16::from_be_bytes([take(2)[0], take(2)[1]]).to_string(),
        23 | 26 => i32::from_be_bytes([take(4)[0], take(4)[1], take(4)[2], take(4)[3]]).to_string(),
        20 => {
            let t = take(8);
            i64::from_be_bytes([t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7]]).to_string()
        }
        700 => {
            let t = take(4);
            f32::from_be_bytes([t[0], t[1], t[2], t[3]]).to_string()
        }
        701 => {
            let t = take(8);
            f64::from_be_bytes([t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7]]).to_string()
        }
        2950 => {
            let h = take(16)
                .iter()
                .map(|x| format!("{x:02x}"))
                .collect::<String>();
            format!(
                "{}-{}-{}-{}-{}",
                &h[..8.min(h.len())],
                &h[8..16.min(h.len())],
                &h[16..20.min(h.len())],
                &h[20..24.min(h.len())],
                &h[24..32.min(h.len())]
            )
        }
        // date/timestamp/timetz: keep lossy text rather than guess timezones.
        _ => String::from_utf8_lossy(b).into_owned(),
    }
}

/// Decode a PostgreSQL binary array (the `array_send` wire format) into its text
/// elements. Mirrors `array_recv`: a fixed-width element type may be flagged
/// `hasnull` (each element then prefixed by an int32 length, -1 = NULL) or
/// packed contiguously; every other type is varlena and always length-prefixed.
fn decode_pg_array(buf: &[u8]) -> Vec<Option<String>> {
    if buf.len() < 12 {
        return vec![];
    }
    let i32at = |o: usize| -> Option<i32> {
        buf.get(o..o + 4)
            .map(|s| i32::from_be_bytes([s[0], s[1], s[2], s[3]]))
    };
    let Some(ndim) = i32at(0) else { return vec![] };
    let hasnull = i32at(4).unwrap_or(0) != 0;
    let elem_oid = i32at(8).unwrap_or(0) as u32;
    let width = fixed_typlen(elem_oid);
    let mut o = 12usize;
    let mut nelems: i64 = 1;
    for _ in 0..ndim {
        let Some(len) = i32at(o) else { return vec![] };
        if len < 0 {
            return vec![];
        }
        nelems = nelems.saturating_mul(len as i64);
        o += 8; // skip the dimension's lower bound
    }
    if ndim <= 0 || nelems <= 0 || nelems > 1_000_000 {
        return vec![];
    }
    let mut out: Vec<Option<String>> = Vec::with_capacity(nelems as usize);
    while out.len() < nelems as usize && o < buf.len() {
        if let Some(w) = width {
            if hasnull {
                let Some(len) = i32at(o) else { break };
                o += 4;
                if len < 0 {
                    out.push(None);
                    continue;
                }
            }
            let end = (o + w).min(buf.len());
            out.push(Some(decode_fixed_elem(elem_oid, &buf[o..end])));
            o = end;
        } else {
            let Some(len) = i32at(o) else { break };
            o += 4;
            if len < 0 {
                out.push(None);
                continue;
            }
            let end = (o + len as usize).min(buf.len());
            out.push(Some(String::from_utf8_lossy(&buf[o..end]).into_owned()));
            o = end;
        }
    }
    out
}

/// Column name -> Postgres type name, used to cast string parameters on
/// INSERT/UPDATE/DELETE so text-bound values coerce cleanly.
async fn column_types(
    conn: &mut sqlx::PgConnection,
    schema: &str,
    table: &str,
) -> DbResult<std::collections::HashMap<String, String>> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT column_name, data_type FROM information_schema.columns \
         WHERE table_schema=$1 AND table_name=$2",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(conn)
    .await
    .map_err(DbError::SqlEngine)?;
    Ok(rows.into_iter().collect())
}


#[async_trait]
impl DbAdapter for PgAdapter {
    async fn list_tables(&self) -> DbResult<Vec<TableInfo>> {
        let schema = self.cur_schema();
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT c.relname, \
             CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' \
                            WHEN 'm' THEN 'matview' ELSE 'other' END \
             FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE c.relkind IN ('r','v','m') AND n.nspname = $1 \
             ORDER BY c.relname",
        )
        .bind(&schema)
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows
            .into_iter()
            .map(|(name, kind)| TableInfo { name, kind })
            .collect())
    }

    async fn table_schema(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        table: &str,
    ) -> DbResult<(TableSchema, Vec<String>)> {
        let pool = self.pool_for(database).await?;
        let schema = schema.map(str::to_string).unwrap_or_else(|| self.cur_schema());
        let regclass = qualify_regclass(&schema, table);
        // Every introspection statement rides back WITH the schema — per-call
        // ownership, so concurrent describes never interleave captures.
        let mut statements: Vec<String> = Vec::new();

        // What kind of object this is — views open read-only in the UI.
        let sql_kind = "SELECT CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' \
                    WHEN 'm' THEN 'matview' ELSE 'other' END \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relname = $2";
        let sql_cols = "SELECT column_name, data_type, is_nullable, COALESCE(column_default, '') \
             FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 \
             ORDER BY ordinal_position";
        let sql_pk = "SELECT a.attname FROM pg_index i \
             JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum = ANY(i.indkey) \
             WHERE i.indrelid = $1::regclass AND i.indisprimary";
        // Native enum columns — including ARRAYS of a native enum (a column of
        // type `permission[]` has atttypid = the `_permission` array type, whose
        // typelem points back at the enum; we resolve through it so the column
        // surfaces the enum's labels and is flagged as an array).
        let sql_enums = "SELECT a.attname, \
                (CASE WHEN pt.typelem <> 0 THEN el.typname ELSE pt.typname END), \
                (pt.typelem <> 0) AS is_array, \
                e.enumlabel \
             FROM pg_attribute a \
             JOIN pg_type pt ON a.atttypid = pt.oid \
             LEFT JOIN pg_type el ON pt.typelem <> 0 AND pt.typelem = el.oid \
             JOIN pg_enum e ON e.enumtypid = \
                  CASE WHEN pt.typelem <> 0 THEN pt.typelem ELSE pt.oid END \
             WHERE a.attrelid = $1::regclass \
             ORDER BY a.attnum, e.enumsortorder";
        let sql_fks = "SELECT kcu.column_name, ccu.table_name, ccu.column_name, \
              tc.constraint_name, \
              CASE con.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' \
                   WHEN 'd' THEN 'SET DEFAULT' WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END, \
              CASE con.confupdtype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' \
                   WHEN 'd' THEN 'SET DEFAULT' WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name \
             JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name \
             JOIN pg_constraint con ON con.conname = tc.constraint_name \
                  AND con.conrelid = to_regclass(format('%I.%I', tc.table_schema, tc.table_name)) \
             WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_name=$1 AND tc.table_schema=$2";
        let sql_idx = "SELECT indexname, indexdef FROM pg_indexes \
             WHERE schemaname=$1 AND tablename=$2";
        let sql_trig = "SELECT t.tgname, pg_get_triggerdef(t.oid) \
             FROM pg_trigger t WHERE t.tgrelid=$1::regclass AND NOT t.tgisinternal ORDER BY t.tgname";

        // Display copies: real values inlined ($1 -> 'public', …) and a
        // trailing semicolon, so the activity log reads like runnable SQL.
        let st = [Some(schema.clone()), Some(table.to_string())];
        let ts = [Some(table.to_string()), Some(schema.clone())];
        let rg = [Some(regclass.clone())];
        statements.extend([
            super::inline_placeholders(sql_kind, &st, true) + ";",
            super::inline_placeholders(sql_cols, &st, true) + ";",
            super::inline_placeholders(sql_pk, &rg, true) + ";",
            super::inline_placeholders(sql_enums, &rg, true) + ";",
            super::inline_placeholders(sql_fks, &ts, true) + ";",
            super::inline_placeholders(sql_idx, &st, true) + ";",
            super::inline_placeholders(sql_trig, &rg, true) + ";",
        ]);

        // The seven lookups are mutually independent (each only needs the
        // qualified name, known upfront) — run them CONCURRENTLY so a remote
        // server costs one round trip of latency instead of seven.
        let f_kind = sqlx::query_scalar::<_, Option<String>>(sql_kind)
            .bind(&schema)
            .bind(table)
            .fetch_optional(&pool);
        let f_cols = sqlx::query_as::<_, (String, String, String, String)>(sql_cols)
            .bind(&schema)
            .bind(table)
            .fetch_all(&pool);
        let f_pk = sqlx::query_as::<_, (String,)>(sql_pk)
            .bind(&regclass)
            .fetch_all(&pool);
        let f_enums = sqlx::query_as::<_, (String, String, bool, String)>(sql_enums)
            .bind(&regclass)
            .fetch_all(&pool);
        let f_fks = sqlx::query_as::<_, (String, String, String, String, String, String)>(sql_fks)
            .bind(table)
            .bind(&schema)
            .fetch_all(&pool);
        let f_idx = sqlx::query_as::<_, (String, String)>(sql_idx)
            .bind(&schema)
            .bind(table)
            .fetch_all(&pool);
        let f_trig = sqlx::query_as::<_, (String, Option<String>)>(sql_trig)
            .bind(&regclass)
            .fetch_all(&pool);

        // Balanced binary join tree — every branch is polled concurrently.
        let (((r_kind, r_cols), (r_pk, r_enums)), ((r_fks, r_idx), r_trig)) =
            futures_util::future::join(
                futures_util::future::join(
                    futures_util::future::join(f_kind, f_cols),
                    futures_util::future::join(f_pk, f_enums),
                ),
                futures_util::future::join(futures_util::future::join(f_fks, f_idx), f_trig),
            )
            .await;

        let object_kind: Option<Option<String>> = r_kind.map_err(DbError::SqlEngine)?;
        let columns: Vec<(String, String, String, String)> = r_cols.map_err(DbError::SqlEngine)?;
        let pk_rows: Vec<(String,)> = r_pk.map_err(DbError::SqlEngine)?;
        let enum_rows: Vec<(String, String, bool, String)> = r_enums.map_err(DbError::SqlEngine)?;
        let fk_rows: Vec<(String, String, String, String, String, String)> = r_fks.map_err(DbError::SqlEngine)?;
        let idx_rows: Vec<(String, String)> = r_idx.map_err(DbError::SqlEngine)?;
        let trig_rows: Vec<(String, Option<String>)> = r_trig.map_err(DbError::SqlEngine)?;

        let pk_set: std::collections::HashSet<String> =
            pk_rows.into_iter().map(|(n,)| n).collect();

        let mut cols: Vec<ColumnInfo> = columns
            .into_iter()
            .map(|(name, data_type, nullable, default)| ColumnInfo {
                name,
                data_type,
                not_null: nullable == "NO",
                primary_key: false,
                default: if default.is_empty() { None } else { Some(default) },
                enum_values: Vec::new(),
                is_array: false,
            })
            .map(|mut c| {
                c.primary_key = pk_set.contains(&c.name);
                c
            })
            .collect();

        // Native enum columns: resolve the UDT name and its labels, then
        // surface them on the column (header shows the type name; editors
        // show the labels as a dropdown).
        let mut enum_labels: std::collections::HashMap<
            String,
            (String, bool, Vec<String>),
        > = std::collections::HashMap::new();
        for (col, typname, is_array, label) in enum_rows {
            let entry = enum_labels
                .entry(col)
                .or_insert_with(|| (typname.clone(), is_array, Vec::new()));
            entry.2.push(label);
        }
        for c in &mut cols {
            if let Some((typname, is_array, labels)) = enum_labels.get(&c.name) {
                c.data_type = if *is_array {
                    format!("{}[]", typname)
                } else {
                    typname.clone()
                };
                c.enum_values = labels.clone();
                c.is_array = *is_array;
            }
        }

        let foreign_keys: Vec<crate::api::ForeignKeyInfo> = fk_rows
            .into_iter()
            .filter(|(_c, rt, _rc, _n, _d, _u)| !rt.is_empty())
            .map(|(column, referenced_table, referenced_column, name, on_delete, on_update)| crate::api::ForeignKeyInfo {
                column,
                referenced_table,
                referenced_column,
                name: (!name.is_empty()).then_some(name),
                on_delete: Some(on_delete),
                on_update: Some(on_update),
            })
            .collect();

        let mut indexes = Vec::new();
        for (name, def) in idx_rows {
            let unique = def.to_uppercase().contains("UNIQUE");
            // Parse "(a, b)" tail of the definition for covered columns.
            let cols_part = def.split('(').nth(1).unwrap_or("").rsplit(')').next().unwrap_or("");
            let columns: Vec<String> = cols_part
                .split(',')
                .map(|c| c.trim().trim_matches('"').to_string())
                .filter(|c| !c.is_empty())
                .collect();
            if columns.is_empty() {
                continue;
            }
            indexes.push(IndexInfo {
                name,
                unique,
                columns,
                origin: "c".into(),
                column_dirs: None,
                sparse: None,
                ttl_seconds: None,
                partial_filter: None,
            });
        }

        let triggers = trig_rows
            .into_iter()
            .filter_map(|(name, sql)| {
                let sql = sql?;
                Some(TriggerInfo {
                    timing: String::new(),
                    event: String::new(),
                    name,
                    sql,
                })
            })
            .collect();

        Ok((
            TableSchema {
                kind: object_kind.flatten().unwrap_or_else(|| "table".to_string()),
                columns: cols,
                foreign_keys,
                indexes,
                triggers,
            },
            statements,
        ))
    }

    async fn list_schemas(&self) -> DbResult<Vec<String>> {
        // User-facing schemas only: pg_* internals and information_schema
        // stay hidden (the SQL console can still reach them by hand).
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT nspname FROM pg_namespace \
             WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' \
             ORDER BY (nspname = 'public') DESC, nspname",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows.into_iter().map(|(n,)| n).collect())
    }

    async fn list_databases(&self) -> DbResult<Vec<String>> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows.into_iter().map(|(n,)| n).collect())
    }

    async fn list_schemas_in(&self, database: Option<&str>) -> DbResult<Vec<String>> {
        let pool = self.pool_for(database).await?;
        // Same query as `list_schemas`, just against a possibly-secondary pool.
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT nspname FROM pg_namespace \
             WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' \
             ORDER BY (nspname = 'public') DESC, nspname",
        )
        .fetch_all(&pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows.into_iter().map(|(n,)| n).collect())
    }

    async fn list_roles(&self) -> DbResult<Vec<SchemaObject>> {
        // Cluster-wide — roles aren't owned by any one database, so this
        // always runs on the primary pool regardless of which database's
        // tree node it's rendered under in the sidebar.
        let rows: Vec<(String, bool, bool)> = sqlx::query_as(
            "SELECT rolname, rolsuper, rolcanlogin FROM pg_roles ORDER BY rolname",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows
            .into_iter()
            .map(|(name, superuser, can_login)| {
                let bits: Vec<&str> = [
                    superuser.then_some("superuser"),
                    can_login.then_some("login"),
                ]
                .into_iter()
                .flatten()
                .collect();
                let extra = (!bits.is_empty()).then(|| bits.join(", "));
                SchemaObject { name, extra }
            })
            .collect())
    }

    async fn list_extensions(&self, database: Option<&str>) -> DbResult<Vec<SchemaObject>> {
        let pool = self.pool_for(database).await?;
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT extname, extversion FROM pg_extension ORDER BY extname",
        )
        .fetch_all(&pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows
            .into_iter()
            .map(|(name, version)| SchemaObject {
                name,
                extra: Some(version),
            })
            .collect())
    }

    async fn list_role_details(&self) -> DbResult<Vec<RoleDetail>> {
        #[allow(clippy::type_complexity)]
        let rows: Vec<(
            String,
            bool,
            bool,
            bool,
            bool,
            bool,
            bool,
            i32,
            Option<String>,
            Option<String>,
            Option<Vec<String>>,
        )> = sqlx::query_as(
            "SELECT r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole, \
                    r.rolcanlogin, r.rolreplication, r.rolbypassrls, r.rolconnlimit, \
                    r.rolvaliduntil::text, \
                    pg_catalog.shobj_description(r.oid, 'pg_authid'), \
                    (SELECT array_agg(m.rolname ORDER BY m.rolname) \
                     FROM pg_auth_members am JOIN pg_roles m ON m.oid = am.roleid \
                     WHERE am.member = r.oid) \
             FROM pg_roles r ORDER BY r.rolname",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows
            .into_iter()
            .map(
                |(
                    name,
                    superuser,
                    createdb,
                    createrole,
                    can_login,
                    replication,
                    bypassrls,
                    conn_limit,
                    valid_until,
                    comment,
                    member_of,
                )| {
                    let attributes: Vec<String> = [
                        superuser.then_some("Superuser"),
                        createdb.then_some("Create DB"),
                        createrole.then_some("Create Role"),
                        can_login.then_some("Login"),
                        replication.then_some("Replication"),
                        bypassrls.then_some("Bypass RLS"),
                    ]
                    .into_iter()
                    .flatten()
                    .map(String::from)
                    .collect();
                    RoleDetail {
                        name,
                        attributes,
                        can_login,
                        superuser,
                        conn_limit,
                        valid_until,
                        comment,
                        member_of: member_of.unwrap_or_default(),
                    }
                },
            )
            .collect())
    }

    async fn disconnect_database(&self, database: &str) -> DbResult<()> {
        if database == self.database {
            return Err(DbError::InvalidOperation(
                "cannot disconnect this connection's own primary database this way — \
                 disconnect the whole connection instead"
                    .into(),
            ));
        }
        // A no-op (Ok, not an error) if nothing was ever opened for it —
        // browsing it just never got that far, nothing to close.
        let pool = self.secondary_pools.lock().unwrap().remove(database).map(|(p, _)| p);
        if let Some(pool) = pool {
            pool.close().await;
        }
        Ok(())
    }

    /// Tables/Views/Materialized Views/Procedures/Functions/Sequences/Types
    /// in one schema — the sidebar catalog tree's per-schema category rows.
    /// `database` targets a sibling database via `pool_for` when set.
    async fn list_schema_objects(
        &self,
        database: Option<&str>,
        schema: &str,
        kind: SchemaObjectKind,
    ) -> DbResult<Vec<SchemaObject>> {
        let pool = self.pool_for(database).await?;
        match kind {
            SchemaObjectKind::Table | SchemaObjectKind::View | SchemaObjectKind::MaterializedView => {
                let relkind = match kind {
                    SchemaObjectKind::Table => "r",
                    SchemaObjectKind::View => "v",
                    SchemaObjectKind::MaterializedView => "m",
                    _ => unreachable!(),
                };
                let rows: Vec<(String,)> = sqlx::query_as(
                    "SELECT c.relname FROM pg_class c \
                     JOIN pg_namespace n ON n.oid = c.relnamespace \
                     WHERE c.relkind = $1 AND n.nspname = $2 \
                     ORDER BY c.relname",
                )
                .bind(relkind)
                .bind(schema)
                .fetch_all(&pool)
                .await
                .map_err(DbError::SqlEngine)?;
                Ok(rows
                    .into_iter()
                    .map(|(name,)| SchemaObject { name, extra: None })
                    .collect())
            }
            SchemaObjectKind::Procedure | SchemaObjectKind::Function => {
                // `prokind`: 'f' = function, 'p' = procedure. Excludes 'c'/
                // 'internal' language routines (built-ins, not user-defined).
                let prokind = if kind == SchemaObjectKind::Procedure {
                    "p"
                } else {
                    "f"
                };
                let rows: Vec<(String, String)> = sqlx::query_as(
                    "SELECT p.proname, \
                            p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' \
                     FROM pg_proc p \
                     JOIN pg_namespace n ON n.oid = p.pronamespace \
                     JOIN pg_language l ON l.oid = p.prolang \
                     WHERE p.prokind = $1 AND n.nspname = $2 \
                       AND l.lanname NOT IN ('c', 'internal') \
                     ORDER BY p.proname LIMIT 500",
                )
                .bind(prokind)
                .bind(schema)
                .fetch_all(&pool)
                .await
                .map_err(DbError::SqlEngine)?;
                Ok(rows
                    .into_iter()
                    .map(|(name, signature)| SchemaObject {
                        name,
                        extra: Some(signature),
                    })
                    .collect())
            }
            SchemaObjectKind::Sequence => {
                let rows: Vec<(String, Option<String>)> = sqlx::query_as(
                    "SELECT sequencename, COALESCE(last_value::text, '-') \
                     FROM pg_sequences WHERE schemaname = $1 ORDER BY sequencename",
                )
                .bind(schema)
                .fetch_all(&pool)
                .await
                .map_err(DbError::SqlEngine)?;
                Ok(rows
                    .into_iter()
                    .map(|(name, last)| SchemaObject { name, extra: last })
                    .collect())
            }
            SchemaObjectKind::Type => {
                // Same shape psql's own `\dT` uses: base/enum/composite/range/
                // domain types actually defined in this schema — excludes
                // array types (typcategory 'A', auto-created alongside every
                // other type) and table row types (typrelid pointing at an
                // ordinary table rather than a standalone composite type).
                // `extra` is what's actually INSIDE the type — an enum's
                // labels, a composite's field list, or a domain's base type
                // — so the sidebar shows more than just a bare name.
                let rows: Vec<(String, Option<String>)> = sqlx::query_as(
                    "SELECT t.typname, \
                            CASE t.typtype \
                                WHEN 'e' THEN ( \
                                    SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) \
                                    FROM pg_enum e WHERE e.enumtypid = t.oid \
                                ) \
                                WHEN 'c' THEN ( \
                                    SELECT string_agg( \
                                        a.attname || ' ' || format_type(a.atttypid, a.atttypmod), \
                                        ', ' ORDER BY a.attnum \
                                    ) \
                                    FROM pg_attribute a \
                                    WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped \
                                ) \
                                WHEN 'd' THEN format_type(t.typbasetype, t.typtypmod) \
                                ELSE NULL \
                            END \
                     FROM pg_type t \
                     JOIN pg_namespace n ON n.oid = t.typnamespace \
                     WHERE n.nspname = $1 AND t.typcategory <> 'A' \
                       AND (t.typrelid = 0 \
                            OR (SELECT c.relkind FROM pg_class c WHERE c.oid = t.typrelid) = 'c') \
                     ORDER BY t.typname",
                )
                .bind(schema)
                .fetch_all(&pool)
                .await
                .map_err(DbError::SqlEngine)?;
                Ok(rows
                    .into_iter()
                    .map(|(name, extra)| SchemaObject { name, extra })
                    .collect())
            }
        }
    }

    /// Schemas + databases + active schema, ONE round trip. The three lists
    /// used to be separate queries; on remote servers (Neon) they serialized
    /// behind the pool and delayed every query that followed.
    async fn catalog_overview(&self) -> DbResult<super::CatalogOverview> {
        let sql = "\
            SELECT COALESCE((\
                SELECT json_agg(nspname ORDER BY nspname) FROM pg_namespace \
                WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'\
            ), '[]'), \
            COALESCE((\
                SELECT json_agg(datname ORDER BY datname) FROM pg_database \
                WHERE datistemplate = false\
            ), '[]'), \
            current_schema()::text";
        let (schemas_v, databases_v, active): (
            serde_json::Value,
            serde_json::Value,
            String,
        ) = sqlx::query_as(sql)
            .fetch_one(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        let to_vec = |v: &serde_json::Value| -> Vec<String> {
            v.as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default()
        };
        Ok(super::CatalogOverview {
            schemas: to_vec(&schemas_v),
            databases: to_vec(&databases_v),
            active_schema: active,
        })
    }

    async fn set_active_schema(&self, schema: &str) -> DbResult<()> {
        let exists: Option<i32> = sqlx::query_scalar(
            "SELECT 1 FROM pg_namespace WHERE nspname = $1",
        )
        .bind(schema)
        .fetch_optional(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        if exists.is_none() {
            return Err(DbError::InvalidOperation(format!(
                "schema \"{schema}\" does not exist on this server"
            )));
        }
        *self.schema.write().unwrap() = schema.to_string();
        Ok(())
    }

    async fn active_schema(&self) -> DbResult<String> {
        Ok(self.cur_schema())
    }

    // Identifier safety: q() doubles embedded quotes, so interpolated names
    // cannot break out of the quoted identifier.
    async fn create_database(&self, name: &str) -> DbResult<()> {
        self.guard.check_write("create database")?;
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::InvalidOperation(
                "database name must not be empty".into(),
            ));
        }
        let sql = format!("CREATE DATABASE {}", q(name));
        sqlx::query(&sql)
            .execute(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        Ok(())
    }

    async fn drop_database(&self, name: &str) -> DbResult<()> {
        self.guard.check_write("drop database")?;
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::InvalidOperation(
                "database name must not be empty".into(),
            ));
        }
        if name == self.database {
            return Err(DbError::InvalidOperation(
                "cannot drop the database this connection is attached to — open a different database first".into(),
            ));
        }
        let sql = format!("DROP DATABASE IF EXISTS {} WITH (FORCE)", q(name));
        sqlx::query(&sql)
            .execute(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        Ok(())
    }

    async fn create_schema(&self, name: &str) -> DbResult<()> {
        self.guard.check_write("create schema")?;
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::InvalidOperation(
                "schema name must not be empty".into(),
            ));
        }
        let sql = format!("CREATE SCHEMA IF NOT EXISTS {}", q(name));
        sqlx::query(&sql)
            .execute(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        Ok(())
    }

    async fn drop_schema(&self, name: &str, cascade: bool) -> DbResult<()> {
        self.guard.check_write("drop schema")?;
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::InvalidOperation(
                "schema name must not be empty".into(),
            ));
        }
        if name.eq_ignore_ascii_case("public") {
            return Err(DbError::InvalidOperation(
                "the default 'public' schema cannot be dropped".into(),
            ));
        }
        let cascade_sql = if cascade { " CASCADE" } else { "" };
        let sql = format!("DROP SCHEMA IF EXISTS {}{cascade_sql}", q(name));
        sqlx::query(&sql)
            .execute(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        // If the user dropped the ACTIVE schema, fall back to public so
        // subsequent unqualified operations keep working.
        if self.cur_schema() == name {
            *self.schema.write().unwrap() = "public".to_string();
        }
        Ok(())
    }

    async fn run_sql(&self, database: Option<&str>, schema: Option<&str>, sql: &str) -> DbResult<QueryResult> {
        self.guard.check_sql(Dialect::Postgres, sql)?;
        self.run_sql_locked(database, schema, sql)
            .await
            .map_err(|e| self.guard.refine(e))
    }

    async fn execute_params(
        &self,
        database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<u64> {
        // Grid built statements only, so the same statement check as the editor
        // names the keyword it refused (UPDATE, INSERT, DELETE).
        self.guard.check_sql(Dialect::Postgres, sql)?;
        let pool = self.pool_for(database).await?;
        let converted = dollar_placeholders(sql);
        // Bind the parameters — frontend-built statements use $1..$n and are
        // useless (and unsafe) if executed with them unresolved.
        let mut q = sqlx::query(&converted);
        for p in params {
            q = bind_str(q, p);
        }
        let res = q.execute(&pool).await.map_err(DbError::SqlEngine)?;
        Ok(res.rows_affected())
    }

    async fn run_sql_params(
        &self,
        database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<QueryResult> {
        self.guard.check_sql(Dialect::Postgres, sql)?;
        let pool = self.pool_for(database).await?;
        let start = Instant::now();
        // Frontend-built statements use `?`; renumber to $n and bind.
        let converted = dollar_placeholders(sql);
        let mut q = sqlx::query(&converted);
        for p in params {
            q = bind_str(q, p);
        }
        let columns = describe_columns(&pool, &converted).await?;
        let rows = q.fetch_all(&pool).await.map_err(DbError::SqlEngine)?;
        let out: Vec<Vec<Option<String>>> = rows.iter().map(row_to_vec).collect();
        Ok(QueryResult {
            columns,
            rows: out,
            rows_affected: 0,
            is_select: true,
            error: null_error(),
            elapsed_ms: start.elapsed().as_millis(),
            cancelled: false,
        })
    }

    async fn execute_op(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        op: &QueryOp,
    ) -> DbResult<super::OpOutcome> {
        self.guard.check_op(op)?;
        let pool = self.pool_for(database).await?;
        let database_key = self.resolve_database(database).to_string();
        let schema = schema.map(str::to_string).unwrap_or_else(|| self.cur_schema());
        let start = std::time::Instant::now();
        let mk = |columns: Vec<String>,
                  rows: Vec<Vec<Option<String>>>,
                  rows_affected: u64,
                  is_select: bool|
         -> QueryResult {
            QueryResult {
                columns,
                rows,
                rows_affected,
                is_select,
                error: null_error(),
                elapsed_ms: start.elapsed().as_millis(),
                cancelled: false,
            }
        };
        match op {
            QueryOp::Select { table, filters, custom_where, order_by, limit, offset } => {
                let mut params = Vec::new();
                let sql = build_select(
                    &schema,
                    table,
                    filters,
                    custom_where.as_ref(),
                    order_by,
                    *limit,
                    *offset,
                    &mut params,
                );
                let converted = dollar_placeholders(&sql);
                let display = super::inline_placeholders(&converted, &params, true) + ";";
                Ok(super::OpOutcome {
                    result: run_sql_prebound(&pool, &sql, params).await?,
                    sql: Some(display),
                })
            }
            QueryOp::Count { table, filters, custom_where } => {
                let mut params = Vec::new();
                let where_sql =
                    Self::where_clause(filters, custom_where.as_ref(), &mut params);
                let sql =
                    format!("SELECT COUNT(*) FROM {}{}", tq(&schema, table), where_sql);
                let converted = dollar_placeholders(&sql);
                let mut cq = sqlx::query_scalar::<_, i64>(&converted);
                for p in &params {
                    cq = match p {
                        Some(v) => cq.bind(v.clone()),
                        None => cq.bind(None::<String>),
                    };
                }
                // One scalar round trip — no row shaping, no column metadata.
                let count = cq.fetch_one(&pool).await.map_err(DbError::SqlEngine)? as u64;
                Ok(super::OpOutcome {
                    result: mk(vec!["count".into()], vec![vec![Some(count.to_string())]], count, true),
                    sql: Some(super::inline_placeholders(&converted, &params, true) + ";"),
                })
            }
            QueryOp::SelectDistinct { table, column, limit } => {
                let mut sql =
                    format!("SELECT DISTINCT {} FROM {}", q(column), tq(&schema, table));
                if let Some(l) = limit {
                    sql.push_str(&format!(" LIMIT {l}"));
                }
                let result = self.run_sql(database, None, &sql).await?;
                Ok(super::OpOutcome { result, sql: Some(format!("{};", sql)) })
            }
            QueryOp::Insert { table, values, skip_empty } => {
                let types = self.column_types_for(&pool, &database_key, &schema, table).await?;
                let mut names = Vec::new();
                let mut phs = Vec::new();
                // Values whose placeholders land in the SQL, in order — the
                // bind loop below MUST cover exactly these.
                let mut bound: Vec<&Option<String>> = Vec::new();
                let mut n = 0;
                for (col, val) in values {
                    if *skip_empty && val.is_none() { continue; }
                    n += 1;
                    names.push(q(col));
                    let cast = types.get(col.as_str()).map(|t| format!("::{t}")).unwrap_or_default();
                    phs.push(format!("${n}{cast}"));
                    bound.push(val);
                }
                if names.is_empty() {
                    return Ok(super::OpOutcome { result: mk(vec![], vec![], 0, false), sql: None });
                }
                let sql = format!(
                    "INSERT INTO {} ({}) VALUES ({})",
                    tq(&schema, table),
                    names.join(", "),
                    phs.join(", ")
                );
                log::debug!("pg insert: {sql}");
                let mut ins = sqlx::query(&sql);
                for val in &bound {
                    ins = bind_str(ins, val);
                }
                let res = ins.execute(&pool).await.map_err(DbError::SqlEngine)?;
                // Display copy: bound values inlined so the log is readable.
                let display = format!(
                    // (trailing semicolon appended below)
                    "INSERT INTO {} ({}) VALUES ({})",
                    tq(&schema, table),
                    names.join(", "),
                    bound
                        .iter()
                        .map(|v| super::sql_literal(v.as_deref()))
                        .collect::<Vec<_>>()
                        .join(", ")
                );
                let display = format!("{display};");
                Ok(super::OpOutcome {
                    result: mk(vec![], vec![], res.rows_affected(), false),
                    sql: Some(display),
                })
            }
            QueryOp::BulkUpdate { table, column, value, filters, custom_where } => {
                let types = self.column_types_for(&pool, &database_key, &schema, table).await?;
                let cast = types.get(column.as_str()).map(|t| format!("::{t}")).unwrap_or_default();
                let mut params: Vec<Option<String>> = vec![value.clone()];
                let where_sql = Self::where_clause(filters, custom_where.as_ref(), &mut params);
                let sql = format!(
                    "UPDATE {} SET {} = ?{cast}{where_sql}",
                    tq(&schema, table),
                    q(column),
                );
                let converted = dollar_placeholders(&sql);
                let mut final_q = sqlx::query(&converted);
                for p in &params {
                    final_q = bind_str(final_q, p);
                }
                log::debug!("pg bulk update: {sql}");
                let res = final_q.execute(&pool).await.map_err(DbError::SqlEngine)?;
                let display = format!(
                    "UPDATE {} SET {} = {}{where_sql};",
                    tq(&schema, table),
                    q(column),
                    super::sql_literal(value.as_deref()),
                );
                Ok(super::OpOutcome {
                    result: mk(vec![], vec![], res.rows_affected(), false),
                    sql: Some(display),
                })
            }
            QueryOp::Update { table, set, match_row } => {
                if set.is_empty() {
                    return Ok(super::OpOutcome { result: mk(vec![], vec![], 0, false), sql: None });
                }
                let types = self.column_types_for(&pool, &database_key, &schema, table).await?;
                let mut sets = Vec::new();
                let mut wheres = Vec::new();
                let mut n = 0;
                for (col, _val) in set {
                    n += 1;
                    let cast = types.get(col).map(|t| format!("::{t}")).unwrap_or_default();
                    sets.push(format!("{} = ${n}{}", q(col), cast));
                }
                for (col, val) in match_row {
                    n += 1;
                    let cast = types.get(col).map(|t| format!("::{t}")).unwrap_or_default();
                    wheres.push(if val.is_none() {
                        format!("{} IS NULL", q(col))
                    } else {
                        format!("{} = ${n}{}", q(col), cast)
                    });
                }
                let sql = format!(
                    "UPDATE {} SET {} WHERE {}",
                    tq(&schema, table),
                    sets.join(", "),
                    wheres.join(" AND ")
                );
                // Placeholder numbering increments for EVERY match column,
                // but IS NULL columns emit no placeholder — so bind the set
                // values, then only the non-NULL match values, in order.
                let mut final_q = sqlx::query(&sql);
                for (_, val) in set.iter() {
                    final_q = bind_str(final_q, val);
                }
                for (_, val) in match_row.iter() {
                    if !val.is_none() {
                        final_q = bind_str(final_q, val);
                    }
                }
                log::debug!("pg update: {sql}");
                let res = final_q.execute(&pool).await.map_err(DbError::SqlEngine)?;
                // Display copy with values inlined (log only).
                let display = format!(
                    // (trailing semicolon appended below)
                    "UPDATE {} SET {} WHERE {}",
                    tq(&schema, table),
                    set.iter()
                        .map(|(c, v)| format!("{} = {}", q(c), super::sql_literal(v.as_deref())))
                        .collect::<Vec<_>>()
                        .join(", "),
                    match_row
                        .iter()
                        .map(|(c, v)| match v {
                            None => format!("{} IS NULL", q(c)),
                            Some(_) => {
                                format!("{} = {}", q(c), super::sql_literal(v.as_deref()))
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" AND ")
                );
                let display = format!("{display};");
                Ok(super::OpOutcome {
                    result: mk(vec![], vec![], res.rows_affected(), false),
                    sql: Some(display),
                })
            }
            QueryOp::Delete { table, match_row } => {
                let types = self.column_types_for(&pool, &database_key, &schema, table).await?;
                let mut wheres = Vec::new();
                let mut final_q = sqlx::query("");
                let mut n = 0;
                for (col, val) in match_row {
                    n += 1;
                    if val.is_none() {
                        wheres.push(format!("{} IS NULL", q(col)));
                    } else {
                        let cast = types.get(col).map(|t| format!("::{t}")).unwrap_or_default();
                        wheres.push(format!("{} = ${n}{}", q(col), cast));
                        final_q = bind_str(final_q, val);
                    }
                }
                let sql = format!(
                    "DELETE FROM {}{}",
                    tq(&schema, table),
                    if wheres.is_empty() { String::new() } else { format!(" WHERE {}", wheres.join(" AND ")) }
                );
                log::debug!("pg delete: {sql}");
                let mut real_q = sqlx::query(&sql);
                for (_, val) in match_row.iter() {
                    if !val.is_none() { real_q = bind_str(real_q, val); }
                }
                let res = real_q.execute(&pool).await.map_err(DbError::SqlEngine)?;
                let display = format!(
                    // (trailing semicolon appended below)
                    "DELETE FROM {}{}",
                    tq(&schema, table),
                    if match_row.is_empty() {
                        String::new()
                    } else {
                        format!(
                            " WHERE {}",
                            match_row
                                .iter()
                                .map(|(c, v)| match v {
                                    None => format!("{} IS NULL", q(c)),
                                    Some(_) => format!(
                                        "{} = {}",
                                        q(c),
                                        super::sql_literal(v.as_deref())
                                    ),
                                })
                                .collect::<Vec<_>>()
                                .join(" AND ")
                        )
                    }
                );
                let display = format!("{display};");
                Ok(super::OpOutcome {
                    result: mk(vec![], vec![], res.rows_affected(), false),
                    sql: Some(display),
                })
            }
            QueryOp::DropTable { table } => {
                let sql = format!("DROP TABLE IF EXISTS {}", tq(&schema, table));
                let res = sqlx::query(&sql).execute(&pool).await.map_err(DbError::SqlEngine)?;
                self.type_cache
                    .lock()
                    .unwrap()
                    .remove(&(database_key.clone(), schema.clone(), table.to_string()));
                Ok(super::OpOutcome {
                    result: mk(vec![], vec![], res.rows_affected(), false),
                    sql: Some(format!("{sql};")),
                })
            }
        }
    }

    async fn execute_op_stream(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        op: &QueryOp,
        on_batch: BatchSink<'_>,
    ) -> DbResult<super::OpOutcome> {
        self.guard.check_op(op)?;
        // Only SELECT streams; everything else runs normally.
        let QueryOp::Select { table, filters, custom_where, order_by, limit, offset } = op else {
            return self.execute_op(database, schema, op).await
        };
        let pool = self.pool_for(database).await?;
        let schema = schema.map(str::to_string).unwrap_or_else(|| self.cur_schema());
        let start = Instant::now();
        let mut params = Vec::new();
        let sql = dollar_placeholders(&build_select(
            &schema,
            table,
            filters,
            custom_where.as_ref(),
            order_by,
            *limit,
            *offset,
            &mut params,
        ));

        let display = super::inline_placeholders(&sql, &params, true) + ";";
        // Describe columns up front so a genuinely empty result still
        // reports real column names — deriving them from the first
        // STREAMED row instead (the previous approach here) left `columns`
        // empty whenever the query matched zero rows, since the loop body
        // below never ran.
        let columns = describe_columns(&pool, &sql).await?;
        on_batch(QueryChunk { columns: Some(columns.clone()), rows: Vec::new() })?;

        let mut stream = bind_all(&sql, &params).fetch(&pool);
        let mut batch: Vec<Vec<Option<String>>> = Vec::new();

        while let Some(row) = stream.try_next().await.map_err(DbError::SqlEngine)? {
            batch.push(row_to_vec(&row));
            if batch.len() >= 500 {
                on_batch(QueryChunk { columns: None, rows: std::mem::take(&mut batch) })?;
            }
        }
        if !batch.is_empty() {
            on_batch(QueryChunk { columns: None, rows: batch })?;
        }

        Ok(super::OpOutcome {
            result: QueryResult {
                columns,
                rows: vec![], // caller assembles from chunks
                rows_affected: 0,
                is_select: true,
                error: null_error(),
                elapsed_ms: start.elapsed().as_millis(),
                cancelled: false,
            },
            sql: Some(display),
        })
    }

    async fn run_sql_stream(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        sql: &str,
        run: Option<&RunHandle>,
        on_batch: BatchSink<'_>,
    ) -> DbResult<QueryResult> {
        // Before a canceller is armed, so a refused statement never becomes
        // a run Stop could reach.
        self.guard.check_sql(Dialect::Postgres, sql)?;
        let result = match run {
            Some(run) => self
                .run_sql_cancellable(database, schema, sql, run)
                .await
                .map_err(|e| self.guard.refine(e))?,
            None => self.run_sql(database, schema, sql).await?,
        };
        if result.is_select && !result.rows.is_empty() {
            let chunk = QueryChunk {
                columns: Some(result.columns.clone()),
                rows: result.rows.clone(),
            };
            on_batch(chunk)?;
        }
        Ok(QueryResult { rows: vec![], ..result })
    }

    async fn apply_schema_ops_batch(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        ops: &[SchemaOp],
    ) -> DbResult<Vec<String>> {
        if !ops.is_empty() {
            self.guard.check_write("schema changes")?;
        }
        let pool = self.pool_for(database).await?;
        let mut conn = pool.acquire().await.map_err(DbError::SqlEngine)?;
        let mut tx = conn.begin().await.map_err(DbError::SqlEngine)?;
        // Transaction-local search_path: every unqualified name in the DDL
        // batch resolves inside the active schema. SET LOCAL dies with the
        // transaction, so pooled connections stay clean (PgBouncer-safe).
        let schema = schema.map(str::to_string).unwrap_or_else(|| self.cur_schema());
        sqlx::query(&format!("SET LOCAL search_path = {}", q(&schema)))
            .execute(&mut *tx)
            .await
            .map_err(DbError::SqlEngine)?;
        let mut executed = vec![format!("SET LOCAL search_path = {}", q(&schema))];
        for op in ops {
            let stmts: Vec<String> = match op {
                SchemaOp::RenameTable { table, new_name } => {
                    vec![format!("ALTER TABLE {} RENAME TO {}", q(table), q(new_name))]
                }
                SchemaOp::AddColumn { table, name, data_type, not_null, default } => {
                    let nn = if *not_null && default.is_some() { " NOT NULL" } else { "" };
                    let dflt = default
                        .as_deref()
                        .map(|d| format!(" DEFAULT {d}"))
                        .unwrap_or_default();
                    vec![format!(
                        "ALTER TABLE {} ADD COLUMN {} {}{nn}{dflt}",
                        q(table),
                        q(name),
                        if data_type.trim().is_empty() { "TEXT" } else { data_type.trim() }
                    )]
                }
                SchemaOp::DropColumn { table, name } => {
                    vec![format!("ALTER TABLE {} DROP COLUMN {}", q(table), q(name))]
                }
                SchemaOp::AlterColumn { table, column, new_name, data_type, not_null, default_mode, default_value } => {
                    // Postgres handles every change IN PLACE — no rebuild
                    // needed (unlike SQLite). Rename is its own statement;
                    // the rest compose into one ALTER with clause list.
                    // NOTE: this arm ONLY builds statements — the batch loop
                    // below owns execution. Double-executing DDL here caused
                    // renames to fail with "column does not exist".
                    let mut ran: Vec<String> = Vec::new();
                    if let Some(n) = new_name {
                        let n = n.trim();
                        if n != column {
                            ran.push(format!(
                                "ALTER TABLE {} RENAME COLUMN {} TO {};",
                                q(table),
                                q(column),
                                q(n)
                            ));
                        }
                    }
                    let mut clauses: Vec<String> = Vec::new();
                    let ac = format!("ALTER COLUMN {}", q(column));
                    let new_type = data_type.as_deref().map(str::trim).filter(|t| !t.is_empty());
                    if let Some(t) = new_type {
                        clauses.push(format!("{ac} TYPE {t} USING {ac2}::{t}", ac2 = q(column)));
                    }
                    match not_null {
                        Some(true) => clauses.push(format!("{ac} SET NOT NULL")),
                        Some(false) => clauses.push(format!("{ac} DROP NOT NULL")),
                        None => {}
                    }
                    match default_mode {
                        Some(crate::api::DefaultMode::Set) => {
                            let v = default_value.clone().unwrap_or_default();
                            if v.trim().is_empty() {
                                clauses.push(format!("{ac} DROP DEFAULT"));
                            } else {
                                clauses.push(format!("{ac} SET DEFAULT {}", v));
                            }
                        }
                        Some(crate::api::DefaultMode::Drop) => {
                            clauses.push(format!("{ac} DROP DEFAULT"))
                        }
                        Some(crate::api::DefaultMode::Keep) | None => {}
                    }
                    if !clauses.is_empty() {
                        let s = format!(
                            "ALTER TABLE {} {};",
                            q(table),
                            clauses.join(", ")
                        );
                        sqlx::query(&s).execute(&mut *tx).await.map_err(DbError::SqlEngine)?;
                        ran.push(s);
                    }
                    if ran.is_empty() {
                        return Err(DbError::InvalidOperation(
                            "alter column: nothing to change".into(),
                        ));
                    }
                    ran
                }
                SchemaOp::CreateIndex { table, name, columns, unique, .. } => {
                    let u = if *unique { "UNIQUE " } else { "" };
                    let cols = columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
                    vec![format!(
                        "CREATE {u}INDEX {} ON {} ({cols})",
                        q(name),
                        q(table)
                    )]
                }
                SchemaOp::DropIndex { index, .. } => {
                    vec![format!("DROP INDEX {}", q(index))]
                }
                SchemaOp::DropTrigger { name } => {
                    vec![format!("DROP TRIGGER IF EXISTS {}", q(name))]
                }
                SchemaOp::CreateTrigger { sql } => {
                    let s = sql.trim();
                    if !s.to_uppercase().starts_with("CREATE TRIGGER") {
                        return Err(DbError::InvalidOperation(
                            "trigger SQL must start with CREATE TRIGGER".into(),
                        ));
                    }
                    vec![s.to_string()]
                }
                SchemaOp::SetPrimaryKey { table, columns } => {
                    let pkey = format!("{}_pkey", table);
                    if columns.is_empty() {
                        vec![format!(
                            "ALTER TABLE {} DROP CONSTRAINT IF EXISTS {};",
                            q(table),
                            q(&pkey)
                        )]
                    } else {
                        let cols = columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
                        vec![format!(
                            "ALTER TABLE {} DROP CONSTRAINT IF EXISTS {}, ADD PRIMARY KEY ({cols});",
                            q(table),
                            q(&pkey)
                        )]
                    }
                }
                SchemaOp::AddForeignKey {
                    table,
                    columns,
                    ref_table,
                    ref_columns,
                    on_delete,
                    on_update,
                } => {
                    // Whitelist the referential actions — they are interpolated.
                    const ACTIONS: [&str; 5] =
                        ["CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT", "NO ACTION"];
                    let action = |v: &Option<String>| -> Option<&'static str> {
                        v.as_deref().map(str::trim).and_then(|a| {
                            ACTIONS.iter().find(|k| k.eq_ignore_ascii_case(a)).copied()
                        })
                    };
                    let cols = columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
                    let rcols = ref_columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
                    let mut s = format!(
                        "ALTER TABLE {} ADD CONSTRAINT {} FOREIGN KEY ({cols}) REFERENCES {} ({rcols})",
                        q(table),
                        q(&format!("fk_{}_{}", table, columns.join("_"))),
                        q(ref_table)
                    );
                    if let Some(a) = action(on_delete) {
                        s.push_str(&format!(" ON DELETE {a}"));
                    }
                    if let Some(a) = action(on_update) {
                        s.push_str(&format!(" ON UPDATE {a}"));
                    }
                    s.push(';');
                    vec![s]
                }
                SchemaOp::DropConstraint { table, name } => {
                    vec![format!(
                        "ALTER TABLE {} DROP CONSTRAINT IF EXISTS {};",
                        q(table),
                        q(name)
                    )]
                }
            };
            for st in &stmts {
                sqlx::query(st).execute(&mut *tx).await.map_err(DbError::SqlEngine)?;
                executed.push(st.clone());
            }
        }
        tx.commit().await.map_err(DbError::SqlEngine)?;
        // DDL may have changed columns/types — drop every cached map so the
        // next write re-introspects.
        self.type_cache.lock().unwrap().clear();
        Ok(executed)
    }

    /// Duplicate a plain table: `LIKE … INCLUDING ALL` copies columns,
    /// defaults, NOT NULL, CHECKs and all indexes (PRIMARY KEY included).
    /// Postgres deliberately excludes FOREIGN KEY constraints from LIKE —
    /// documented limitation, same as pg_dump's --no-owner style copies.
    async fn duplicate_table(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        source: &str,
        target: &str,
        _copy_data: bool,
    ) -> DbResult<Vec<String>> {
        self.guard.check_write("duplicate table")?;
        // TODO(postgres duplicate UI): honor copy_data once Postgres gets the
        // same copy-data checkbox as Mongo's "Duplicate collection" — for now
        // this always copies structure + indexes + data, matching prior
        // behavior before the flag existed.
        let pool = self.pool_for(database).await?;
        let schema = schema.map(str::to_string).unwrap_or_else(|| self.cur_schema());
        let kind: Option<String> = sqlx::query_scalar(
            "SELECT CASE c.relkind WHEN 'r' THEN 'table' ELSE NULL END \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relname = $2",
        )
        .bind(&schema)
        .bind(source)
        .fetch_optional(&pool)
        .await
        .map_err(DbError::SqlEngine)?;
        if kind.is_none() {
            return Err(DbError::InvalidOperation(format!(
                "\"{source}\" is not a plain table — only tables can be duplicated on Postgres"
            )));
        }
        let create = format!(
            "CREATE TABLE {} (LIKE {} INCLUDING ALL)",
            tq(&schema, target),
            tq(&schema, source)
        );
        let copy = format!(
            "INSERT INTO {} SELECT * FROM {}",
            tq(&schema, target),
            tq(&schema, source)
        );
        sqlx::query(&create)
            .execute(&pool)
            .await
            .map_err(DbError::SqlEngine)?;
        sqlx::query(&copy)
            .execute(&pool)
            .await
            .map_err(DbError::SqlEngine)?;
        Ok(vec![format!("{create};"), format!("{copy};")])
    }

    async fn refresh_matview(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        name: &str,
    ) -> DbResult<()> {
        self.guard.check_write("refresh materialized view")?;
        let pool = self.pool_for(database).await?;
        let schema = schema.map(str::to_string).unwrap_or_else(|| self.cur_schema());
        let sql = format!("REFRESH MATERIALIZED VIEW {}", tq(&schema, name));
        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(DbError::SqlEngine)?;
        Ok(())
    }

    async fn close(self: Arc<Self>) {
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

/// Whether `trimmed` (already `$n` converted and trimmed) reads rows, by its
/// first keyword.
fn is_select_statement(trimmed: &str) -> bool {
    let first_word = trimmed
        .split(|c: char| c == ' ' || c == '\n' || c == '\t')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    first_word == "select" || first_word == "with"
}

/// SQLSTATE `query_canceled`: what `pg_cancel_backend` produces. A
/// `statement_timeout` raises it too, which is why it only counts as Stopped
/// when the user asked (see [`pg_run_error`]).
const PG_QUERY_CANCELED: &str = "57014";
/// How long one cancel attempt may take to connect and run
/// `pg_cancel_backend` before it gives up (the run's 3 second confirm cap
/// then frees the tab anyway, e.g. when the server is at its connection
/// limit).
const PG_CANCEL_ATTEMPT_CAP: std::time::Duration = std::time::Duration::from_millis(1500);
/// The registry re-fires a canceller every 200ms; each Postgres attempt costs
/// a whole connection, so attempts are spread at least this far apart.
const PG_CANCEL_MIN_GAP: std::time::Duration = std::time::Duration::from_secs(1);

/// An engine error becomes `Cancelled` only for `query_canceled` AND when the
/// user asked to stop this run. A `statement_timeout` (same SQLSTATE) or any
/// other error stays the error it is (AC-13).
fn pg_run_error(e: sqlx::Error, run: &RunHandle) -> DbError {
    let canceled = e
        .as_database_error()
        .and_then(|d| d.code())
        .is_some_and(|c| c == PG_QUERY_CANCELED);
    if canceled && run.is_cancel_requested() {
        DbError::Cancelled
    } else {
        DbError::SqlEngine(e)
    }
}

/// Builds the run's canceller: a new connection (never from the pool) that
/// asks the server to cancel backend `pid`'s current query.
fn pg_canceller(options: PgConnectOptions, pid: i32) -> Canceller {
    let last_attempt = std::sync::Mutex::new(None::<Instant>);
    Box::new(move || {
        {
            let mut last = last_attempt.lock().unwrap();
            if last.is_some_and(|at| at.elapsed() < PG_CANCEL_MIN_GAP) {
                return Box::pin(std::future::ready(()));
            }
            *last = Some(Instant::now());
        }
        let options = options.clone();
        Box::pin(async move {
            let sent = tokio::time::timeout(PG_CANCEL_ATTEMPT_CAP, async {
                let mut conn = PgConnection::connect_with(&options).await?;
                sqlx::query("SELECT pg_cancel_backend($1)")
                    .bind(pid)
                    .execute(&mut conn)
                    .await?;
                let _ = conn.close().await;
                Ok::<(), sqlx::Error>(())
            })
            .await;
            match sent {
                Ok(Ok(())) => {}
                Ok(Err(e)) => log::warn!("postgres cancel attempt failed: {e}"),
                Err(_) => log::warn!("postgres cancel attempt timed out"),
            }
        })
    })
}

/// A run's dedicated pool connection. If the run is dropped mid query (the
/// 3 second abandon), the connection is detached from the pool instead of
/// being handed back still busy, so it is never reused dirty.
struct RunConn {
    conn: Option<PoolConnection<Postgres>>,
    dirty: bool,
}

impl RunConn {
    async fn acquire(pool: &PgPool) -> DbResult<Self> {
        let conn = pool.acquire().await.map_err(DbError::SqlEngine)?;
        Ok(Self { conn: Some(conn), dirty: true })
    }

    /// The run ended normally: hand the connection back to the pool, or (if
    /// `reusable` is false, e.g. a broken socket) detach it.
    fn release(&mut self, reusable: bool) {
        self.dirty = !reusable;
    }
}

impl std::ops::Deref for RunConn {
    type Target = PgConnection;
    fn deref(&self) -> &PgConnection {
        self.conn.as_ref().expect("connection present until drop")
    }
}

impl std::ops::DerefMut for RunConn {
    fn deref_mut(&mut self) -> &mut PgConnection {
        self.conn.as_mut().expect("connection present until drop")
    }
}

impl Drop for RunConn {
    fn drop(&mut self) {
        if self.dirty {
            if let Some(conn) = self.conn.take() {
                drop(conn.detach());
            }
        }
    }
}

/// Whether a run's connection is safe to hand back to the pool: the server
/// answered (a result, an SQL error, or our own cancel). Anything else (a
/// broken socket, a protocol error) is detached instead.
fn conn_reusable<T>(res: &DbResult<T>) -> bool {
    match res {
        Ok(_) | Err(DbError::Cancelled) => true,
        Err(DbError::SqlEngine(sqlx::Error::Database(_))) => true,
        Err(_) => false,
    }
}

/// Run one statement on `conn`, rendering rows as text cells.
async fn exec_statement(
    conn: &mut PgConnection,
    trimmed: &str,
    is_select: bool,
    start: Instant,
    run: &RunHandle,
) -> DbResult<QueryResult> {
    if is_select {
        let columns = describe_columns_conn(conn, trimmed).await?;
        let rows = sqlx::query(trimmed)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| pg_run_error(e, run))?;
        let out: Vec<Vec<Option<String>>> = rows.iter().map(row_to_vec).collect();
        return Ok(QueryResult {
            columns,
            rows: out,
            rows_affected: 0,
            is_select: true,
            error: null_error(),
            elapsed_ms: start.elapsed().as_millis(),
            cancelled: false,
        });
    }
    let res = sqlx::query(trimmed)
        .execute(&mut *conn)
        .await
        .map_err(|e| pg_run_error(e, run))?;
    Ok(QueryResult {
        columns: vec![],
        rows: vec![],
        rows_affected: res.rows_affected(),
        is_select: false,
        error: null_error(),
        elapsed_ms: start.elapsed().as_millis(),
        cancelled: false,
    })
}

/// `exec_statement` inside a transaction whose `search_path` is `schema`
/// (transaction local, so the pooled connection stays clean). A stopped
/// statement never commits: the transaction rolls back with it.
async fn run_in_schema_tx(
    conn: &mut PgConnection,
    schema: &str,
    trimmed: &str,
    is_select: bool,
    start: Instant,
    run: &RunHandle,
) -> DbResult<QueryResult> {
    let mut tx = conn.begin().await.map_err(DbError::SqlEngine)?;
    sqlx::query(&format!("SET LOCAL search_path = {}", q(schema)))
        .execute(&mut *tx)
        .await
        .map_err(DbError::SqlEngine)?;
    let result = exec_statement(&mut tx, trimmed, is_select, start, run).await?;
    tx.commit().await.map_err(DbError::SqlEngine)?;
    Ok(result)
}

/// Column names for `sql`, via Postgres's own Describe step (Parse+Describe,
/// no bound values or fetched rows needed) — independent of whether the
/// statement actually matches any rows. Deriving column names from the
/// first FETCHED row instead (the previous approach here) silently drops
/// every header whenever a query/table genuinely has zero matching rows.
/// Mirrors sqlite.rs's identical `conn.prepare(sql).await?.columns()` trick.
async fn describe_columns(pool: &PgPool, sql: &str) -> DbResult<Vec<String>> {
    let mut conn = pool.acquire().await.map_err(DbError::SqlEngine)?;
    let prepared = conn.prepare(sql).await.map_err(DbError::SqlEngine)?;
    Ok(prepared.columns().iter().map(|c| c.name().to_string()).collect())
}

/// Same as `describe_columns`, but on an already-open connection (a
/// transaction) instead of acquiring a fresh one from the pool — needed so
/// the PREPARE step itself resolves unqualified names through the SAME
/// transaction-local search_path `run_sql`'s schema-targeted path just set,
/// not whatever a freshly acquired pool connection happens to have.
async fn describe_columns_conn(
    conn: &mut sqlx::PgConnection,
    sql: &str,
) -> DbResult<Vec<String>> {
    let prepared = conn.prepare(sql).await.map_err(DbError::SqlEngine)?;
    Ok(prepared.columns().iter().map(|c| c.name().to_string()).collect())
}

/// Execute a SELECT whose `?` placeholders are renumbered to `$n`, binding
/// `params` in order, and render every row as text cells.
async fn run_sql_prebound(
    pool: &PgPool,
    sql: &str,
    params: Vec<Option<String>>,
) -> DbResult<QueryResult> {
    let start = Instant::now();
    let converted = dollar_placeholders(sql);
    let mut q = sqlx::query(&converted);
    for p in &params {
        q = bind_str(q, p);
    }
    let columns = describe_columns(pool, &converted).await?;
    let rows = q.fetch_all(pool).await.map_err(DbError::SqlEngine)?;
    let out: Vec<Vec<Option<String>>> = rows.iter().map(row_to_vec).collect();
    Ok(QueryResult {
        columns,
        rows: out,
        rows_affected: 0,
        is_select: true,
        error: null_error(),
        elapsed_ms: start.elapsed().as_millis(),
        cancelled: false,
    })
}

fn null_error() -> Option<String> {
    None
}

/// Bind one optional string parameter.
fn bind_str<'q>(
    q: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    v: &Option<String>,
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    match v {
        Some(x) => q.bind(x.clone()),
        None => q.bind(None::<String>),
    }
}

/// Build a query from SQL whose `?` placeholders are ALREADY renumbered to
/// `$1..$n` (see [`dollar_placeholders`]), binding `params` in order.
fn bind_all<'a>(
    sql: &'a str,
    params: &[Option<String>],
) -> sqlx::query::Query<'a, sqlx::Postgres, sqlx::postgres::PgArguments> {
    let mut q = sqlx::query(sql);
    for p in params {
        q = bind_str(q, p);
    }
    q
}

#[cfg(test)]
mod read_only_tests {
    use super::*;

    fn params(read_only: bool) -> PgParams {
        serde_json::from_value(serde_json::json!({
            "host": "db.example", "user": "u", "password": "p", "database": "d",
            "read_only": read_only,
        }))
        .unwrap()
    }

    /// AC-3: a read only connection starts every session with new
    /// transactions read only.
    #[test]
    fn read_only_connection_opens_sessions_read_only() {
        let p = params(true);
        assert!(p.guard.read_only);
        let options = pg_connect_options("db.example", 5432, &p, "d");
        assert_eq!(options.get_options(), Some("-c default_transaction_read_only=on"));
    }

    /// A normal connection's startup is untouched (PgBouncer and friends
    /// never see an `options` startup parameter they did not get before).
    #[test]
    fn normal_connection_sends_no_startup_options() {
        let p = params(false);
        assert!(!p.guard.read_only);
        let options = pg_connect_options("db.example", 5432, &p, "d");
        assert_eq!(options.get_options(), None);
    }

    /// AC-1: params without any of the four keys default to not read only.
    #[test]
    fn params_without_guard_fields_default_to_not_read_only() {
        let p: PgParams = serde_json::from_value(serde_json::json!({
            "host": "h", "user": "u", "password": "p", "database": "d",
        }))
        .unwrap();
        assert_eq!(p.guard, ConnGuard::default());
    }
}

/// Stop a running query (spec 0006): the pure decisions, no server needed.
#[cfg(test)]
mod run_error_tests {
    use super::*;
    use std::borrow::Cow;
    use std::fmt;

    /// A server error with a chosen SQLSTATE, standing in for what Postgres
    /// sends back.
    #[derive(Debug)]
    struct FakePgError {
        code: &'static str,
    }

    impl fmt::Display for FakePgError {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "fake postgres error {}", self.code)
        }
    }

    impl std::error::Error for FakePgError {}

    impl sqlx::error::DatabaseError for FakePgError {
        fn message(&self) -> &str {
            "fake postgres error"
        }
        fn code(&self) -> Option<Cow<'_, str>> {
            Some(Cow::Borrowed(self.code))
        }
        fn as_error(&self) -> &(dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn as_error_mut(&mut self) -> &mut (dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn into_error(self: Box<Self>) -> Box<dyn std::error::Error + Send + Sync + 'static> {
            self
        }
        fn kind(&self) -> sqlx::error::ErrorKind {
            sqlx::error::ErrorKind::Other
        }
    }

    fn server_error(code: &'static str) -> sqlx::Error {
        sqlx::Error::Database(Box::new(FakePgError { code }))
    }

    fn run(id: &str) -> RunHandle {
        super::super::runs::register("t-pg-unit", id)
    }

    async fn stop_requested_run(id: &str) -> RunHandle {
        // Stop for this id arrives first, so the run starts flagged.
        super::super::runs::cancel("t-pg-unit", id).await;
        run(id)
    }

    #[tokio::test]
    async fn query_canceled_after_stop_is_stopped() {
        let run = stop_requested_run("pg-unit-asked").await;

        let mapped = pg_run_error(server_error("57014"), &run);

        assert!(matches!(mapped, DbError::Cancelled), "got {mapped:?}");
        run.finish().await;
    }

    /// AC-13: a `statement_timeout` raises the same SQLSTATE, and must stay
    /// the error it is when nobody pressed Stop.
    #[tokio::test]
    async fn query_canceled_nobody_asked_for_stays_an_error() {
        let run = run("pg-unit-timeout");

        let mapped = pg_run_error(server_error("57014"), &run);

        assert!(matches!(mapped, DbError::SqlEngine(_)), "got {mapped:?}");
        run.finish().await;
    }

    #[tokio::test]
    async fn other_server_errors_stay_errors_even_after_stop() {
        let run = stop_requested_run("pg-unit-other").await;

        // 23505 unique_violation, 42P01 undefined_table.
        for code in ["23505", "42P01"] {
            let mapped = pg_run_error(server_error(code), &run);
            assert!(matches!(mapped, DbError::SqlEngine(_)), "{code}: {mapped:?}");
        }
        run.finish().await;
    }

    #[tokio::test]
    async fn a_non_server_error_stays_an_error_even_after_stop() {
        let run = stop_requested_run("pg-unit-io").await;

        let mapped = pg_run_error(sqlx::Error::PoolTimedOut, &run);

        assert!(matches!(mapped, DbError::SqlEngine(_)), "got {mapped:?}");
        run.finish().await;
    }

    #[test]
    fn a_connection_the_server_answered_on_goes_back_to_the_pool() {
        assert!(conn_reusable(&Ok::<_, DbError>(1)));
        assert!(conn_reusable::<()>(&Err(DbError::Cancelled)));
        assert!(conn_reusable::<()>(&Err(DbError::SqlEngine(server_error("42601")))));
    }

    /// A broken socket or a timeout may leave the connection mid query, so it
    /// is detached instead of reused dirty.
    #[test]
    fn a_connection_that_broke_is_not_reused() {
        assert!(!conn_reusable::<()>(&Err(DbError::SqlEngine(sqlx::Error::PoolTimedOut))));
        assert!(!conn_reusable::<()>(&Err(DbError::SqlEngine(sqlx::Error::Io(
            std::io::Error::other("connection reset")
        )))));
        assert!(!conn_reusable::<()>(&Err(DbError::InvalidOperation("x".into()))));
    }

    #[test]
    fn select_and_with_read_rows_and_everything_else_does_not() {
        assert!(is_select_statement("select 1"));
        assert!(is_select_statement("SELECT\n1"));
        assert!(is_select_statement("with c as (select 1) select * from c"));
        assert!(is_select_statement("select\t1"));

        assert!(!is_select_statement("update t set a = 1"));
        assert!(!is_select_statement("insert into t values (1)"));
        assert!(!is_select_statement("delete from t"));
        assert!(!is_select_statement("create table t (a int)"));
        assert!(!is_select_statement(""));
    }
}

#[cfg(test)]
mod array_decode_tests {
    use super::{decode_pg_array, fixed_typlen};

    fn i32(v: i32) -> Vec<u8> {
        v.to_be_bytes().to_vec()
    }

    #[test]
    fn varlena_empty_and_values() {
        // {read,write} — varlena (no fixed width), no nulls.
        let mut b = Vec::new();
        b.extend(i32(1)); // ndim
        b.extend(i32(0)); // hasnull
        b.extend(i32(25)); // elem oid = text (varlena)
        b.extend(i32(2)); // nelems
        b.extend(i32(1)); // lower bound
        b.extend(i32(4)); // "read"
        b.extend(b"read");
        b.extend(i32(5)); // "write"
        b.extend(b"write");
        let got = decode_pg_array(&b);
        assert_eq!(got, vec![Some("read".into()), Some("write".into())]);
        assert_eq!(fixed_typlen(25), None);
    }

    #[test]
    fn varlena_with_null() {
        // {read,NULL,admin}
        let mut b = Vec::new();
        b.extend(i32(1));
        b.extend(i32(1)); // hasnull
        b.extend(i32(694124)); // arbitrary enum oid -> varlena
        b.extend(i32(3));
        b.extend(i32(1));
        b.extend(i32(4));
        b.extend(b"read");
        b.extend(i32(-1)); // NULL
        b.extend(i32(5));
        b.extend(b"admin");
        assert_eq!(
            decode_pg_array(&b),
            vec![
                Some("read".into()),
                None,
                Some("admin".into())
            ]
        );
    }

    #[test]
    fn empty_array() {
        // ndim = 0
        let mut b = Vec::new();
        b.extend(i32(0)); // ndim = 0 => empty array
        b.extend(i32(0));
        b.extend(i32(25));
        assert_eq!(decode_pg_array(&b), Vec::<Option<String>>::new());
    }

    #[test]
    fn fixed_width_no_null() {
        // int[] {1,2} -> fixed width 4, packed contiguously.
        let mut b = Vec::new();
        b.extend(i32(1)); // ndim
        b.extend(i32(0)); // hasnull
        b.extend(i32(23)); // int4, width 4
        b.extend(i32(2));
        b.extend(i32(1));
        b.extend(1i32.to_be_bytes());
        b.extend(2i32.to_be_bytes());
        assert_eq!(
            decode_pg_array(&b),
            vec![Some("1".into()), Some("2".into())]
        );
        assert_eq!(fixed_typlen(23), Some(4));
    }

    #[test]
    fn fixed_width_with_null() {
        // int[] {1,NULL} -> width 4, hasnull with length prefixes.
        let mut b = Vec::new();
        b.extend(i32(1));
        b.extend(i32(1)); // hasnull
        b.extend(i32(23));
        b.extend(i32(2));
        b.extend(i32(1));
        b.extend(i32(4)); // len
        b.extend(1i32.to_be_bytes());
        b.extend(i32(-1)); // NULL
        assert_eq!(
            decode_pg_array(&b),
            vec![Some("1".into()), None]
        );
    }
}


/// Stop a running query (spec 0006) against a real server. All `#[ignore]`d:
/// run with `cargo test -p dh-core -- --ignored pg_stop` against the throwaway
/// instance the server tests use (`DH_TEST_DATABASE_URL`, default
/// `postgres://postgres@127.0.0.1:5544/dh_server_test`).
#[cfg(test)]
mod stop_tests {
    use super::*;
    use crate::db::runs;
    use std::time::Duration;

    const LIVE: &str = "requires a live Postgres test database, see server::store::test_pg_url";

    fn params(pool_max: u32) -> PgParams {
        let url = std::env::var("DH_TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgres://postgres@127.0.0.1:5544/dh_server_test".to_string());
        let rest = url.strip_prefix("postgres://").expect("a postgres:// url");
        let (auth, tail) = rest.split_once('@').expect("user@host in the url");
        let (user, password) = auth.split_once(':').unwrap_or((auth, ""));
        let (hostport, database) = tail.split_once('/').expect("/database in the url");
        let (host, port) = hostport.split_once(':').unwrap_or((hostport, "5432"));
        serde_json::from_value(serde_json::json!({
            "host": host, "port": port.parse::<u16>().unwrap(), "user": user,
            "password": password, "database": database, "ssl_mode": "disable",
            "pool_max": pool_max,
        }))
        .unwrap()
    }

    fn tag() -> String {
        format!("dh-stop-{}", uuid::Uuid::new_v4().simple())
    }

    fn sink() -> impl FnMut(QueryChunk) -> DbResult<()> + Send {
        |_chunk: QueryChunk| Ok(())
    }

    /// Cancel `run_id` after `after_ms`, on its own task.
    fn stop_later(conn: &str, run_id: &str, after_ms: u64) -> tokio::task::JoinHandle<runs::CancelOutcome> {
        let (conn, run_id) = (conn.to_string(), run_id.to_string());
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(after_ms)).await;
            runs::cancel(&conn, &run_id).await
        })
    }

    /// AC-1, AC-2, AC-4: Stop ends the query on the SERVER, and the very next
    /// query runs.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_stop_cancels_the_query_on_the_server() {
        let _ = LIVE;
        let a = PgAdapter::connect(&params(4)).await.unwrap();
        let t = tag();
        let run_id = format!("run-{t}");
        let run = runs::register("t-pg", &run_id);
        let stopper = stop_later("t-pg", &run_id, 400);

        let started = Instant::now();
        let mut on_batch = sink();
        let res = a
            .run_sql_stream(None, None, &format!("SELECT pg_sleep(60) /* {t} */"), Some(&run), &mut on_batch)
            .await;
        run.finish().await;
        assert!(matches!(res, Err(DbError::Cancelled)), "got {res:?}");
        assert!(started.elapsed() < Duration::from_secs(3), "cancel should land fast");
        assert_eq!(stopper.await.unwrap().state, runs::CancelState::Stopped);

        // Gone from pg_stat_activity, not merely ignored by the app.
        let still: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query LIKE $1 AND pid <> pg_backend_pid()",
        )
        .bind(format!("%{t}%"))
        .fetch_one(&a.pool)
        .await
        .unwrap();
        assert_eq!(still, 0);

        // The connection is back: the next query runs right away.
        let r = a.run_sql(None, None, "SELECT 1").await.unwrap();
        assert_eq!(r.rows, vec![vec![Some("1".to_string())]]);
    }

    /// AC-8: a stopped write leaves no partial change, with and without a
    /// target schema (the two run paths).
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_stop_rolls_back_a_stopped_write() {
        let a = PgAdapter::connect(&params(4)).await.unwrap();
        let table = format!("dh_stop_{}", uuid::Uuid::new_v4().simple());
        a.run_sql(None, None, &format!("CREATE TABLE public.{table} (a int)")).await.unwrap();
        a.run_sql(None, None, &format!("INSERT INTO public.{table} VALUES (7)")).await.unwrap();

        for (i, schema) in [None, Some("public")].into_iter().enumerate() {
            let run_id = format!("run-{table}-{i}");
            let run = runs::register("t-pg", &run_id);
            let stopper = stop_later("t-pg", &run_id, 400);
            let mut on_batch = sink();
            let res = a
                .run_sql_stream(
                    None,
                    schema,
                    &format!("UPDATE public.{table} SET a = (SELECT 9 FROM pg_sleep(60))"),
                    Some(&run),
                    &mut on_batch,
                )
                .await;
            run.finish().await;
            assert!(matches!(res, Err(DbError::Cancelled)), "schema {schema:?}: got {res:?}");
            stopper.await.unwrap();
            let r = a.run_sql(None, None, &format!("SELECT a FROM public.{table}")).await.unwrap();
            assert_eq!(r.rows, vec![vec![Some("7".to_string())]], "schema {schema:?}");
        }
        a.run_sql(None, None, &format!("DROP TABLE public.{table}")).await.unwrap();
    }

    /// AC-13: `statement_timeout` raises the same SQLSTATE as a cancel, and
    /// must still read as an error when nobody pressed Stop.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_stop_leaves_a_statement_timeout_as_an_error() {
        // One connection, so the session setting reaches the run's query.
        let a = PgAdapter::connect(&params(1)).await.unwrap();
        a.run_sql(None, None, "SET statement_timeout = 300").await.unwrap();
        let run = runs::register("t-pg", "run-pg-timeout");
        let mut on_batch = sink();
        let res = a.run_sql_stream(None, None, "SELECT pg_sleep(5)", Some(&run), &mut on_batch).await;
        run.finish().await;
        a.run_sql(None, None, "SET statement_timeout = 0").await.unwrap();
        match res {
            Err(DbError::SqlEngine(e)) => assert!(e.to_string().contains("statement timeout"), "{e}"),
            other => panic!("expected an ordinary error, got {other:?}"),
        }
    }

    /// A Stop that arrives before the command does: the statement never runs.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_stop_before_start_never_runs() {
        let a = PgAdapter::connect(&params(4)).await.unwrap();
        runs::cancel("t-pg", "run-pg-early").await;
        let run = runs::register("t-pg", "run-pg-early");
        let mut on_batch = sink();
        let started = Instant::now();
        let res = a.run_sql_stream(None, None, "SELECT pg_sleep(30)", Some(&run), &mut on_batch).await;
        run.finish().await;
        assert!(matches!(res, Err(DbError::Cancelled)), "got {res:?}");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    /// The abandon rule: a run dropped mid query gives its connection up
    /// instead of returning it busy. With a pool of ONE, a connection handed
    /// back dirty would stall the next query behind the 30 second sleep.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_abandoned_run_detaches_its_connection() {
        let a = PgAdapter::connect(&params(1)).await.unwrap();
        {
            let mut conn = RunConn::acquire(&a.pool).await.unwrap();
            let busy = sqlx::query("SELECT pg_sleep(30)").execute(&mut *conn);
            // Dropped mid query, exactly like the 3 second abandon does.
            assert!(tokio::time::timeout(Duration::from_millis(300), busy).await.is_err());
        }
        let next = tokio::time::timeout(Duration::from_secs(5), a.run_sql(None, None, "SELECT 1"))
            .await
            .expect("the pool must hand out a fresh connection, not the busy one")
            .unwrap();
        assert_eq!(next.rows, vec![vec![Some("1".to_string())]]);
    }
}

/// The read only lock (spec 0007) against a real server. All `#[ignore]`d,
/// same instance as the Stop tests: `cargo test -p dh-core -- --ignored
/// pg_read_only`.
#[cfg(test)]
mod read_only_live_tests {
    use super::*;

    fn params(read_only: bool) -> PgParams {
        let url = std::env::var("DH_TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgres://postgres@127.0.0.1:5544/dh_server_test".to_string());
        let rest = url.strip_prefix("postgres://").expect("a postgres:// url");
        let (auth, tail) = rest.split_once('@').expect("user@host in the url");
        let (user, password) = auth.split_once(':').unwrap_or((auth, ""));
        let (hostport, database) = tail.split_once('/').expect("/database in the url");
        let (host, port) = hostport.split_once(':').unwrap_or((hostport, "5432"));
        serde_json::from_value(serde_json::json!({
            "host": host, "port": port.parse::<u16>().unwrap(), "user": user,
            "password": password, "database": database, "ssl_mode": "disable",
            "read_only": read_only,
        }))
        .unwrap()
    }

    fn is_refusal<T>(res: DbResult<T>) -> bool {
        matches!(&res, Err(DbError::ReadOnly(m)) if m.starts_with(super::super::READ_ONLY_PREFIX))
    }

    /// AC-2, AC-3, AC-5, AC-14: reads work, every kind of write is refused
    /// with the typed error, and the row is still there afterwards.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_read_only_refuses_writes_and_keeps_reads() {
        let rw = PgAdapter::connect(&params(false)).await.unwrap();
        let ro = PgAdapter::connect(&params(true)).await.unwrap();
        let table = format!("dh_ro_{}", uuid::Uuid::new_v4().simple());
        rw.run_sql(None, None, &format!("CREATE TABLE {table} (id int primary key, v text)"))
            .await
            .unwrap();
        rw.run_sql(None, None, &format!("INSERT INTO {table} VALUES (1, 'a')")).await.unwrap();

        // Reads still work.
        let read = ro.run_sql(None, None, &format!("SELECT v FROM {table}")).await.unwrap();
        assert_eq!(read.rows, vec![vec![Some("a".to_string())]]);
        ro.run_sql(None, None, &format!("EXPLAIN SELECT * FROM {table}")).await.unwrap();

        // The check refuses a hand typed write, and a whole script.
        assert!(is_refusal(ro.run_sql(None, None, &format!("UPDATE {table} SET v = 'b'")).await));
        assert!(is_refusal(
            ro.run_sql(None, None, &format!("SELECT 1; DELETE FROM {table}")).await
        ));

        // Statements that could switch the lock off are refused by the check.
        for sql in [
            "SET default_transaction_read_only = off",
            "SELECT set_config('default_transaction_read_only', 'off', false)",
            "BEGIN READ WRITE",
        ] {
            assert!(is_refusal(ro.run_sql(None, None, sql).await), "{sql}");
        }

        // A write the check lets through (starts with WITH) is refused by the
        // session lock, and comes back as the typed error too.
        let cte = format!("WITH d AS (DELETE FROM {table} RETURNING *) SELECT * FROM d");
        assert!(is_refusal(ro.run_sql(None, None, &cte).await));

        // Structured writes are refused before they reach the database.
        let delete = QueryOp::Delete {
            table: table.clone(),
            match_row: [("id".to_string(), Some("1".to_string()))].into(),
        };
        assert!(is_refusal(ro.execute_op(None, None, &delete).await));
        assert!(is_refusal(ro.execute_op(None, None, &QueryOp::DropTable { table: table.clone() }).await));
        assert!(is_refusal(ro.execute_params(None, &format!("DELETE FROM {table}"), &[]).await));
        assert!(is_refusal(ro.duplicate_table(None, None, &table, "dh_ro_copy", true).await));
        assert!(is_refusal(ro.create_schema("dh_ro_schema").await));
        assert!(is_refusal(ro.drop_schema("dh_ro_schema", false).await));
        assert!(is_refusal(ro.create_database("dh_ro_db").await));
        assert!(is_refusal(ro.drop_database("dh_ro_db").await));
        assert!(is_refusal(ro.refresh_matview(None, None, "dh_ro_mv").await));

        // Nothing changed.
        let left = rw.run_sql(None, None, &format!("SELECT count(*) FROM {table}")).await.unwrap();
        assert_eq!(left.rows, vec![vec![Some("1".to_string())]]);
        rw.run_sql(None, None, &format!("DROP TABLE {table}")).await.unwrap();
    }

    /// AC-3: a pooled session on a read only connection starts with new
    /// transactions read only, whatever the SQL check says.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_read_only_sessions_start_read_only() {
        let ro = PgAdapter::connect(&params(true)).await.unwrap();
        let on = ro.run_sql(None, None, "SHOW default_transaction_read_only").await.unwrap();
        assert_eq!(on.rows, vec![vec![Some("on".to_string())]]);
        let rw = PgAdapter::connect(&params(false)).await.unwrap();
        let off = rw.run_sql(None, None, "SHOW default_transaction_read_only").await.unwrap();
        assert_eq!(off.rows, vec![vec![Some("off".to_string())]]);
    }
}
