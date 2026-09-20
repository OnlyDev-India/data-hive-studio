use crate::api::{FieldShape, MongoDocumentsResult, MongoExtDocumentsResult, TableInfo, TableSchema};
use crate::db::CatalogOverview;
use super::to_err;

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

forward_cmd! {
    /// Server-wide roles (Postgres) — the sidebar catalog tree's "Users &
    /// Privileges" row.
    list_roles(conn_id: String) -> Vec<crate::db::SchemaObject> => list_roles
}

forward_cmd! {
    /// Full role attribute set (Postgres) — the Users & Privileges tab.
    list_role_details(conn_id: String) -> Vec<crate::db::RoleDetail> => list_role_details
}

/// Installed extensions (Postgres) within `database` (`None` = this
/// connection's own) — the sidebar catalog tree's per-database "Extensions"
/// row. Hand-written for the same reason as `list_schemas_in`.
#[tauri::command]
pub async fn list_extensions(
    conn_id: String,
    database: Option<String>,
) -> Result<Vec<crate::db::SchemaObject>, String> {
    crate::db::list_extensions(&conn_id, database.as_deref())
        .await
        .map_err(to_err)
}

/// Schemas within `database` (`None` = this connection's own database) — the
/// sidebar catalog tree's per-database schema list. Hand-written (not
/// `forward_cmd!`) since `database` needs an owned-to-borrowed conversion
/// (`Option<String>` -> `Option<&str>`) the macro's blanket `&$arg` can't do.
#[tauri::command]
pub async fn list_schemas_in(
    conn_id: String,
    database: Option<String>,
) -> Result<Vec<String>, String> {
    crate::db::list_schemas_in(&conn_id, database.as_deref())
        .await
        .map_err(to_err)
}

/// Objects of one kind (table/view/matview/procedure/function/sequence/type)
/// in one schema of `database` — the sidebar catalog tree's per-schema
/// category rows. Hand-written for the same reason as `list_schemas_in`.
#[tauri::command]
pub async fn list_schema_objects(
    conn_id: String,
    database: Option<String>,
    schema: String,
    kind: crate::db::SchemaObjectKind,
) -> Result<Vec<crate::db::SchemaObject>, String> {
    crate::db::list_schema_objects(&conn_id, database.as_deref(), &schema, kind)
        .await
        .map_err(to_err)
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

forward_cmd! {
    /// Schemas + databases + active schema in one round trip (Postgres).
    catalog_overview(conn_id: String) -> CatalogOverview => catalog_overview
}

forward_cmd! {
    /// Point every unqualified operation at `schema` (Postgres).
    set_active_schema(conn_id: String, schema: String) -> () => set_active_schema
}

forward_cmd! {
    /// Close ONE sibling database's own connection right now (Postgres) —
    /// the sidebar's per-database "Disconnect".
    disconnect_database(conn_id: String, database: String) -> () => disconnect_database
}

forward_cmd! {
    /// The schema unqualified operations currently target (Postgres).
    active_schema(conn_id: String) -> String => active_schema
}

/// Fetch the schema (columns, FKs, indexes) for a table. `database`/
/// `schema`: `None` = this connection's own primary database / active
/// schema. Hand-written for the same reason as `list_schemas_in`.
#[tauri::command]
pub async fn table_schema(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    table: String,
) -> Result<TableSchema, String> {
    crate::db::table_schema(&conn_id, database.as_deref(), schema.as_deref(), &table)
        .await
        .map_err(to_err)
}

/// The recursively inferred nested field shape for a MongoDB collection
/// (spec 0001's "Fields" view) — independent of `table_schema`/`ColumnInfo`,
/// so the data grid's column headers are never affected by this call.
#[tauri::command]
pub async fn mongo_field_tree(
    conn_id: String,
    database: String,
    collection: String,
) -> Result<Vec<FieldShape>, String> {
    crate::db::field_tree(&conn_id, &database, &collection)
        .await
        .map_err(to_err)
}
