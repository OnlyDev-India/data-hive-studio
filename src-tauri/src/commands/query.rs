use crate::api::{MongoRunResult, QueryChunk, QueryOp, QueryResult};
use super::to_err;

/// Run a MongoDB console command (JSON find/aggregate or a shell-subset
/// statement) against `database`. `collection` is the console's current
/// collection, used only for bare JSON query/pipeline input. `run_id` makes
/// the run stoppable through `cancel_run`; a stopped run resolves with
/// `cancelled: true` rather than an error.
#[tauri::command]
pub async fn run_mongo(
    conn_id: String,
    database: String,
    collection: Option<String>,
    script: String,
    run_id: Option<String>,
) -> Result<MongoRunResult, String> {
    crate::db::run_mongo(
        &conn_id,
        &database,
        collection.as_deref(),
        &script,
        run_id.as_deref(),
    )
    .await
    .map_err(to_err)
}

/// Streaming variant of [`run_mongo`]: find, aggregate and bare JSON reads
/// push their rows and matching documents through the channel as the cursor
/// yields them, and the result carries neither. Every other command returns
/// its result inline. A stopped run resolves with `cancelled: true`.
#[tauri::command]
pub async fn run_mongo_stream(
    conn_id: String,
    database: String,
    collection: Option<String>,
    script: String,
    run_id: Option<String>,
    channel: tauri::ipc::Channel<QueryChunk>,
) -> Result<MongoRunResult, String> {
    crate::db::run_mongo_stream(
        &conn_id,
        &database,
        collection.as_deref(),
        &script,
        run_id.as_deref(),
        move |chunk| {
            channel
                .send(chunk)
                .map_err(|e| crate::db::DbError::InvalidOperation(format!("ipc send failed: {e}")))
        },
    )
    .await
    .map_err(to_err)
}

/// Run arbitrary SQL. Returns rows for SELECT, affected count for DML/DDL.
/// `origin` tags the activity-log entry as user- vs app-initiated (only the
/// SQL editor's own non-streaming fallback passes "user" — see
/// `crate::db::run_sql`'s doc comment) — hand-written (not `forward_cmd!`)
/// since that macro forwards every argument by reference, which doesn't fit
/// a plain `&str`/`String` origin tag cleanly alongside it.
#[tauri::command]
pub async fn run_sql(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    sql: String,
    origin: String,
) -> Result<QueryResult, String> {
    crate::db::run_sql(&conn_id, database.as_deref(), schema.as_deref(), &sql, &origin)
        .await
        .map_err(to_err)
}

/// Execute a single DML/DDL statement with bound `?` parameters.
/// `database`: `None` = this connection's own primary database.
/// Hand-written for the same owned-to-borrowed conversion reason as
/// `list_schemas_in`.
#[tauri::command]
pub async fn execute_params(
    conn_id: String,
    database: Option<String>,
    sql: String,
    params: Vec<Option<String>>,
) -> Result<u64, String> {
    crate::db::execute_params(&conn_id, database.as_deref(), &sql, &params).await.map_err(to_err)
}

/// Run a SELECT with bound `?` parameters (used by UI-built filters).
/// `database`: `None` = this connection's own primary database.
#[tauri::command]
pub async fn run_sql_params(
    conn_id: String,
    database: Option<String>,
    sql: String,
    params: Vec<Option<String>>,
) -> Result<QueryResult, String> {
    crate::db::run_sql_params(&conn_id, database.as_deref(), &sql, &params).await.map_err(to_err)
}

/// Run a structured operation (select/count/insert/update/delete/...). The
/// connection's adapter builds the actual SQL from the details — the
/// frontend never writes SQL for these operations. `database`/`schema`:
/// `None` = this connection's own primary database / active schema.
#[tauri::command]
pub async fn execute_op(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    op: QueryOp,
) -> Result<QueryResult, String> {
    crate::db::execute_op(&conn_id, database.as_deref(), schema.as_deref(), &op)
        .await
        .map_err(to_err)
}

/// Streaming variant of [`execute_op`]: SELECT-shaped ops push row batches
/// through the channel as they come back so the UI can render early. The
/// resolved result carries every field except rows.
#[tauri::command]
pub async fn execute_op_stream(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    op: QueryOp,
    channel: tauri::ipc::Channel<QueryChunk>,
) -> Result<QueryResult, String> {
    crate::db::execute_op_stream(&conn_id, database.as_deref(), schema.as_deref(), &op, move |chunk| {
        channel
            .send(chunk)
            .map_err(|e| crate::db::DbError::InvalidOperation(format!("ipc send failed: {e}")))
    })
    .await
    .map_err(to_err)
}

/// Streaming variant of [`run_sql`]: SELECT-shaped statements push row
/// batches through the channel as they come back. The resolved result
/// carries every field except rows. `run_id` (minted by the editor) makes the
/// run stoppable through [`cancel_run`]; a stopped run resolves with
/// `cancelled: true` rather than an error.
#[tauri::command]
pub async fn run_sql_stream(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    sql: String,
    run_id: Option<String>,
    channel: tauri::ipc::Channel<QueryChunk>,
) -> Result<QueryResult, String> {
    crate::db::run_sql_stream(
        &conn_id,
        database.as_deref(),
        schema.as_deref(),
        &sql,
        run_id.as_deref(),
        move |chunk| {
            channel
                .send(chunk)
                .map_err(|e| crate::db::DbError::InvalidOperation(format!("ipc send failed: {e}")))
        },
    )
    .await
    .map_err(to_err)
}

/// The plan of one SQL statement, without running it. A database
/// error and a statement Explain does not accept come back inside the
/// `PlanResult` for the Plan tab to show. `run_id` makes it stoppable through
/// `cancel_run`; a stopped call resolves with `cancelled: true`. 
#[tauri::command]
pub async fn explain_sql(
    conn_id: String,
    database: Option<String>,
    schema: Option<String>,
    sql: String,
    analyze: bool,
    run_id: Option<String>,
) -> Result<crate::api::PlanResult, String> {
    crate::db::explain_sql(&conn_id, database.as_deref(), schema.as_deref(), &sql, analyze, run_id.as_deref())
        .await
        .map_err(to_err)
}

/// The plan of one MongoDB console command, without running it. `database`
/// and `collection` are the console's current ones, as for `run_mongo`. Like
/// `explain_sql`, errors and unsupported commands come back inside the
/// `PlanResult`.
#[tauri::command]
pub async fn explain_mongo(
    conn_id: String,
    database: String,
    collection: Option<String>,
    script: String,
    analyze: bool,
    run_id: Option<String>,
) -> Result<crate::api::PlanResult, String> {
    crate::db::explain_mongo(&conn_id, &database, collection.as_deref(), &script, analyze, run_id.as_deref())
        .await
        .map_err(to_err)
}

/// Stop the editor run `run_id` on `conn_id`. Waits up to 3 seconds for the
/// database to confirm; cancelling a finished or unknown run is not an error.
#[tauri::command]
pub async fn cancel_run(conn_id: String, run_id: String) -> Result<crate::db::CancelOutcome, String> {
    Ok(crate::db::cancel_run(&conn_id, &run_id).await)
}
