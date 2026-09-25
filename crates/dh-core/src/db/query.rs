use crate::api::{QueryChunk, QueryOp, QueryResult};
use super::adapter::DbAdapter;
use super::types::{BatchSink, DbError, DbResult};
use super::activity_log::{activity_rows, op_label};
use super::runs;
use super::registry::with_connection;

/// `origin` distinguishes the SQL editor's "Run" (its non-streaming
/// fallback transport, used over HTTP/web — see `run_sql_stream`'s doc
/// comment) from every other caller of this same function (the sidebar's
/// own housekeeping queries, the schema designer's "create table" apply):
/// only the former is a query the user actually wrote and ran themselves.
pub async fn run_sql(
    conn_id: &str,
    database: Option<&str>,
    schema: Option<&str>,
    sql: &str,
    origin: &str,
) -> DbResult<QueryResult> {
    let t = std::time::Instant::now();
    // Owned copy for the activity log — the closure below consumes a clone.
    let full_sql = sql.to_string();
    let sql = full_sql.clone();
    let database = database.map(str::to_string);
    let schema = schema.map(str::to_string);
    let res = with_connection(conn_id, move |a| async move {
        a.run_sql(database.as_deref(), schema.as_deref(), &sql).await
    })
    .await;
    match &res {
        Ok(r) => crate::activity::log_stmt_ok_origin(conn_id, "sql", &full_sql, t, activity_rows(r), origin),
        Err(e) => crate::activity::log_stmt_err_origin(conn_id, "sql", &full_sql, t, e, origin),
    }
    res
}

/// Only ever called for a grid-built DML/DDL statement (never free-form
/// editor SQL) — always logged as app-initiated.
pub async fn execute_params(
    conn_id: &str,
    database: Option<&str>,
    sql: &str,
    params: &[Option<String>],
) -> DbResult<u64> {
    let t = std::time::Instant::now();
    let full_sql = sql.to_string();
    let sql = full_sql.clone();
    let params: Vec<Option<String>> = params.to_vec();
    let database = database.map(str::to_string);
    let res = with_connection(conn_id, move |a| async move {
        a.execute_params(database.as_deref(), &sql, &params).await
    })
    .await;
    match &res {
        Ok(n) => crate::activity::log_stmt_ok_origin(conn_id, "sql", &full_sql, t, *n as i64, "app"),
        Err(e) => crate::activity::log_stmt_err_origin(conn_id, "sql", &full_sql, t, e, "app"),
    }
    res
}

/// Run a SELECT with bound parameters (used by UI-built filters — never the
/// SQL editor, so always logged as app-initiated).
pub async fn run_sql_params(
    conn_id: &str,
    database: Option<&str>,
    sql: &str,
    params: &[Option<String>],
) -> DbResult<QueryResult> {
    let t = std::time::Instant::now();
    let full_sql = sql.to_string();
    let sql = full_sql.clone();
    let params: Vec<Option<String>> = params.to_vec();
    let database = database.map(str::to_string);
    let res = with_connection(conn_id, move |a| async move {
        a.run_sql_params(database.as_deref(), &sql, &params).await
    })
    .await;
    match &res {
        Ok(r) => crate::activity::log_stmt_ok_origin(conn_id, "sql", &full_sql, t, activity_rows(r), "app"),
        Err(e) => crate::activity::log_stmt_err_origin(conn_id, "sql", &full_sql, t, e, "app"),
    }
    res
}

/// The data grid's structured select/count/insert/update/delete actions —
/// never the SQL editor (which always goes through `run_sql`/
/// `run_sql_stream` instead) — so always logged as app-initiated.
pub async fn execute_op(
    conn_id: &str,
    database: Option<&str>,
    schema: Option<&str>,
    op: &QueryOp,
) -> DbResult<QueryResult> {
    let t = std::time::Instant::now();
    let (kind, target) = op_label(op);
    let op = op.clone();
    let database = database.map(str::to_string);
    let schema = schema.map(str::to_string);
    let res = with_connection(conn_id, move |a| async move {
        a.execute_op(database.as_deref(), schema.as_deref(), &op).await
    })
    .await;
    match &res {
        Ok(outcome) => match &outcome.sql {
            Some(sql) => {
                crate::activity::log_stmt_ok_origin(conn_id, kind, sql, t, activity_rows(&outcome.result), "app")
            }
            None => crate::activity::log_ok_origin(
                conn_id,
                kind,
                &target,
                t,
                activity_rows(&outcome.result),
                "app",
            ),
        },
        Err(e) => crate::activity::log_err_origin(conn_id, kind, &target, t, e, "app"),
    }
    res.map(|outcome| outcome.result)
}

