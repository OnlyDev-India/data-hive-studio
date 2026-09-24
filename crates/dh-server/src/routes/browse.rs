use super::{empty_or, json_or, Live};
use crate::bodies::{
    ActiveSchemaBody, DisconnectDatabaseBody, ExtensionsBody, SchemaObjectsBody, SchemasInBody,
};
use axum::extract::{Path, Query};
use axum::response::Response;
use axum::Json;

/// `database`/`schema`: `None` (query string omitted) means the connection's
/// own primary database and active schema.
#[derive(serde::Deserialize)]
pub struct TargetQuery {
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
}

/// The Fields view: a Mongo tab always names its database.
#[derive(serde::Deserialize)]
pub struct FieldTreeQuery {
    pub database: String,
}

pub(super) async fn tables(Live(a): Live) -> Response {
    json_or(a.list_tables().await)
}

pub(super) async fn schemas(Live(a): Live) -> Response {
    json_or(a.list_schemas().await)
}

pub(super) async fn schema(
    Live(a): Live,
    Path((_handle, table)): Path<(String, String)>,
    Query(q): Query<TargetQuery>,
) -> Response {
    json_or(
        a.table_schema(q.database.as_deref(), q.schema.as_deref(), &table)
            .await
            .map(|t| t.0),
    )
}

pub(super) async fn field_tree(
    Live(a): Live,
    Path((_handle, collection)): Path<(String, String)>,
    Query(q): Query<FieldTreeQuery>,
) -> Response {
    json_or(a.field_tree(&q.database, &collection).await)
}

pub(super) async fn databases(Live(a): Live) -> Response {
    json_or(a.list_databases().await)
}

pub(super) async fn catalog(Live(a): Live) -> Response {
    json_or(a.catalog_overview().await)
}

pub(super) async fn schemas_in(Live(a): Live, Json(b): Json<SchemasInBody>) -> Response {
    json_or(a.list_schemas_in(b.database.as_deref()).await)
}

pub(super) async fn schema_objects(Live(a): Live, Json(b): Json<SchemaObjectsBody>) -> Response {
    json_or(
        a.list_schema_objects(b.database.as_deref(), &b.schema, b.kind)
            .await,
    )
}

pub(super) async fn roles(Live(a): Live) -> Response {
    json_or(a.list_roles().await)
}

pub(super) async fn extensions(Live(a): Live, Json(b): Json<ExtensionsBody>) -> Response {
    json_or(a.list_extensions(b.database.as_deref()).await)
}

pub(super) async fn role_details(Live(a): Live) -> Response {
    json_or(a.list_role_details().await)
}

pub(super) async fn active_schema(Live(a): Live) -> Response {
    json_or(a.active_schema().await)
}

/// Switches which schema unqualified operations target. Per handle state, and
/// a handle belongs to one browser tab's connection, so it is not a data write.
pub(super) async fn set_active_schema(Live(a): Live, Json(b): Json<ActiveSchemaBody>) -> Response {
    empty_or(a.set_active_schema(&b.schema).await)
}

pub(super) async fn disconnect_database(
    Live(a): Live,
    Json(b): Json<DisconnectDatabaseBody>,
) -> Response {
    empty_or(a.disconnect_database(&b.database).await)
}
