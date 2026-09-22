use axum::response::IntoResponse;
use axum::extract::{Path, State};
use axum::response::Response;
use axum::Json;
use dh_server_client::client::data::{DuplicateBody, ExecuteOpBody, SchemaOpsBody, SqlBody};
use super::{AppState, Auth, err_res};

pub(super) async fn conn_sql(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<SqlBody>,
) -> Response {
    match gw
        .run_sql(&auth.0, &conn_id, body.database.as_deref(), body.schema.as_deref(), &body.sql)
        .await
    {
        Ok(r) => Json(r).into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn conn_op(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<ExecuteOpBody>,
) -> Response {
    match gw
        .execute_op(&auth.0, &conn_id, body.database.as_deref(), body.schema.as_deref(), &body.op)
        .await
    {
        Ok(r) => Json(r).into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn conn_schema_ops(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<SchemaOpsBody>,
) -> Response {
    match gw
        .apply_schema_ops_batch(&auth.0, &conn_id, body.database.as_deref(), body.schema.as_deref(), &body.ops)
        .await
    {
        Ok(stmts) => Json(stmts).into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn conn_duplicate(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<DuplicateBody>,
) -> Response {
    match gw
        .duplicate_table(
            &auth.0,
            &conn_id,
            body.database.as_deref(),
            body.schema.as_deref(),
            &body.source,
            &body.target,
            body.copy_data,
        )
        .await
    {
        Ok(stmts) => Json(stmts).into_response(),
        Err(e) => err_res(e),
    }
}