/// Streaming variant of [`execute_op`]: SELECT-shaped ops push row batches
/// through `on_batch` as they arrive; the returned result omits rows (the
/// caller assembles those from the chunks). Writes never touch the channel.
/// Same app-initiated origin as `execute_op` — see its doc comment.
pub async fn execute_op_stream(
    conn_id: &str,
    database: Option<&str>,
    schema: Option<&str>,
    op: &QueryOp,
    on_batch: impl FnMut(QueryChunk) -> DbResult<()> + Send,
) -> DbResult<QueryResult> {
    let t = std::time::Instant::now();
    let (kind, target) = op_label(op);
    let op = op.clone();
    let database = database.map(str::to_string);
    let schema = schema.map(str::to_string);
    let mut sink = on_batch;
    let res = with_connection(conn_id, move |a| async move {
        a.execute_op_stream(database.as_deref(), schema.as_deref(), &op, &mut sink).await
    })
    .await;
    match &res {
        // Streamed rows never land in the result — log 0 and rely on duration.
        Ok(outcome) => match &outcome.sql {
            Some(sql) => crate::activity::log_stmt_ok_origin(conn_id, kind, sql, t, 0, "app"),
            None => crate::activity::log_ok_origin(conn_id, kind, &target, t, 0, "app"),
        },
        Err(e) => crate::activity::log_err_origin(conn_id, kind, &target, t, e, "app"),
    }
    res.map(|outcome| outcome.result)
}

/// Streaming variant of [`run_sql`]: SELECT-shaped statements push row
/// batches through `on_batch`; the returned result omits rows. Other
/// statements run normally and never touch the channel. Unlike `run_sql`,
/// this is ONLY ever called from the SQL editor's "Run" (desktop transport;
/// web/server connections fall back to non-streaming `run_sql` instead — see
/// `runSqlStream` on the frontend), so it's unconditionally user-initiated,
/// same as `log_stmt_ok`/`log_stmt_err`'s default below.
///
/// `run_id`: the editor run's id, when the caller can offer Stop for it (see
/// [`runs`]). A run the user stopped resolves as `Ok` with `cancelled: true`
/// (rows already streamed stay with the caller) and is logged as a failed
/// "Stopped by user" entry; if the database has not confirmed within the
/// cap, the query is dropped here so the tab still frees up.
pub async fn run_sql_stream(
    conn_id: &str,
    database: Option<&str>,
    schema: Option<&str>,
    sql: &str,
    run_id: Option<&str>,
    on_batch: impl FnMut(QueryChunk) -> DbResult<()> + Send,
) -> DbResult<QueryResult> {
    let t = std::time::Instant::now();
    let full_sql = sql.to_string();
    let sql = full_sql.clone();
    let database = database.map(str::to_string);
    let schema = schema.map(str::to_string);
    // Streamed rows never land in the result, so count them on their way out
    // for the activity log.
    let streamed = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = streamed.clone();
    let mut inner = on_batch;
    let mut sink = move |chunk: QueryChunk| {
        counter.fetch_add(chunk.rows.len(), std::sync::atomic::Ordering::Relaxed);
        inner(chunk)
    };
    let id = conn_id.to_string();
    let run_id = run_id.map(str::to_string);
    let res = with_connection(conn_id, move |a| async move {
        run_sql_stream_on(&*a, &id, database.as_deref(), schema.as_deref(), &sql, run_id.as_deref(), &mut sink).await
    })
    .await;
    match res {
        Ok(r) if r.cancelled => {
            crate::activity::log_stmt_err(conn_id, "sql", &full_sql, t, &DbError::Cancelled);
            Ok(r)
        }
        Ok(r) => {
            let rows = if r.is_select {
                streamed.load(std::sync::atomic::Ordering::Relaxed) as i64
            } else {
                activity_rows(&r)
            };
            crate::activity::log_stmt_ok(conn_id, "sql", &full_sql, t, rows);
            Ok(r)
        }
        Err(e) => {
            crate::activity::log_stmt_err(conn_id, "sql", &full_sql, t, &e);
            Err(e)
        }
    }
}

/// The streaming run itself, on an adapter the caller already holds and with
/// no activity log: the desktop wrapper above and the team server share it,
/// so both use the same run registry code. `conn_id` is what Stop names the
/// run under (the desktop connection id, or the server's handle). A stopped
/// run resolves as `Ok` with `cancelled: true`; rows already sent to `sink`
/// stay with the caller.
pub async fn run_sql_stream_on(
    a: &dyn DbAdapter,
    conn_id: &str,
    database: Option<&str>,
    schema: Option<&str>,
    sql: &str,
    run_id: Option<&str>,
    sink: BatchSink<'_>,
) -> DbResult<QueryResult> {
    let t = std::time::Instant::now();
    let run = run_id.map(|id| runs::register(conn_id, id));
    let run_ref = run.as_ref();
    let res = runs::until_abandoned(run_ref, a.run_sql_stream(database, schema, sql, run_ref, sink)).await;
    // After the adapter has let go of its connection (it finishes the run
    // itself before releasing one); this also covers adapters that ignore
    // `run` and the abandon path above.
    if let Some(r) = &run {
        r.finish().await;
    }
    match res {
        Err(DbError::Cancelled) => Ok(QueryResult {
            cancelled: true,
            elapsed_ms: t.elapsed().as_millis(),
            ..Default::default()
        }),
        other => other,
    }
}
