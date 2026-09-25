//! Explain plan viewer: the engine independent half. Each engine
//! parser turns its own output into [`PlanNode`]s, [`tree::finish`] makes one
//! numbered tree of them, and `support` decides what may be explained at all.
//! The calls that talk to a database live beside each adapter (`explain.rs` in
//! `sqlite/`, `postgres/` and `mongodb/`).

mod support;
mod tree;
pub(crate) mod sqlite;
pub(crate) mod postgres;
pub(crate) mod mongo;

pub use tree::MAX_PLAN_NODES;
pub(crate) use support::check as check_statement;
pub(crate) use tree::finish;

use crate::api::PlanResult;
use super::registry::with_connection;
use super::runs;
use super::types::DbResult;

/// One Activity log entry for a manual Explain. Nothing for a statement that
/// was refused before it reached the database.
fn log(conn_id: &str, statement: &str, analyze: bool, t: std::time::Instant, res: &DbResult<PlanResult>) {
    let error = match res {
        Ok(p) if p.unsupported.is_some() => return,
        Ok(p) if p.cancelled => Some("Cancelled".to_string()),
        Ok(p) => p.error.clone(),
        Err(e) => Some(e.to_string()),
    };
    crate::activity::log_explain(conn_id, statement, analyze, t, error.as_deref());
}

/// Ask the connection's database for the plan of `sql`. A database error, or
/// a statement Explain does not accept, comes back inside the [`PlanResult`]
/// so the Plan tab can show it; only a missing connection is an `Err`.
///
/// `run_id`: the plan tab's id, when the caller can offer Stop for it (see
/// [`runs`]). A stopped call resolves as `Ok` with `cancelled: true`; if the
/// database has not confirmed within the cap the call is dropped here so the
/// tab still frees up.
pub async fn explain_sql(
    conn_id: &str,
    database: Option<&str>,
    schema: Option<&str>,
    sql: &str,
    analyze: bool,
    run_id: Option<&str>,
) -> DbResult<PlanResult> {
    let t = std::time::Instant::now();
    let statement = sql.to_string();
    let database = database.map(str::to_string);
    let schema = schema.map(str::to_string);
    let sql = sql.to_string();
    let run = run_id.map(|id| runs::register(conn_id, id));
    let run_ref = run.as_ref();
    let res = with_connection(conn_id, move |a| async move {
        a.explain_sql(database.as_deref(), schema.as_deref(), &sql, analyze, run_ref).await
    })
    .await;
    // The adapters finish the run themselves before they release a
    // connection; this covers an adapter that ignores `run`.
    if let Some(r) = &run {
        r.finish().await;
    }
    log(conn_id, &statement, analyze, t, &res);
    res
}

/// Ask a MongoDB connection for the plan of one console command. `db` and
/// `collection` are the console's current ones, as `run_mongo` gets them.
/// Errors and unsupported commands come back inside the [`PlanResult`], and
/// `run_id` works as in [`explain_sql`].
pub async fn explain_mongo(
    conn_id: &str,
    db: &str,
    collection: Option<&str>,
    script: &str,
    analyze: bool,
    run_id: Option<&str>,
) -> DbResult<PlanResult> {
    let t = std::time::Instant::now();
    let db = db.to_string();
    let collection = collection.map(str::to_string);
    let statement = script.to_string();
    let script = statement.clone();
    let run = run_id.map(|id| runs::register(conn_id, id));
    let run_ref = run.as_ref();
    let res = with_connection(conn_id, move |a| async move {
        a.explain_mongo(&db, collection.as_deref(), &script, analyze, run_ref).await
    })
    .await;
    if let Some(r) = &run {
        r.finish().await;
    }
    log(conn_id, &statement, analyze, t, &res);
    res
}
