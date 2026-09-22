use axum::response::IntoResponse;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use dh_server_client::client::browse::{ExtensionsBody, SchemaObjectsBody, SchemasInBody};
use dh_server_client::client::data::{ActiveSchemaBody, DisconnectDatabaseBody};
use super::{AppState, Auth, err_res};

// ---------------------------------------------------------------------------
//  Connection data surface — unchanged shape from before; every method
//  resolves the connection's org/access internally (see gateway.rs).
// ---------------------------------------------------------------------------
pub(super) async fn conn_tables(State(gw): State<AppState>, auth: Auth, Path(conn_id): Path<String>) -> Response {
    match gw.list_tables(&auth.0, &conn_id).await {
        Ok(t) => Json(t).into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn conn_schemas(State(gw): State<AppState>, auth: Auth, Path(conn_id): Path<String>) -> Response {
    match gw.list_schemas(&auth.0, &conn_id).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => err_res(e),
    }
}

/// `database`/`schema`: `None` (query string omitted) = this connection's
/// own primary database / active schema — see `DbAdapter::table_schema`'s
/// doc comment for the general semantics.
#[derive(serde::Deserialize)]
pub struct TargetQuery {
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
}

pub(super) async fn conn_schema(
    State(gw): State<AppState>,
    auth: Auth,
    Path((conn_id, table)): Path<(String, String)>,
    Query(q): Query<TargetQuery>,
) -> Response {
    match gw.table_schema(&auth.0, &conn_id, q.database.as_deref(), q.schema.as_deref(), &table).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => err_res(e),
    }
}

/// Spec 0001's "Fields" view — `database` is required (Mongo tabs always
/// carry one explicitly, unlike `TargetQuery`'s optional "ambient" database).
#[derive(serde::Deserialize)]
pub struct FieldTreeQuery {
    pub database: String,
}

pub(super) async fn conn_mongo_field_tree(
    State(gw): State<AppState>,
    auth: Auth,
    Path((conn_id, collection)): Path<(String, String)>,
    Query(q): Query<FieldTreeQuery>,
) -> Response {
    match gw.field_tree(&auth.0, &conn_id, &q.database, &collection).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn conn_databases(State(gw): State<AppState>, auth: Auth, Path(conn_id): Path<String>) -> Response {
    match gw.list_databases(&auth.0, &conn_id).await {
        Ok(d) => Json(d).into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn conn_catalog(State(gw): State<AppState>, auth: Auth, Path(conn_id): Path<String>) -> Response {
    match gw.catalog_overview(&auth.0, &conn_id).await {
        Ok(c) => Json(c).into_response(),
        Err(e) => err_res(e),
    }
}

// ---- Sidebar catalog tree — schemas/objects/roles, optionally for a
// sibling database on the same server (see `Gateway::list_schemas_in`). ----
pub(super) async fn conn_schemas_in(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<SchemasInBody>,
) -> Response {
    match gw.list_schemas_in(&auth.0, &conn_id, body.database.as_deref()).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn conn_schema_objects(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<SchemaObjectsBody>,
) -> Response {
    match gw
        .list_schema_objects(&auth.0, &conn_id, body.database.as_deref(), &body.schema, body.kind)
        .await
    {
        Ok(o) => Json(o).into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn conn_roles(State(gw): State<AppState>, auth: Auth, Path(conn_id): Path<String>) -> Response {
    match gw.list_roles(&auth.0, &conn_id).await {
        Ok(r) => Json(r).into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn conn_extensions(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<ExtensionsBody>,
) -> Response {
    match gw.list_extensions(&auth.0, &conn_id, body.database.as_deref()).await {
        Ok(e) => Json(e).into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn conn_role_details(State(gw): State<AppState>, auth: Auth, Path(conn_id): Path<String>) -> Response {
    match gw.list_role_details(&auth.0, &conn_id).await {
        Ok(r) => Json(r).into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn conn_get_active_schema(State(gw): State<AppState>, auth: Auth, Path(conn_id): Path<String>) -> Response {
    match gw.active_schema(&auth.0, &conn_id).await {
        Ok(s) => Json(s).into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn conn_disconnect_database(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<DisconnectDatabaseBody>,
) -> Response {
    match gw.disconnect_database(&auth.0, &conn_id, &body.database).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn conn_set_active_schema(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<ActiveSchemaBody>,
) -> Response {
    match gw.set_active_schema(&auth.0, &conn_id, &body.schema).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}
