//! Database layer for the Tauri backend.
//!
//! Every connection works against a temporary file so the file can always be
//! serialized back for download. Connections are held in a process-wide
//! registry keyed by a connection id.

mod mongo_json;
mod mongo_sql;
mod mongodb;
mod postgres;
mod sqlite;

pub use mongo_json::{parse as parse_mongo_json, render as render_mongo_json};
pub use mongodb::{MongoAdapter, MongoParams};
pub use postgres::{PgAdapter, PgParams};

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use async_trait::async_trait;

use crate::api::{
    ConnectionInfo, DbKind, MongoRunResult, QueryChunk, QueryOp, QueryResult, SchemaOp, TableInfo,
    TableSchema,
};
use serde_json;

pub use self::sqlite::SqliteAdapter;

/// Sink receiving streamed row batches during SELECT-shaped operations.
pub type BatchSink<'a> = &'a mut (dyn FnMut(QueryChunk) -> DbResult<()> + Send);

/// An error produced by the database layer.
#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("no open connection for id '{0}'")]
    NotFound(String),
    #[error("unsupported database kind: {0:?}")]
    Unsupported(DbKind),
    #[error("{0}")]
    InvalidOperation(String),
    /// Shared by every `sqlx`-backed adapter (SQLite, Postgres) — not
    /// SQLite-specific despite the underlying crate name.
    #[error("{0}")]
    SqlEngine(#[from] sqlx::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type DbResult<T> = std::result::Result<T, DbError>;

/// A statement an adapter built from a [`QueryOp`]: dialect SQL plus its
/// bound `?` parameters.
pub struct BuiltQuery {
    pub sql: String,
    pub params: Vec<Option<String>>,
}

/// An executed structured operation plus the exact SQL that ran. The SQL
/// rides along with the result (NOT in shared adapter state) so concurrent
/// operations can never capture each other's statements for the activity log.
pub struct OpOutcome {
    pub result: QueryResult,
    pub sql: Option<String>,
}

/// Sidebar bootstrap data for one Postgres connection, fetched in a single
/// catalog round trip.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CatalogOverview {
    pub schemas: Vec<String>,
    pub databases: Vec<String>,
    pub active_schema: String,
}


