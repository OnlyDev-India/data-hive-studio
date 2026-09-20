use crate::api::MongoRunResult;
use serde_json;
use super::types::{DbError, DbResult};
use super::activity_log::{activity_rows_mongo, log_refusal};
use super::runs;
use super::registry::with_connection;

/// Fetch a page of documents from a MongoDB collection.
pub async fn list_documents(
    conn_id: &str,
    collection: &str,
    filter: Option<serde_json::Value>,
    skip: u64,
    limit: u64,
) -> DbResult<(Vec<serde_json::Value>, u64)> {
    with_connection(conn_id, |a| async move {
        a.list_documents(collection, filter, skip, limit).await
    })
    .await
}

/// Fetch a page of documents rendered as type-aware MQL extended JSON text.
pub async fn list_documents_ext(
    conn_id: &str,
    collection: &str,
    filter: Option<serde_json::Value>,
    skip: u64,
    limit: u64,
) -> DbResult<(Vec<String>, u64)> {
    with_connection(conn_id, |a| async move {
        a.list_documents_ext(collection, filter, skip, limit).await
    })
    .await
}

/// Replace a single MongoDB document by its `_id` (ObjectId hex string) with
/// the document parsed from `document_text` (MQL extended JSON).
pub async fn save_document(
    conn_id: &str,
    collection: &str,
    id: &str,
    document_text: &str,
) -> DbResult<bool> {
    let t = std::time::Instant::now();
    let res = with_connection(conn_id, |a| async move {
        a.save_document(collection, id, document_text).await
    })
    .await;
    log_refusal(conn_id, "update", &format!("UPDATE {collection} (document {id})"), t, &res);
    res
}

/// Insert a new MongoDB document parsed from `document_text`.
pub async fn insert_document(
    conn_id: &str,
    collection: &str,
    document_text: &str,
) -> DbResult<()> {
    let t = std::time::Instant::now();
    let res = with_connection(conn_id, |a| async move {
        a.insert_document(collection, document_text).await
    })
    .await;
    log_refusal(conn_id, "insert", &format!("INSERT {collection} (document)"), t, &res);
    res
}

/// Run a MongoDB console command (JSON find/aggregate or a shell-subset
/// statement) against database `db`. `collection` is the console's current
/// collection, used only for bare JSON query/pipeline input.
///
/// Only ever called from the Mongo console (the editor) — always logged as
/// user-initiated, same as `run_sql_stream`. A Mongo run can fail two
/// different ways: the connection/adapter call itself errors (`Err`), or it
/// succeeds at the transport level but carries a logical failure in
/// `MongoRunResult::error` (e.g. a bad script) — both need to show up as a
/// failed activity entry, so the `error` field is checked inside the `Ok`
/// arm too.
///
/// `run_id`: the console run's id, when the caller can offer Stop for it (see
/// [`runs`] and `run_sql_stream`). A stopped run resolves as `Ok` with
/// `cancelled: true`, logged as a failed "Stopped by user" entry.
pub async fn run_mongo(
    conn_id: &str,
    db: &str,
    collection: Option<&str>,
    script: &str,
    run_id: Option<&str>,
) -> DbResult<MongoRunResult> {
    let t = std::time::Instant::now();
    let run = run_id.map(|id| runs::register(conn_id, id));
    let run_ref = run.as_ref();
    let res = with_connection(conn_id, move |a| async move {
        runs::until_abandoned(run_ref, a.run_mongo(db, collection, script, run_ref)).await
    })
    .await;
    if let Some(r) = &run {
        r.finish().await;
    }
    if let Err(DbError::Cancelled) = &res {
        crate::activity::log_stmt_err(conn_id, "mongo", script, t, &DbError::Cancelled);
        return Ok(MongoRunResult {
            command: script.trim().to_string(),
            cancelled: true,
            elapsed_ms: t.elapsed().as_millis(),
            ..Default::default()
        });
    }
    match &res {
        Ok(r) if r.error.is_none() => {
            crate::activity::log_stmt_ok(conn_id, "mongo", script, t, activity_rows_mongo(r))
        }
        Ok(r) => {
            let err = DbError::InvalidOperation(r.error.clone().unwrap_or_default());
            crate::activity::log_stmt_err(conn_id, "mongo", script, t, &err)
        }
        Err(e) => crate::activity::log_stmt_err(conn_id, "mongo", script, t, e),
    }
    res
}
