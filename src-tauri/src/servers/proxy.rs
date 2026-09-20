use dh_core::server::profiles::with_remote;

// ---- Gateway passthrough ----------------------------------------------------
#[tauri::command]
pub async fn server_list_tables(
    conn_id: String,
) -> Result<Vec<dh_core::api::TableInfo>, String> {
    with_remote(&conn_id, |c, r| Box::pin(async move { c.list_tables(&r).await })).await
}

#[tauri::command]
pub async fn server_list_schemas(conn_id: String) -> Result<Vec<String>, String> {
    with_remote(&conn_id, |c, r| Box::pin(async move { c.list_schemas(&r).await })).await
}

#[tauri::command]
pub async fn server_table_schema(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    table: String,
) -> Result<dh_core::api::TableSchema, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.table_schema(&r, database.as_deref(), schema.as_deref(), &table).await })
    })
    .await
}

/// Spec 0001's "Fields" view, team-server passthrough.
#[tauri::command]
pub async fn server_mongo_field_tree(
    conn_id: String,
    database: String,
    collection: String,
) -> Result<Vec<dh_core::api::FieldShape>, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.field_tree(&r, &database, &collection).await })
    })
    .await
}

#[tauri::command]
pub async fn server_run_sql(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    sql: String,
) -> Result<dh_core::api::QueryResult, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.run_sql(&r, database.as_deref(), schema.as_deref(), &sql).await })
    })
    .await
}

#[tauri::command]
pub async fn server_execute_op(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    op: dh_core::api::QueryOp,
) -> Result<dh_core::api::QueryResult, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.execute_op(&r, database.as_deref(), schema.as_deref(), &op).await })
    })
    .await
}

// ---- MongoDB / generic-catalog surface --------------------------------------
//
// Same `with_remote` passthrough pattern as `server_execute_op` above — these
// exist so a desktop app pointed at a shared team-server connection gets the
// same Mongo features (document grid, console, index manager, collection
// create/drop/rename/duplicate, database switcher) as a local connection.
#[tauri::command]
pub async fn server_list_databases(conn_id: String) -> Result<Vec<String>, String> {
    with_remote(&conn_id, |c, r| Box::pin(async move { c.list_databases(&r).await })).await
}

#[tauri::command]
pub async fn server_catalog_overview(
    conn_id: String,
) -> Result<dh_core::db::CatalogOverview, String> {
    with_remote(&conn_id, |c, r| Box::pin(async move { c.catalog_overview(&r).await })).await
}

#[tauri::command]
pub async fn server_list_schemas_in(
    conn_id: String,
    database: Option<String>,
) -> Result<Vec<String>, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.list_schemas_in(&r, database.as_deref()).await })
    })
    .await
}

#[tauri::command]
pub async fn server_list_schema_objects(
    conn_id: String,
    database: Option<String>,
    schema: String,
    kind: dh_core::db::SchemaObjectKind,
) -> Result<Vec<dh_core::db::SchemaObject>, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.list_schema_objects(&r, database.as_deref(), &schema, kind).await })
    })
    .await
}

#[tauri::command]
pub async fn server_list_roles(conn_id: String) -> Result<Vec<dh_core::db::SchemaObject>, String> {
    with_remote(&conn_id, |c, r| Box::pin(async move { c.list_roles(&r).await })).await
}

#[tauri::command]
pub async fn server_list_extensions(
    conn_id: String,
    database: Option<String>,
) -> Result<Vec<dh_core::db::SchemaObject>, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.list_extensions(&r, database.as_deref()).await })
    })
    .await
}

#[tauri::command]
pub async fn server_list_role_details(
    conn_id: String,
) -> Result<Vec<dh_core::db::RoleDetail>, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.list_role_details(&r).await })
    })
    .await
}

#[tauri::command]
pub async fn server_active_schema(conn_id: String) -> Result<String, String> {
    with_remote(&conn_id, |c, r| Box::pin(async move { c.active_schema(&r).await })).await
}

#[tauri::command]
pub async fn server_set_active_schema(conn_id: String, schema: String) -> Result<(), String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.set_active_schema(&r, &schema).await })
    })
    .await
}

#[tauri::command]
pub async fn server_disconnect_database(conn_id: String, database: String) -> Result<(), String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.disconnect_database(&r, &database).await })
    })
    .await
}

#[tauri::command]
pub async fn server_apply_schema_ops_batch(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    ops: Vec<dh_core::api::SchemaOp>,
) -> Result<Vec<String>, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.apply_schema_ops_batch(&r, database.as_deref(), schema.as_deref(), &ops).await })
    })
    .await
}

#[tauri::command]
pub async fn server_duplicate_table(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    source: String,
    target: String,
    copy_data: bool,
) -> Result<Vec<String>, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move {
            c.duplicate_table(&r, database.as_deref(), schema.as_deref(), &source, &target, copy_data).await
        })
    })
    .await
}

#[tauri::command]
pub async fn server_list_documents(
    conn_id: String,
    collection: String,
    filter: Option<serde_json::Value>,
    skip: u64,
    limit: u64,
) -> Result<dh_core::api::MongoDocumentsResult, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.list_documents(&r, &collection, filter, skip, limit).await })
    })
    .await
}

#[tauri::command]
pub async fn server_list_documents_ext(
    conn_id: String,
    collection: String,
    filter: Option<serde_json::Value>,
    skip: u64,
    limit: u64,
) -> Result<dh_core::api::MongoExtDocumentsResult, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.list_documents_ext(&r, &collection, filter, skip, limit).await })
    })
    .await
}

#[tauri::command]
pub async fn server_save_document(
    conn_id: String,
    collection: String,
    id: String,
    document_text: String,
) -> Result<bool, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.save_document(&r, &collection, &id, &document_text).await })
    })
    .await
}

#[tauri::command]
pub async fn server_insert_document(
    conn_id: String,
    collection: String,
    document_text: String,
) -> Result<(), String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.insert_document(&r, &collection, &document_text).await })
    })
    .await
}

#[tauri::command]
pub async fn server_run_mongo(
    conn_id: String,
    database: String,
    collection: Option<String>,
    script: String,
) -> Result<dh_core::api::MongoRunResult, String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.run_mongo(&r, &database, collection.as_deref(), &script).await })
    })
    .await
}

#[tauri::command]
pub async fn server_create_collection(
    conn_id: String,
    database: Option<String>,
    name: String,
) -> Result<(), String> {
    with_remote(&conn_id, |c, r| {
        Box::pin(async move { c.create_collection(&r, database.as_deref(), &name).await })
    })
    .await
}