/// One database family's driver: connection handling plus every operation
/// the UI can perform. SQLite ships as the built-in adapter; other engines
/// implement the same surface (see `postgres.rs`).
#[async_trait]
pub trait DbAdapter: Send + Sync {
    async fn list_tables(&self) -> DbResult<Vec<TableInfo>>;
    /// Column/FK/index/trigger metadata plus every introspection statement
    /// executed to gather it (for the activity log's full-SQL view).
    async fn table_schema(&self, table: &str) -> DbResult<(TableSchema, Vec<String>)>;
    async fn run_sql(&self, sql: &str) -> DbResult<QueryResult>;
    async fn execute_params(&self, sql: &str, params: &[Option<String>]) -> DbResult<u64>;
    async fn run_sql_params(&self, sql: &str, params: &[Option<String>]) -> DbResult<QueryResult>;
    async fn execute_op(&self, op: &QueryOp) -> DbResult<OpOutcome>;
    async fn execute_op_stream(
        &self,
        op: &QueryOp,
        on_batch: BatchSink<'_>,
    ) -> DbResult<OpOutcome>;
    async fn run_sql_stream(&self, sql: &str, on_batch: BatchSink<'_>) -> DbResult<QueryResult>;
    async fn apply_schema_ops_batch(&self, ops: &[SchemaOp]) -> DbResult<Vec<String>>;
    /// Duplicate a table; returns the statements that ran (activity log).
    async fn duplicate_table(&self, source: &str, target: &str) -> DbResult<Vec<String>> {
        let _ = (source, target);
        Err(DbError::InvalidOperation(
            "duplicate table is not supported by this adapter".into(),
        ))
    }
    /// Refresh a materialized view (Postgres).
    async fn refresh_matview(&self, _name: &str) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "refreshing materialized views is not supported by this adapter".into(),
        ))
    }
    /// Schemas the user can switch between (Postgres namespaces). Engines
    /// without schema support report their single implicit one.
    async fn list_schemas(&self) -> DbResult<Vec<String>> {
        Err(DbError::InvalidOperation(
            "schema browsing is not supported by this adapter".into(),
        ))
    }
    /// Databases reachable with the same server credentials (Postgres
    /// `pg_database`). Engines without a server report just themselves.
    async fn list_databases(&self) -> DbResult<Vec<String>> {
        Err(DbError::InvalidOperation(
            "database listing is not supported by this adapter".into(),
        ))
    }
    /// Fetch a page of documents from a collection (MongoDB).
    async fn list_documents(
        &self,
        _collection: &str,
        _filter: Option<serde_json::Value>,
        _skip: u64,
        _limit: u64,
    ) -> DbResult<(Vec<serde_json::Value>, u64)> {
        Err(DbError::InvalidOperation(
            "document listing is not supported by this adapter".into(),
        ))
    }
    /// Fetch a page of documents rendered as type-aware MQL extended JSON
    /// text (used by the JSON editor). MongoDB only.
    async fn list_documents_ext(
        &self,
        _collection: &str,
        _filter: Option<serde_json::Value>,
        _skip: u64,
        _limit: u64,
    ) -> DbResult<(Vec<String>, u64)> {
        Err(DbError::InvalidOperation(
            "extended document listing is not supported by this adapter".into(),
        ))
    }
    /// Replace the document matching `id` (an ObjectId hex string) with the
    /// document parsed from `document_text` (MQL extended JSON). MongoDB only.
    async fn save_document(
        &self,
        _collection: &str,
        _id: &str,
        _document_text: &str,
    ) -> DbResult<bool> {
        Err(DbError::InvalidOperation(
            "document editing is not supported by this adapter".into(),
        ))
    }
    /// Insert a new document parsed from `document_text` (MQL extended JSON).
    /// MongoDB only.
    async fn insert_document(
        &self,
        _collection: &str,
        _document_text: &str,
    ) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "document insertion is not supported by this adapter".into(),
        ))
    }
    /// Run a MongoDB console command (a JSON find/aggregate or a shell-subset
    /// statement) against database `db`, with an optional current `collection`
    /// for bare JSON queries. Non-Mongo adapters reject it.
    async fn run_mongo(
        &self,
        _db: &str,
        _collection: Option<&str>,
        _script: &str,
    ) -> DbResult<MongoRunResult> {
        Err(DbError::InvalidOperation(
            "Mongo console commands are only available on MongoDB connections".into(),
        ))
    }
    /// Schemas + databases + active schema in ONE round trip — the sidebar
    /// opens with a single catalog wait instead of three back-to-back ones
    /// (which on remote servers queued every later query behind them).
    async fn catalog_overview(&self) -> DbResult<CatalogOverview> {
        Err(DbError::InvalidOperation(
            "catalog overview is not supported by this adapter".into(),
        ))
    }
    /// Point every unqualified operation at `schema`.
    async fn set_active_schema(&self, _schema: &str) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "switching schemas is not supported by this adapter".into(),
        ))
    }
    async fn active_schema(&self) -> DbResult<String> {
        Err(DbError::InvalidOperation(
            "active schema is not supported by this adapter".into(),
        ))
    }
    /// Create a new database on the same server (Postgres). Engines without
    /// server-side catalogs don't support it.
    async fn create_database(&self, _name: &str) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "creating databases is not supported by this adapter".into(),
        ))
    }
    /// Drop a database on the same server. Dropping the database this
    /// connection is attached to is rejected by the server itself.
    async fn drop_database(&self, _name: &str) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "dropping databases is not supported by this adapter".into(),
        ))
    }
    /// Create a schema in the active catalog.
    async fn create_schema(&self, _name: &str) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "creating schemas is not supported by this adapter".into(),
        ))
    }
    /// Drop a schema; `cascade` also drops every object inside it.
    async fn drop_schema(&self, _name: &str, _cascade: bool) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "dropping schemas is not supported by this adapter".into(),
        ))
    }
    /// Storage-only concepts for file-backed adapters (WAL merge, byte export).
    /// Network adapters never override these.
    async fn checkpoint(&self) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "checkpoint is not supported by this adapter".into(),
        ))
    }
    async fn save_bytes(&self) -> DbResult<Vec<u8>> {
        Err(DbError::InvalidOperation(
            "saving to bytes is not supported by this adapter".into(),
        ))
    }
    /// Release pools/handles and perform adapter-specific cleanup.
    async fn close(self: Arc<Self>);
}

