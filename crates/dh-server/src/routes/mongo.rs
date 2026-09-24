use super::{empty_or, json_or, Live, Shared};
use crate::bodies::{
    CreateCollectionBody, InsertDocumentBody, MongoDocumentsBody, RunMongoBody, SaveDocumentBody,
};
use axum::extract::State;
use axum::response::Response;
use axum::Json;
use dh_core::api::{MongoDocumentsResult, MongoExtDocumentsResult};
use dh_core::db::{mongo_script_class, StmtClass};

pub(super) async fn documents(Live(a): Live, Json(b): Json<MongoDocumentsBody>) -> Response {
    json_or(
        a.list_documents(&b.collection, b.filter, b.skip, b.limit)
            .await
            .map(|(documents, total)| MongoDocumentsResult { documents, total }),
    )
}

pub(super) async fn documents_ext(Live(a): Live, Json(b): Json<MongoDocumentsBody>) -> Response {
    json_or(
        a.list_documents_ext(&b.collection, b.filter, b.skip, b.limit)
            .await
            .map(|(documents, total)| MongoExtDocumentsResult { documents, total }),
    )
}

pub(super) async fn save_document(
    State(st): State<Shared>,
    Live(a): Live,
    Json(b): Json<SaveDocumentBody>,
) -> Response {
    if let Err(r) = st.refuse_writes() {
        return r;
    }
    json_or(
        a.save_document(&b.collection, &b.id, &b.document_text)
            .await,
    )
}

pub(super) async fn insert_document(
    State(st): State<Shared>,
    Live(a): Live,
    Json(b): Json<InsertDocumentBody>,
) -> Response {
    if let Err(r) = st.refuse_writes() {
        return r;
    }
    empty_or(a.insert_document(&b.collection, &b.document_text).await)
}

/// The console takes free text, so the classifier decides whether it writes.
pub(super) async fn run(
    State(st): State<Shared>,
    Live(a): Live,
    Json(b): Json<RunMongoBody>,
) -> Response {
    if mongo_script_class(&b.script) != StmtClass::Read {
        if let Err(r) = st.refuse_writes() {
            return r;
        }
    }
    json_or(
        a.run_mongo(&b.database, b.collection.as_deref(), &b.script, None)
            .await,
    )
}

pub(super) async fn create_collection(
    State(st): State<Shared>,
    Live(a): Live,
    Json(b): Json<CreateCollectionBody>,
) -> Response {
    if let Err(r) = st.refuse_writes() {
        return r;
    }
    empty_or(a.create_collection(b.database.as_deref(), &b.name).await)
}
