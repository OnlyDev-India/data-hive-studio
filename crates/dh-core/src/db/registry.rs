use crate::db::MongoAdapter;
use crate::db::MongoParams;
use crate::db::PgAdapter;
use crate::db::PgParams;
use crate::db::SqliteAdapter;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use crate::api::{ConnGuard, ConnectionInfo, DbKind};
use serde_json;
use super::adapter::DbAdapter;
use super::types::{DbError, DbResult};

/// All live connections, keyed by connection id. Adapters are `Arc`-shared so
/// they can be cloned out of the registry before awaiting sqlx operations.
pub(super) struct Registry {
    connections: HashMap<String, (ConnectionInfo, Arc<dyn DbAdapter>)>,
}

static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();

fn registry() -> &'static Mutex<Registry> {
    REGISTRY.get_or_init(|| Mutex::new(Registry {
        connections: HashMap::new(),
    }))
}

/// Identity a connection's activity-log entries are filed under — stable
/// across reconnects/restarts, unlike `ConnectionInfo.id` (a fresh UUID
/// every connect, minted below in every `open_database`/`connect_*`). A
/// file path is the most precise identity available for SQLite; everything
/// else falls back to kind+name.
fn stable_conn_key(info: &ConnectionInfo) -> String {
    if info.kind == DbKind::Sqlite {
        if let Some(p) = &info.source_path {
            return format!("sqlite:{p}");
        }
    }
    let kind = serde_json::to_value(info.kind)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".to_string());
    format!("{kind}:{}", info.name)
}

/// Resolve a live `conn_id` to its stable key — registered with
/// `activity::set_conn_key_resolver` at host startup so every logged entry
/// can be matched across reconnects. `None` once the connection's gone (or,
/// briefly, before it's registered) — entries logged in that window just
/// don't get a `conn_key`, same as any pre-this-feature entry.
pub fn connection_stable_key(conn_id: &str) -> Option<String> {
    registry()
        .lock()
        .unwrap()
        .connections
        .get(conn_id)
        .map(|(info, _)| stable_conn_key(info))
}

/// Open (or create) a database and register a connection in the registry.
pub async fn open_database(
    kind: &DbKind,
    name: &str,
    bytes: Option<&[u8]>,
    guard: ConnGuard,
) -> DbResult<ConnectionInfo> {
    let t = std::time::Instant::now();
    let adapter: Arc<dyn DbAdapter> = match kind {
        DbKind::Sqlite => Arc::new(SqliteAdapter::open(name, bytes, &guard).await?),
        DbKind::Postgres => return Err(DbError::Unsupported(*kind)),
        DbKind::Mysql => return Err(DbError::Unsupported(*kind)),
        DbKind::Mongodb => return Err(DbError::Unsupported(*kind)),
        DbKind::DocumentDb => return Err(DbError::Unsupported(*kind)),
    };
    let info = ConnectionInfo {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        kind: *kind,
        source_path: None,
        guard,
    };
    // Register BEFORE logging, so the resolver can already find it and this
    // very first entry gets a `conn_key` too.
    insert_connection(info.clone(), adapter);
    crate::activity::log_ok_origin(&info.id, "connect", &format!("sqlite:{name}"), t, 0, "app");
    Ok(info)
}

/// Open a database directly at `path` and register a connection. The file on
/// disk becomes the database, so all changes persist in place automatically.
pub async fn open_database_path(path: &str, guard: ConnGuard) -> DbResult<ConnectionInfo> {
    let t = std::time::Instant::now();
    let p = std::path::Path::new(path);
    let adapter: Arc<dyn DbAdapter> = Arc::new(SqliteAdapter::open_at(p, &guard).await?);
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
        guard,
    };
    insert_connection(info.clone(), adapter);
    crate::activity::log_ok_origin(&info.id, "connect", &format!("sqlite:{}", path), t, 0, "app");
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
    // Logged BEFORE removing from the registry — the conn_key resolver
    // looks the connection up by id, and can't find one that's already
    // gone, so this would otherwise be the one entry per session that never
    // gets a `conn_key`.
    crate::activity::log_ok_origin(conn_id, "disconnect", "connection closed", t, 0, "app");
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

pub(super) async fn with_connection<T, F, Fut>(conn_id: &str, f: F) -> DbResult<T>
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

/// Connect to a PostgreSQL server and register the connection.
pub async fn connect_postgres(params: PgParams) -> DbResult<ConnectionInfo> {
    let t = std::time::Instant::now();
    let conn_id = uuid::Uuid::new_v4().to_string();
    let label = format!("{}@{}", params.user, params.database);
    match PgAdapter::connect(&params).await {
        Ok(adapter) => {
            let info = ConnectionInfo {
                id: conn_id,
                name: params.database.clone(),
                kind: DbKind::Postgres,
                source_path: None,
                guard: params.guard.clone(),
            };
            // Register BEFORE logging, so the resolver can already find it
            // and this very first entry gets a `conn_key` too.
            insert_connection(info.clone(), Arc::new(adapter) as Arc<dyn DbAdapter>);
            crate::activity::log_ok_origin(&info.id, "connect", &label, t, 0, "app");
            Ok(info)
        }
        Err(e) => {
            crate::activity::log_err_origin(&conn_id, "connect", &label, t, &e, "app");
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
            let info = ConnectionInfo {
                id: conn_id,
                name: params.database.clone(),
                kind: DbKind::Mongodb,
                source_path: None,
                guard: params.guard.clone(),
            };
            // Register BEFORE logging, so the resolver can already find it
            // and this very first entry gets a `conn_key` too.
            insert_connection(info.clone(), Arc::new(adapter) as Arc<dyn DbAdapter>);
            crate::activity::log_ok_origin(&info.id, "connect", &label, t, 0, "app");
            Ok(info)
        }
        Err(e) => {
            crate::activity::log_err_origin(&conn_id, "connect", &label, t, &e, "app");
            Err(e)
        }
    }
}