/// All live connections, keyed by connection id. Adapters are `Arc`-shared so
/// they can be cloned out of the registry before awaiting sqlx operations.
struct Registry {
    connections: HashMap<String, (ConnectionInfo, Arc<dyn DbAdapter>)>,
}

static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();

fn registry() -> &'static Mutex<Registry> {
    REGISTRY.get_or_init(|| Mutex::new(Registry {
        connections: HashMap::new(),
    }))
}

/// Open (or create) a database and register a connection in the registry.
pub async fn open_database(
    kind: &DbKind,
    name: &str,
    bytes: Option<&[u8]>,
) -> DbResult<ConnectionInfo> {
    let t = std::time::Instant::now();
    let adapter: Arc<dyn DbAdapter> = match kind {
        DbKind::Sqlite => Arc::new(SqliteAdapter::open(name, bytes).await?),
        DbKind::Postgres => return Err(DbError::Unsupported(*kind)),
        DbKind::Mysql => return Err(DbError::Unsupported(*kind)),
        DbKind::Mongodb => return Err(DbError::Unsupported(*kind)),
    };
    let info = ConnectionInfo {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        kind: *kind,
        source_path: None,
    };
    crate::activity::log_ok(&info.id, "connect", &format!("sqlite:{name}"), t, 0);
    insert_connection(info.clone(), adapter);
    Ok(info)
}

/// Open a database directly at `path` and register a connection. The file on
/// disk becomes the database, so all changes persist in place automatically.
pub async fn open_database_path(path: &str) -> DbResult<ConnectionInfo> {
    let t = std::time::Instant::now();
    let p = std::path::Path::new(path);
    let adapter: Arc<dyn DbAdapter> = Arc::new(SqliteAdapter::open_at(p).await?);
    let name = p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("database")
        .to_string();
    let info = ConnectionInfo {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        kind: DbKind::Sqlite,
        source_path: Some(path.to_string()),
    };
    crate::activity::log_ok(&info.id, "connect", &format!("sqlite:{}", path), t, 0);
    insert_connection(info.clone(), adapter);
    Ok(info)
}

/// Remember the real file a connection should save to (set after the user
/// exports a newly-created database for the first time). Subsequent saves then
/// write to that path without asking again.
pub fn set_database_path(conn_id: &str, path: &str) -> DbResult<()> {
    let mut reg = registry().lock().unwrap();
    if let Some((info, _)) = reg.connections.get_mut(conn_id) {
        info.source_path = Some(path.to_string());
    }
    Ok(())
}

fn insert_connection(info: ConnectionInfo, adapter: Arc<dyn DbAdapter>) {
    registry()
        .lock()
        .unwrap()
        .connections
        .insert(info.id.clone(), (info, adapter));
}

