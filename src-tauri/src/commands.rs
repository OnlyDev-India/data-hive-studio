use crate::api::{
    ConnectionInfo, DbKind, MongoDocumentsResult, MongoExtDocumentsResult, MongoRunResult,
    QueryChunk, QueryOp, QueryResult, SchemaOp, TableInfo, TableSchema,
};
use crate::db::CatalogOverview;

fn to_err(e: crate::db::DbError) -> String {
    e.to_string()
}

/// Forwards args by reference into the matching `crate::db::` function and
/// maps any `DbError` to a plain string for the IPC boundary — the shape
/// shared by most commands below. Commands that also log, wrap/transform
/// their result, pass a fixed extra argument, or set up a streaming channel
/// stay hand-written since forcing them into this shape would either lose
/// behavior or make the macro itself the thing that needs untangling.
macro_rules! forward_cmd {
    ($(#[$doc:meta])* $cmd_name:ident($($arg:ident: $ty:ty),* $(,)?) -> $ret:ty => $db_fn:ident) => {
        $(#[$doc])*
        #[tauri::command]
        pub async fn $cmd_name($($arg: $ty),*) -> Result<$ret, String> {
            crate::db::$db_fn($(&$arg),*).await.map_err(to_err)
        }
    };
}

/// Newest-first snapshot of the backend activity log (panel hydration).
#[tauri::command]
pub fn get_activity(limit: Option<usize>) -> Vec<crate::activity::ActivityEntry> {
    crate::activity::snapshot(limit.unwrap_or(200))
}

/// Wipe the activity log (panel trash button).
#[tauri::command]
pub fn clear_activity() {
    crate::activity::clear();
}

/// Open an existing database from raw bytes and register a connection.
#[tauri::command]
pub async fn connect_postgres(
    params: crate::db::PgParams,
) -> Result<ConnectionInfo, String> {
    log::info!("connecting to postgres {}:{}/{}", params.host, params.port, params.database);
    crate::db::connect_postgres(params).await.map_err(to_err)
}

/// Connect to a MongoDB server and register the connection.
#[tauri::command]
pub async fn connect_mongodb(
    params: crate::db::MongoParams,
) -> Result<ConnectionInfo, String> {
    log::info!("connecting to mongodb {}:{}/{}", params.host, params.port, params.database);
    crate::db::connect_mongodb(params).await.map_err(to_err)
}

#[tauri::command]
pub async fn open_database(name: String, bytes: Vec<u8>) -> Result<ConnectionInfo, String> {
    crate::db::open_database(&DbKind::Sqlite, &name, Some(&bytes)).await.map_err(to_err)
}

forward_cmd! {
    /// Open an existing database directly from its file path. Changes persist to
    /// that file automatically.
    open_database_path(path: String) -> ConnectionInfo => open_database_path
}

/// Remember the real file a connection should save to.
#[tauri::command]
pub fn set_database_path(conn_id: String, path: String) -> Result<(), String> {
    crate::db::set_database_path(&conn_id, &path).map_err(to_err)
}

/// Create a new, empty database and register a connection.
#[tauri::command]
pub async fn create_database(name: String) -> Result<ConnectionInfo, String> {
    crate::db::open_database(&DbKind::Sqlite, &name, None).await.map_err(to_err)
}

forward_cmd! {
    /// Close a connection and clean up its temp file.
    close_connection(conn_id: String) -> () => close_connection
}

forward_cmd! {
    /// List tables and views in the database, with row counts.
    list_tables(conn_id: String) -> Vec<TableInfo> => list_tables
}

forward_cmd! {
    /// Schemas the user can switch between on this connection (Postgres).
    list_schemas(conn_id: String) -> Vec<String> => list_schemas
}

forward_cmd! {
    /// Databases reachable with this connection's server credentials (Postgres).
    list_databases(conn_id: String) -> Vec<String> => list_databases
}

/// Fetch a page of documents from a MongoDB collection.
#[tauri::command]
pub async fn list_documents(
    conn_id: String,
    collection: String,
    filter: Option<serde_json::Value>,
    skip: u64,
    limit: u64,
) -> Result<MongoDocumentsResult, String> {
    let (docs, total) = crate::db::list_documents(&conn_id, &collection, filter, skip, limit).await.map_err(to_err)?;
    Ok(MongoDocumentsResult { documents: docs, total })
}

forward_cmd! {
    /// Replace a single MongoDB document (matched by `_id` ObjectId hex) with the
    /// document parsed from MQL extended JSON `document_text`.
    save_document(conn_id: String, collection: String, id: String, document_text: String) -> bool => save_document
}

/// Fetch a page of MongoDB documents rendered as type-aware MQL extended JSON
/// text (for the JSON editor).
#[tauri::command]
pub async fn list_documents_ext(
    conn_id: String,
    collection: String,
    filter: Option<serde_json::Value>,
    skip: u64,
    limit: u64,
) -> Result<MongoExtDocumentsResult, String> {
    let (docs, total) =
        crate::db::list_documents_ext(&conn_id, &collection, filter, skip, limit)
            .await
            .map_err(to_err)?;
    Ok(MongoExtDocumentsResult { documents: docs, total })
}

forward_cmd! {
    /// Insert a new MongoDB document parsed from MQL extended JSON `document_text`.
    insert_document(conn_id: String, collection: String, document_text: String) -> () => insert_document
}

/// Run a MongoDB console command (JSON find/aggregate or a shell-subset
/// statement) against `database`. `collection` is the console's current
/// collection, used only for bare JSON query/pipeline input.
#[tauri::command]
pub async fn run_mongo(
    conn_id: String,
    database: String,
    collection: Option<String>,
    script: String,
) -> Result<MongoRunResult, String> {
    crate::db::run_mongo(&conn_id, &database, collection.as_deref(), &script)
        .await
        .map_err(to_err)
}

forward_cmd! {
    /// Schemas + databases + active schema in one round trip (Postgres).
    catalog_overview(conn_id: String) -> CatalogOverview => catalog_overview
}

forward_cmd! {
    /// Point every unqualified operation at `schema` (Postgres).
    set_active_schema(conn_id: String, schema: String) -> () => set_active_schema
}

forward_cmd! {
    /// The schema unqualified operations currently target (Postgres).
    active_schema(conn_id: String) -> String => active_schema
}

forward_cmd! {
    /// Create a database on the same server (Postgres).
    create_pg_database(conn_id: String, name: String) -> () => create_database
}

forward_cmd! {
    /// Drop a database on the same server (Postgres).
    drop_pg_database(conn_id: String, name: String) -> () => drop_database
}

forward_cmd! {
    /// Create a schema in the active catalog (Postgres).
    create_pg_schema(conn_id: String, name: String) -> () => create_schema
}

/// Drop a schema; `cascade` also drops every object inside it (Postgres).
#[tauri::command]
pub async fn drop_pg_schema(
    conn_id: String,
    name: String,
    cascade: bool,
) -> Result<(), String> {
    crate::db::drop_schema(&conn_id, &name, cascade).await.map_err(to_err)
}

forward_cmd! {
    /// Refresh a materialized view (Postgres).
    refresh_matview(conn_id: String, name: String) -> () => refresh_matview
}

forward_cmd! {
    /// Fetch the schema (columns, FKs, indexes) for a table.
    table_schema(conn_id: String, table: String) -> TableSchema => table_schema
}

forward_cmd! {
    /// Run arbitrary SQL. Returns rows for SELECT, affected count for DML/DDL.
    run_sql(conn_id: String, sql: String) -> QueryResult => run_sql
}

forward_cmd! {
    /// Execute a single DML/DDL statement with bound `?` parameters.
    execute_params(conn_id: String, sql: String, params: Vec<Option<String>>) -> u64 => execute_params
}

forward_cmd! {
    /// Run a SELECT with bound `?` parameters (used by UI-built filters).
    run_sql_params(conn_id: String, sql: String, params: Vec<Option<String>>) -> QueryResult => run_sql_params
}

forward_cmd! {
    /// Run a structured operation (select/count/insert/update/delete/...). The
    /// connection's adapter builds the actual SQL from the details — the frontend
    /// never writes SQL for these operations.
    execute_op(conn_id: String, op: QueryOp) -> QueryResult => execute_op
}

/// Streaming variant of [`execute_op`]: SELECT-shaped ops push row batches
/// through the channel as they come back so the UI can render early. The
/// resolved result carries every field except rows.
#[tauri::command]
pub async fn execute_op_stream(
    conn_id: String,
    op: QueryOp,
    channel: tauri::ipc::Channel<QueryChunk>,
) -> Result<QueryResult, String> {
    crate::db::execute_op_stream(&conn_id, &op, move |chunk| {
        channel
            .send(chunk)
            .map_err(|e| crate::db::DbError::InvalidOperation(format!("ipc send failed: {e}")))
    })
    .await
    .map_err(to_err)
}

/// Streaming variant of [`run_sql`]: SELECT-shaped statements push row
/// batches through the channel as they come back. The resolved result
/// carries every field except rows.
#[tauri::command]
pub async fn run_sql_stream(
    conn_id: String,
    sql: String,
    channel: tauri::ipc::Channel<QueryChunk>,
) -> Result<QueryResult, String> {
    crate::db::run_sql_stream(&conn_id, &sql, move |chunk| {
        channel
            .send(chunk)
            .map_err(|e| crate::db::DbError::InvalidOperation(format!("ipc send failed: {e}")))
    })
    .await
    .map_err(to_err)
}

forward_cmd! {
    /// Serialize the database back to bytes for save.
    save_database(conn_id: String) -> Vec<u8> => save_database
}

forward_cmd! {
    /// Duplicate a table (structure + indexes + data) under a new name; returns
    /// the statements that ran.
    duplicate_table(conn_id: String, source: String, target: String) -> Vec<String> => duplicate_table
}

forward_cmd! {
    /// Apply staged schema (DDL) ops in order; returns every statement that ran.
    apply_schema_ops(conn_id: String, ops: Vec<SchemaOp>) -> Vec<String> => apply_schema_ops
}

/// Read a file from disk as raw bytes (opened via the native dialog).
#[tauri::command]
pub fn read_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

/// Write raw bytes to a file (chosen via the native save dialog).
#[tauri::command]
pub fn write_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}
