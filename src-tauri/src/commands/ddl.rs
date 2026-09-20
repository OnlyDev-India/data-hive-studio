use crate::api::SchemaOp;
use super::to_err;

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

/// Create a collection (MongoDB). `database`: `None` = this connection's
/// own primary database. Hand-written (not `forward_cmd!`) for the same
/// owned-to-borrowed conversion reason as `list_schemas_in`.
#[tauri::command]
pub async fn create_mongo_collection(
    conn_id: String,
    database: Option<String>,
    name: String,
) -> Result<(), String> {
    crate::db::create_collection(&conn_id, database.as_deref(), &name)
        .await
        .map_err(to_err)
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

/// Refresh a materialized view (Postgres). `database`/`schema`: `None` =
/// this connection's own primary database / active schema. Hand-written
/// (not `forward_cmd!`) for the same owned-to-borrowed conversion reason as
/// `list_schemas_in`.
#[tauri::command]
pub async fn refresh_matview(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    name: String,
) -> Result<(), String> {
    crate::db::refresh_matview(&conn_id, database.as_deref(), schema.as_deref(), &name)
        .await
        .map_err(to_err)
}

/// Duplicate a table/collection under a new name; returns the statements
/// that ran. `copy_data` controls whether documents are copied too (honored
/// by MongoDB; SQL adapters always copy everything regardless, for now).
/// `database`/`schema`: `None` = this connection's own primary database /
/// active schema.
#[tauri::command]
pub async fn duplicate_table(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    source: String,
    target: String,
    copy_data: bool,
) -> Result<Vec<String>, String> {
    crate::db::duplicate_table(&conn_id, database.as_deref(), schema.as_deref(), &source, &target, copy_data)
        .await
        .map_err(to_err)
}

/// Apply staged schema (DDL) ops in order; returns every statement that
/// ran. `database`/`schema`: `None` = this connection's own primary
/// database / active schema.
#[tauri::command]
pub async fn apply_schema_ops(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    ops: Vec<SchemaOp>,
) -> Result<Vec<String>, String> {
    crate::db::apply_schema_ops(&conn_id, database.as_deref(), schema.as_deref(), &ops)
        .await
        .map_err(to_err)
}