/// Close a connection, merge any pending WAL changes into the database file,
/// and clean up the WAL/shared-memory side files. Real user files are never
/// deleted — only temp copies for freshly-created databases.
pub async fn close_connection(conn_id: &str) -> DbResult<()> {
    let t = std::time::Instant::now();
    let adapter = registry()
        .lock()
        .unwrap()
        .connections
        .remove(conn_id)
        .map(|(_, a)| a);
    if let Some(adapter) = adapter {
        // Adapter-specific teardown: WAL merge + file cleanup for SQLite,
        // plain pool close for network databases.
        adapter.close().await;
    }
    crate::activity::log_ok(conn_id, "disconnect", "connection closed", t, 0);
    Ok(())
}

/// Close every live connection — called on desktop app shutdown so PG pools
/// are dropped cleanly instead of relying on process exit.
pub async fn close_all() {
    let adapters: Vec<Arc<dyn DbAdapter>> = registry()
        .lock()
        .unwrap()
        .connections
        .drain()
        .map(|(_, (_, a))| a)
        .collect();
    for a in adapters {
        a.close().await;
    }
}

async fn with_connection<T, F, Fut>(conn_id: &str, f: F) -> DbResult<T>
where
    F: FnOnce(Arc<dyn DbAdapter>) -> Fut,
    Fut: std::future::Future<Output = DbResult<T>>,
{
    let adapter = registry()
        .lock()
        .unwrap()
        .connections
        .get(conn_id)
        .map(|(_, a)| a.clone())
        .ok_or_else(|| DbError::NotFound(conn_id.to_string()))?;
    f(adapter).await
}

/// Rows metric for the activity log: returned rows for reads, affected rows
/// for writes.
fn activity_rows(r: &QueryResult) -> i64 {
    if r.is_select {
        r.rows.len() as i64
    } else {
        r.rows_affected as i64
    }
}

/// Render one bound parameter as an inline SQL literal for the activity
/// log's full-statement view (`VALUES ('O''Brien', 42)` instead of ($1,$2)).
pub(crate) fn sql_literal(v: Option<&str>) -> String {
    match v {
        None => "NULL".to_string(),
        Some(s) => {
            if s.is_empty() {
                return "''".to_string();
            }
            // Numbers stay bare; everything else becomes an escaped string.
            if s.parse::<i64>().is_ok() || s.parse::<f64>().is_ok() {
                return s.to_string();
            }
            format!("'{}'", s.replace('\'', "''"))
        }
    }
}

