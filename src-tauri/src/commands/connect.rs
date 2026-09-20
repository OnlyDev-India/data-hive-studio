use crate::api::{ConnectionInfo, DbKind};
use super::to_err;

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
    crate::db::open_database(&DbKind::Sqlite, &name, Some(&bytes), Default::default()).await.map_err(to_err)
}

/// Open an existing database directly from its file path. Changes persist to
/// that file automatically. `guard`: the read only flag and environment label
/// (spec 0007); omitted means not read only, no label.
#[tauri::command]
pub async fn open_database_path(
    path: String,
    guard: Option<crate::api::ConnGuard>,
) -> Result<ConnectionInfo, String> {
    crate::db::open_database_path(&path, guard.unwrap_or_default()).await.map_err(to_err)
}

/// Remember the real file a connection should save to.
#[tauri::command]
pub fn set_database_path(conn_id: String, path: String) -> Result<(), String> {
    crate::db::set_database_path(&conn_id, &path).map_err(to_err)
}

/// Create a new, empty database and register a connection.
#[tauri::command]
pub async fn create_database(name: String) -> Result<ConnectionInfo, String> {
    crate::db::open_database(&DbKind::Sqlite, &name, None, Default::default()).await.map_err(to_err)
}

forward_cmd! {
    /// Close a connection and clean up its temp file.
    close_connection(conn_id: String) -> () => close_connection
}

forward_cmd! {
    /// Serialize the database back to bytes for save.
    save_database(conn_id: String) -> Vec<u8> => save_database
}
