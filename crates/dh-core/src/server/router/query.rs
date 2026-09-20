use axum::response::IntoResponse;
use crate::api::{QueryOp, SchemaOp};
use axum::extract::{Path, State};
use axum::response::Response;
use axum::Json;
use super::{AppState, Auth, err_res};

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SqlBody {
    pub sql: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
}

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

/// `#[serde(flatten)]` keeps `op`'s own tagged JSON shape at the top level
/// (`{ kind: "select", table: ..., ... }`) with `database`/`schema` as
/// sibling fields, rather than nesting the op under its own key.
#[derive(serde::Deserialize, serde::Serialize)]
pub struct ExecuteOpBody {
    #[serde(flatten)]
    pub op: QueryOp,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
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

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SchemaOpsBody {
    pub ops: Vec<SchemaOp>,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
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

#[derive(serde::Deserialize, serde::Serialize)]
pub struct DuplicateBody {
    pub source: String,
    pub target: String,
    #[serde(default)]
    pub copy_data: bool,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
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