/// Substitute bound parameters into rendered SQL for display only — never
/// executed. `dollar` selects $1..$n (Postgres) vs sequential `?` (SQLite).
pub(crate) fn inline_placeholders(sql: &str, params: &[Option<String>], dollar: bool) -> String {
    if params.is_empty() {
        return sql.to_string();
    }
    let mut out = String::with_capacity(sql.len());
    let mut qi = 0usize;
    let mut it = sql.chars().peekable();
    while let Some(c) = it.next() {
        if !dollar && c == '?' && qi < params.len() {
            out.push_str(&sql_literal(params[qi].as_deref()));
            qi += 1;
            continue;
        }
        if dollar && c == '$' {
            let mut num = String::new();
            while let Some(d) = it.peek() {
                if d.is_ascii_digit() {
                    num.push(*d);
                    it.next();
                } else {
                    break;
                }
            }
            if let Ok(n) = num.parse::<usize>() {
                if n >= 1 && n <= params.len() {
                    out.push_str(&sql_literal(params[n - 1].as_deref()));
                    continue;
                }
            }
            if !num.is_empty() {
                out.push('$');
                out.push_str(&num);
            } else {
                out.push('$');
            }
            continue;
        }
        // Don't touch placeholders inside quoted literals.
        if c == '\'' {
            out.push(c);
            for c2 in it.by_ref() {
                out.push(c2);
                if c2 == '\'' {
                    break;
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

pub async fn list_tables(conn_id: &str) -> DbResult<Vec<TableInfo>> {
    with_connection(conn_id, |a| async move { a.list_tables().await }).await
}

/// Schemas the user can switch between on this connection.
pub async fn list_schemas(conn_id: &str) -> DbResult<Vec<String>> {
    with_connection(conn_id, |a| async move { a.list_schemas().await }).await
}

/// Databases reachable with this connection's server credentials.
pub async fn list_databases(conn_id: &str) -> DbResult<Vec<String>> {
    with_connection(conn_id, |a| async move { a.list_databases().await }).await
}

/// Fetch a page of documents from a MongoDB collection.
pub async fn list_documents(
    conn_id: &str,
    collection: &str,
    filter: Option<serde_json::Value>,
    skip: u64,
    limit: u64,
) -> DbResult<(Vec<serde_json::Value>, u64)> {
    with_connection(conn_id, |a| async move {
        a.list_documents(collection, filter, skip, limit).await
    })
    .await
}

/// Fetch a page of documents rendered as type-aware MQL extended JSON text.
pub async fn list_documents_ext(
    conn_id: &str,
    collection: &str,
    filter: Option<serde_json::Value>,
    skip: u64,
    limit: u64,
) -> DbResult<(Vec<String>, u64)> {
    with_connection(conn_id, |a| async move {
        a.list_documents_ext(collection, filter, skip, limit).await
    })
    .await
}

/// Replace a single MongoDB document by its `_id` (ObjectId hex string) with
/// the document parsed from `document_text` (MQL extended JSON).
pub async fn save_document(
    conn_id: &str,
    collection: &str,
    id: &str,
    document_text: &str,
) -> DbResult<bool> {
    with_connection(conn_id, |a| async move {
        a.save_document(collection, id, document_text).await
    })
    .await
}

/// Insert a new MongoDB document parsed from `document_text`.
pub async fn insert_document(
    conn_id: &str,
    collection: &str,
    document_text: &str,
) -> DbResult<()> {
    with_connection(conn_id, |a| async move {
        a.insert_document(collection, document_text).await
    })
    .await
}

/// Run a MongoDB console command (JSON find/aggregate or a shell-subset
/// statement) against database `db`. `collection` is the console's current
/// collection, used only for bare JSON query/pipeline input.
pub async fn run_mongo(
    conn_id: &str,
    db: &str,
    collection: Option<&str>,
    script: &str,
) -> DbResult<MongoRunResult> {
    with_connection(conn_id, |a| async move {
        a.run_mongo(db, collection, script).await
    })
    .await
}

/// Schemas + databases + active schema in ONE catalog round trip.
pub async fn catalog_overview(conn_id: &str) -> DbResult<CatalogOverview> {
    with_connection(conn_id, |a| async move { a.catalog_overview().await }).await
}

/// Runs a single-name, no-result operation through `with_connection` and logs
/// success/failure to the activity log — the shape shared by every simple
/// server-catalog DDL op below (only the adapter method, activity kind, and
/// target label text differ per call).
macro_rules! named_ddl_op {
    ($fn_name:ident, $adapter_method:ident, $kind:literal, $target_fmt:literal) => {
        pub async fn $fn_name(conn_id: &str, name: &str) -> DbResult<()> {
            let t = std::time::Instant::now();
            let target = format!($target_fmt, name);
            let name = name.to_string();
            let res = with_connection(conn_id, move |a| async move {
                a.$adapter_method(&name).await
            })
            .await;
            match &res {
                Ok(()) => crate::activity::log_ok(conn_id, $kind, &target, t, 0),
                Err(e) => crate::activity::log_err(conn_id, $kind, &target, t, e),
            }
            res
        }
    };
}

named_ddl_op!(create_database, create_database, "ddl", "CREATE DATABASE {}");
named_ddl_op!(drop_database, drop_database, "drop_table", "DROP DATABASE {}");
named_ddl_op!(create_schema, create_schema, "ddl", "CREATE SCHEMA {}");
named_ddl_op!(set_active_schema, set_active_schema, "schema", "SET SCHEMA {}");
named_ddl_op!(refresh_matview, refresh_matview, "ddl", "REFRESH MATERIALIZED VIEW {}");

/// Drop a schema; `cascade` also drops every object inside it.
pub async fn drop_schema(conn_id: &str, name: &str, cascade: bool) -> DbResult<()> {
    let t = std::time::Instant::now();
    let target = format!("DROP SCHEMA {}{}", name, if cascade { " CASCADE" } else { "" });
    let name = name.to_string();
    let res = with_connection(conn_id, move |a| async move {
        a.drop_schema(&name, cascade).await
    })
    .await;
    match &res {
        Ok(()) => crate::activity::log_ok(conn_id, "drop_table", &target, t, 0),
        Err(e) => crate::activity::log_err(conn_id, "drop_table", &target, t, e),
    }
    res
}

/// The schema unqualified operations currently target.
pub async fn active_schema(conn_id: &str) -> DbResult<String> {
    with_connection(conn_id, |a| async move { a.active_schema().await }).await
}

pub async fn table_schema(conn_id: &str, table: &str) -> DbResult<TableSchema> {
    let t = std::time::Instant::now();
    let target = format!("describe {table}");
    let table = table.to_string();
    // The adapter hands back its introspection statements with the schema —
    // per-call ownership, so concurrent describes can't interleave captures.
    let res = with_connection(conn_id, move |a| async move { a.table_schema(&table).await })
        .await;
    match &res {
        Ok((_, stmts)) if !stmts.is_empty() => {
            crate::activity::log_stmt_ok(conn_id, "schema", &stmts.join("\n\n"), t, 0)
        }
        Ok(_) => crate::activity::log_ok(conn_id, "schema", &target, t, 0),
        Err(e) => crate::activity::log_err(conn_id, "schema", &target, t, e),
    }
    res.map(|(schema, _)| schema)
}

pub async fn run_sql(conn_id: &str, sql: &str) -> DbResult<QueryResult> {
    let t = std::time::Instant::now();
    // Owned copy for the activity log — the closure below consumes a clone.
    let full_sql = sql.to_string();
    let sql = full_sql.clone();
    let res = with_connection(conn_id, move |a| async move { a.run_sql(&sql).await }).await;
    match &res {
        Ok(r) => crate::activity::log_stmt_ok(conn_id, "sql", &full_sql, t, activity_rows(r)),
        Err(e) => crate::activity::log_stmt_err(conn_id, "sql", &full_sql, t, e),
    }
    res
}

pub async fn execute_params(conn_id: &str, sql: &str, params: &[Option<String>]) -> DbResult<u64> {
    let t = std::time::Instant::now();
    let full_sql = sql.to_string();
    let sql = full_sql.clone();
    let params: Vec<Option<String>> = params.to_vec();
    let res =
        with_connection(conn_id, move |a| async move { a.execute_params(&sql, &params).await })
            .await;
    match &res {
        Ok(n) => crate::activity::log_stmt_ok(conn_id, "sql", &full_sql, t, *n as i64),
        Err(e) => crate::activity::log_stmt_err(conn_id, "sql", &full_sql, t, e),
    }
    res
}

/// Run a SELECT with bound parameters (used by UI-built filters).
pub async fn run_sql_params(
    conn_id: &str,
    sql: &str,
    params: &[Option<String>],
) -> DbResult<QueryResult> {
    let t = std::time::Instant::now();
    let full_sql = sql.to_string();
    let sql = full_sql.clone();
    let params: Vec<Option<String>> = params.to_vec();
    let res = with_connection(conn_id, move |a| async move { a.run_sql_params(&sql, &params).await })
        .await;
    match &res {
        Ok(r) => crate::activity::log_stmt_ok(conn_id, "sql", &full_sql, t, activity_rows(r)),
        Err(e) => crate::activity::log_stmt_err(conn_id, "sql", &full_sql, t, e),
    }
    res
}

/// Run a structured operation. The connection's adapter turns the details
/// into dialect SQL (the single place query creation happens) and executes
/// it, returning rows for reads and the affected count for writes.
/// Coarse (kind, target) labels for the activity log, derived from the op.
fn op_label(op: &QueryOp) -> (&'static str, String) {
    match op {
        QueryOp::Select { table, .. } => ("select", format!("SELECT {table}")),
        QueryOp::Count { table, .. } => ("count", format!("COUNT {table}")),
        QueryOp::SelectDistinct { table, column, .. } => {
            ("distinct", format!("DISTINCT {table}.{column}"))
        }
        QueryOp::Insert { table, values, .. } => (
            "insert",
            format!("INSERT {table} ({} cols)", values.len()),
        ),
        QueryOp::Update { table, set, .. } => (
            "update",
            format!(
                "UPDATE {table} SET {}",
                set.keys().cloned().collect::<Vec<_>>().join(", ")
            ),
        ),
        QueryOp::Delete { table, .. } => ("delete", format!("DELETE {table}")),
        QueryOp::DropTable { table } => ("drop_table", format!("DROP TABLE {table}")),
    }
}

pub async fn execute_op(conn_id: &str, op: &QueryOp) -> DbResult<QueryResult> {
    let t = std::time::Instant::now();
    let (kind, target) = op_label(op);
    let op = op.clone();
    let res = with_connection(conn_id, move |a| async move { a.execute_op(&op).await }).await;
    match &res {
        Ok(outcome) => match &outcome.sql {
            Some(sql) => {
                crate::activity::log_stmt_ok(conn_id, kind, sql, t, activity_rows(&outcome.result))
            }
            None => crate::activity::log_ok(
                conn_id,
                kind,
                &target,
                t,
                activity_rows(&outcome.result),
            ),
        },
        Err(e) => crate::activity::log_err(conn_id, kind, &target, t, e),
    }
    res.map(|outcome| outcome.result)
}

/// Streaming variant of [`execute_op`]: SELECT-shaped ops push row batches
/// through `on_batch` as they arrive; the returned result omits rows (the
/// caller assembles those from the chunks). Writes never touch the channel.
pub async fn execute_op_stream(
    conn_id: &str,
    op: &QueryOp,
    on_batch: impl FnMut(QueryChunk) -> DbResult<()> + Send,
) -> DbResult<QueryResult> {
    let t = std::time::Instant::now();
    let (kind, target) = op_label(op);
    let op = op.clone();
    let mut sink = on_batch;
    let res = with_connection(conn_id, move |a| async move {
        a.execute_op_stream(&op, &mut sink).await
    })
    .await;
    match &res {
        // Streamed rows never land in the result — log 0 and rely on duration.
        Ok(outcome) => match &outcome.sql {
            Some(sql) => crate::activity::log_stmt_ok(conn_id, kind, sql, t, 0),
            None => crate::activity::log_ok(conn_id, kind, &target, t, 0),
        },
        Err(e) => crate::activity::log_err(conn_id, kind, &target, t, e),
    }
    res.map(|outcome| outcome.result)
}

/// Streaming variant of [`run_sql`]: SELECT-shaped statements push row
/// batches through `on_batch`; the returned result omits rows. Other
/// statements run normally and never touch the channel.
pub async fn run_sql_stream(
    conn_id: &str,
    sql: &str,
    on_batch: impl FnMut(QueryChunk) -> DbResult<()> + Send,
) -> DbResult<QueryResult> {
    let t = std::time::Instant::now();
    let full_sql = sql.to_string();
    let sql = full_sql.clone();
    let mut sink = on_batch;
    let res = with_connection(conn_id, move |a| async move {
        a.run_sql_stream(&sql, &mut sink).await
    })
    .await;
    match &res {
        Ok(r) => crate::activity::log_stmt_ok(conn_id, "sql", &full_sql, t, activity_rows(r)),
        Err(e) => crate::activity::log_stmt_err(conn_id, "sql", &full_sql, t, e),
    }
    res
}

pub async fn save_database(conn_id: &str) -> DbResult<Vec<u8>> {
    let conn_id = conn_id.to_string();
    with_connection(&conn_id, |a| async move { a.save_bytes().await }).await
}

/// Duplicate a table (structure + indexes + data) under a new name.
pub async fn duplicate_table(conn_id: &str, source: &str, target: &str) -> DbResult<Vec<String>> {
    let t = std::time::Instant::now();
    let label = format!("{source} → {target}");
    let source = source.to_string();
    let target = target.to_string();
    let res = with_connection(conn_id, move |a| async move {
        a.duplicate_table(&source, &target).await
    })
    .await;
    match &res {
        // The adapter returns every statement it ran — one entry, its own SQL.
        Ok(stmts) if !stmts.is_empty() => {
            crate::activity::log_stmt_ok(conn_id, "duplicate", &format!("{};", stmts.join("\n\n")), t, 0)
        }
        Ok(_) => crate::activity::log_ok(conn_id, "duplicate", &label, t, 0),
        Err(e) => crate::activity::log_err(conn_id, "duplicate", &label, t, e),
    }
    res
}

/// Apply staged schema (DDL) ops as ONE transaction — all statements commit
/// together, or a failure on any op rolls the whole batch back. Returns every
/// statement that ran so the UI can show/copy what happened.
pub async fn apply_schema_ops(conn_id: &str, ops: &[SchemaOp]) -> DbResult<Vec<String>> {
    let t = std::time::Instant::now();
    let target = format!("{} DDL statement(s)", ops.len());
    let ops = ops.to_vec();
    let res = with_connection(conn_id, move |a| async move {
        a.apply_schema_ops_batch(&ops).await
    })
    .await;
    match &res {
        // The batch already returns every executed statement — log them all.
        Ok(stmts) if !stmts.is_empty() => {
            crate::activity::log_stmt_ok(conn_id, "ddl", &format!("{};", stmts.join(";\n")), t, stmts.len() as i64)
        }
        Ok(_) => crate::activity::log_ok(conn_id, "ddl", &target, t, 0),
        Err(e) => crate::activity::log_err(conn_id, "ddl", &target, t, e),
    }
    res
}
/// Connect to a PostgreSQL server and register the connection.
pub async fn connect_postgres(params: PgParams) -> DbResult<ConnectionInfo> {
    let t = std::time::Instant::now();
    let conn_id = uuid::Uuid::new_v4().to_string();
    let label = format!("{}@{}", params.user, params.database);
    match PgAdapter::connect(&params).await {
        Ok(adapter) => {
            crate::activity::log_ok(&conn_id, "connect", &label, t, 0);
            let info = ConnectionInfo {
                id: conn_id,
                name: params.database.clone(),
                kind: DbKind::Postgres,
                source_path: None,
            };
            insert_connection(info.clone(), Arc::new(adapter) as Arc<dyn DbAdapter>);
            Ok(info)
        }
        Err(e) => {
            crate::activity::log_err(&conn_id, "connect", &label, t, &e);
            Err(e)
        }
    }
}

/// Connect to a MongoDB server and register the connection.
pub async fn connect_mongodb(params: MongoParams) -> DbResult<ConnectionInfo> {
    let t = std::time::Instant::now();
    let conn_id = uuid::Uuid::new_v4().to_string();
    let label = format!("{}@{}/{}", params.user, params.host, params.database);
    match MongoAdapter::connect(&params).await {
        Ok(adapter) => {
            crate::activity::log_ok(&conn_id, "connect", &label, t, 0);
            let info = ConnectionInfo {
                id: conn_id,
                name: params.database.clone(),
                kind: DbKind::Mongodb,
                source_path: None,
            };
            insert_connection(info.clone(), Arc::new(adapter) as Arc<dyn DbAdapter>);
            Ok(info)
        }
        Err(e) => {
            crate::activity::log_err(&conn_id, "connect", &label, t, &e);
            Err(e)
        }
    }
}
