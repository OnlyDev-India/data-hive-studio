use axum::response::IntoResponse;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use super::{AppState, Auth, err_res};

#[derive(serde::Deserialize, serde::Serialize)]
pub struct MongoDocumentsBody {
    pub collection: String,
    #[serde(default)]
    pub filter: Option<serde_json::Value>,
    #[serde(default)]
    pub skip: u64,
    #[serde(default = "default_doc_limit")]
    pub limit: u64,
}

fn default_doc_limit() -> u64 {
    50
}

pub(super) async fn conn_mongo_documents(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<MongoDocumentsBody>,
) -> Response {
    match gw
        .list_documents(&auth.0, &conn_id, &body.collection, body.filter, body.skip, body.limit)
        .await
    {
        Ok(r) => Json(r).into_response(),
        Err(e) => err_res(e),
    }
}

pub(super) async fn conn_mongo_documents_ext(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<MongoDocumentsBody>,
) -> Response {
    match gw
        .list_documents_ext(&auth.0, &conn_id, &body.collection, body.filter, body.skip, body.limit)
        .await
    {
        Ok(r) => Json(r).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SaveDocumentBody {
    pub collection: String,
    pub id: String,
    pub document_text: String,
}

pub(super) async fn conn_mongo_save_document(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<SaveDocumentBody>,
) -> Response {
    match gw
        .save_document(&auth.0, &conn_id, &body.collection, &body.id, &body.document_text)
        .await
    {
        Ok(saved) => Json(saved).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct InsertDocumentBody {
    pub collection: String,
    pub document_text: String,
}

pub(super) async fn conn_mongo_insert_document(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<InsertDocumentBody>,
) -> Response {
    match gw.insert_document(&auth.0, &conn_id, &body.collection, &body.document_text).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct RunMongoBody {
    pub database: String,
    #[serde(default)]
    pub collection: Option<String>,
    pub script: String,
}

pub(super) async fn conn_mongo_run(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<RunMongoBody>,
) -> Response {
    match gw
        .run_mongo(&auth.0, &conn_id, &body.database, body.collection.as_deref(), &body.script)
        .await
    {
        Ok(r) => Json(r).into_response(),
        Err(e) => err_res(e),
    }
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct CreateCollectionBody {
    pub name: String,
    #[serde(default)]
    pub database: Option<String>,
}

pub(super) async fn conn_mongo_create_collection(
    State(gw): State<AppState>,
    auth: Auth,
    Path(conn_id): Path<String>,
    Json(body): Json<CreateCollectionBody>,
) -> Response {
    match gw
        .create_collection(&auth.0, &conn_id, body.database.as_deref(), &body.name)
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => err_res(e),
    }
}
