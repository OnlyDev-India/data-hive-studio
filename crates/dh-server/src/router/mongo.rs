use axum::response::IntoResponse;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use dh_server_client::client::data::{CreateCollectionBody, InsertDocumentBody, MongoDocumentsBody, RunMongoBody, SaveDocumentBody};
use super::{AppState, Auth, err_res};

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
