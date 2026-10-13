//! The SQL query builder's preview: every card's query run read only and in
//! parallel on a capped FROM table. The frontend composes the SQL; this only
//! runs it.

mod preview;

use crate::api::{SqlBuilderPreviewRequest, SqlPreviewChunk, SqlPreviewSummary};
use super::adapter::DbAdapter;
use super::registry::with_connection;
use super::runs;
use super::types::{DbError, DbResult};

pub use preview::preview_activity_text;

/// What a read only run past its time limit fails with.
pub(crate) const TIME_LIMIT_ERROR: &str = "The preview passed its time limit";

/// The sink a refresh sends each card's chunk to.
pub type SqlPreviewSink<'a> = &'a mut (dyn FnMut(SqlPreviewChunk) -> DbResult<()> + Send);

/// Preview the cards `req` names, each card's result going to `on_chunk` as
/// it lands. Stoppable through `cancel_run` with `req.run_id`; a stopped
/// refresh resolves with `cancelled`. Each refresh is one activity entry of
/// the app's own: ok, the first card error, or stopped.
pub async fn sql_builder_preview(
    conn_id: &str,
    req: &SqlBuilderPreviewRequest,
    on_chunk: impl FnMut(SqlPreviewChunk) -> DbResult<()> + Send,
) -> DbResult<SqlPreviewSummary> {
    let t = std::time::Instant::now();
    let mut first_error: Option<String> = None;
    let mut inner = on_chunk;
    let mut sink = |chunk: SqlPreviewChunk| {
        if first_error.is_none() {
            first_error = chunk.error.clone();
        }
        inner(chunk)
    };
    let id = conn_id.to_string();
    let res =
        with_connection(conn_id, move |a| async move { sql_builder_preview_on(&*a, &id, req, &mut sink).await }).await;
    let text = preview_activity_text(req);
    let failed = match &res {
        Ok(s) if s.cancelled => Some(DbError::Cancelled),
        Ok(_) => first_error.map(DbError::InvalidOperation),
        Err(e) => Some(DbError::InvalidOperation(e.to_string())),
    };
    match failed {
        Some(e) => crate::activity::log_err_origin(conn_id, "sql", &text, t, &e, "app"),
        None => crate::activity::log_ok_origin(conn_id, "sql", &text, t, 0, "app"),
    }
    res
}

/// [`sql_builder_preview`] on an adapter the caller already holds, with no
/// activity log: the desktop wrapper above and the team server share it.
pub async fn sql_builder_preview_on(
    a: &dyn DbAdapter,
    conn_id: &str,
    req: &SqlBuilderPreviewRequest,
    sink: SqlPreviewSink<'_>,
) -> DbResult<SqlPreviewSummary> {
    let run = req.run_id.as_deref().map(|id| runs::register(conn_id, id));
    let run_ref = run.as_ref();
    let res = runs::until_abandoned(run_ref, preview::run_preview(a, req, run_ref, sink)).await;
    if let Some(r) = &run {
        r.finish().await;
    }
    match res {
        Err(DbError::Cancelled) => Ok(SqlPreviewSummary { cancelled: true, source_rows: None }),
        other => other,
    }
}
