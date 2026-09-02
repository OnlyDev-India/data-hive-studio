use crate::api::{
    ConnectionInfo, DbKind, MongoDocumentsResult, MongoExtDocumentsResult, MongoRunResult,
    QueryChunk, QueryOp, QueryResult, SchemaOp, TableInfo, TableSchema,
};
use crate::db::CatalogOverview;

fn to_err(e: crate::db::DbError) -> String {
    e.to_string()
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

/// Open an existing database directly from its file path. Changes persist to
/// that file automatically.
#[tauri::command]
pub async fn open_database_path(path: String) -> Result<ConnectionInfo, String> {
    crate::db::open_database_path(&path).await.map_err(to_err)
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

/// Close a connection and clean up its temp file.
#[tauri::command]
pub async fn close_connection(conn_id: String) -> Result<(), String> {
    crate::db::close_connection(&conn_id).await.map_err(to_err)
}

/// List tables and views in the database, with row counts.
#[tauri::command]
pub async fn list_tables(conn_id: String) -> Result<Vec<TableInfo>, String> {
    crate::db::list_tables(&conn_id).await.map_err(to_err)
}

/// Schemas the user can switch between on this connection (Postgres).
#[tauri::command]
pub async fn list_schemas(conn_id: String) -> Result<Vec<String>, String> {
    crate::db::list_schemas(&conn_id).await.map_err(to_err)
}

/// Databases reachable with this connection's server credentials (Postgres).
#[tauri::command]
pub async fn list_databases(conn_id: String) -> Result<Vec<String>, String> {
    crate::db::list_databases(&conn_id).await.map_err(to_err)
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

/// Replace a single MongoDB document (matched by `_id` ObjectId hex) with the
/// document parsed from MQL extended JSON `document_text`.
#[tauri::command]
pub async fn save_document(
    conn_id: String,
    collection: String,
    id: String,
    document_text: String,
) -> Result<bool, String> {
    crate::db::save_document(&conn_id, &collection, &id, &document_text)
        .await
        .map_err(to_err)
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

/// Insert a new MongoDB document parsed from MQL extended JSON `document_text`.
#[tauri::command]
pub async fn insert_document(
    conn_id: String,
    collection: String,
    document_text: String,
) -> Result<(), String> {
    crate::db::insert_document(&conn_id, &collection, &document_text)
        .await
        .map_err(to_err)
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

/// Schemas + databases + active schema in one round trip (Postgres).
#[tauri::command]
pub async fn catalog_overview(conn_id: String) -> Result<CatalogOverview, String> {
    crate::db::catalog_overview(&conn_id).await.map_err(to_err)
}

/// Point every unqualified operation at `schema` (Postgres).
#[tauri::command]
pub async fn set_active_schema(conn_id: String, schema: String) -> Result<(), String> {
    crate::db::set_active_schema(&conn_id, &schema).await.map_err(to_err)
}

/// The schema unqualified operations currently target (Postgres).
#[tauri::command]
pub async fn active_schema(conn_id: String) -> Result<String, String> {
    crate::db::active_schema(&conn_id).await.map_err(to_err)
}

/// Create a database on the same server (Postgres).
#[tauri::command]
pub async fn create_pg_database(conn_id: String, name: String) -> Result<(), String> {
    crate::db::create_database(&conn_id, &name).await.map_err(to_err)
}

/// Drop a database on the same server (Postgres).
#[tauri::command]
pub async fn drop_pg_database(conn_id: String, name: String) -> Result<(), String> {
    crate::db::drop_database(&conn_id, &name).await.map_err(to_err)
}

/// Create a schema in the active catalog (Postgres).
#[tauri::command]
pub async fn create_pg_schema(conn_id: String, name: String) -> Result<(), String> {
    crate::db::create_schema(&conn_id, &name).await.map_err(to_err)
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

/// Refresh a materialized view (Postgres).
#[tauri::command]
pub async fn refresh_matview(conn_id: String, name: String) -> Result<(), String> {
    crate::db::refresh_matview(&conn_id, &name).await.map_err(to_err)
}

/// Fetch the schema (columns, FKs, indexes) for a table.
#[tauri::command]
pub async fn table_schema(conn_id: String, table: String) -> Result<TableSchema, String> {
    crate::db::table_schema(&conn_id, &table).await.map_err(to_err)
}

/// Run arbitrary SQL. Returns rows for SELECT, affected count for DML/DDL.
#[tauri::command]
pub async fn run_sql(conn_id: String, sql: String) -> Result<QueryResult, String> {
    crate::db::run_sql(&conn_id, &sql).await.map_err(to_err)
}

/// Execute a single DML/DDL statement with bound `?` parameters.
#[tauri::command]
pub async fn execute_params(
    conn_id: String,
    sql: String,
    params: Vec<Option<String>>,
) -> Result<u64, String> {
    crate::db::execute_params(&conn_id, &sql, &params).await.map_err(to_err)
}

/// Run a SELECT with bound `?` parameters (used by UI-built filters).
#[tauri::command]
pub async fn run_sql_params(
    conn_id: String,
    sql: String,
    params: Vec<Option<String>>,
) -> Result<QueryResult, String> {
    crate::db::run_sql_params(&conn_id, &sql, &params).await.map_err(to_err)
}

/// Run a structured operation (select/count/insert/update/delete/...). The
/// connection's adapter builds the actual SQL from the details — the frontend
/// never writes SQL for these operations.
#[tauri::command]
pub async fn execute_op(conn_id: String, op: QueryOp) -> Result<QueryResult, String> {
    crate::db::execute_op(&conn_id, &op).await.map_err(to_err)
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

/// Serialize the database back to bytes for save.
#[tauri::command]
pub async fn save_database(conn_id: String) -> Result<Vec<u8>, String> {
    crate::db::save_database(&conn_id).await.map_err(to_err)
}

/// Duplicate a table (structure + indexes + data) under a new name; returns
/// the statements that ran.
#[tauri::command]
pub async fn duplicate_table(
    conn_id: String,
    source: String,
    target: String,
) -> Result<Vec<String>, String> {
    crate::db::duplicate_table(&conn_id, &source, &target).await.map_err(to_err)
}

/// Apply staged schema (DDL) ops in order; returns every statement that ran.
#[tauri::command]
pub async fn apply_schema_ops(
    conn_id: String,
    ops: Vec<SchemaOp>,
) -> Result<Vec<String>, String> {
    crate::db::apply_schema_ops(&conn_id, &ops).await.map_err(to_err)
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