use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use crate::api::{
    ComposedPipeline, GridFilterCond, MongoRunResult, ParsedPipeline, PipelinePreviewRequest, PipelineRunRequest, PipelineSpec,
    PreviewChunk, PreviewSummary, QueryChunk,
};
use super::adapter::DbAdapter;
use super::registry::with_connection;
use super::runs;
use super::types::{BatchSink, DbError, DbResult, PreviewSink};

/// The aggregation builder's cards as stage documents and every text form,
/// with an error per card that does not compose. Pure: no connection.
pub fn compose_pipeline(collection: &str, spec: &PipelineSpec) -> ComposedPipeline {
    super::mongodb::compose_pipeline(collection, spec)
}

/// Pipeline text (a shell `aggregate` call or a JSON array, comments and
/// the Save format's marks allowed) as cards. Pure.
pub fn mongo_pipeline_parse(text: &str) -> DbResult<ParsedPipeline> {
    super::mongodb::parse_pipeline(text).map_err(DbError::InvalidOperation)
}

/// A stage value in canonical Extended JSON as card body text. Pure.
pub fn mongo_pipeline_render_stage(op: &str, value: serde_json::Value) -> DbResult<String> {
    super::mongodb::render_stage(op, value).map_err(DbError::InvalidOperation)
}

/// A collection grid's filter as the body of a `$match` card. Pure.
pub fn mongo_filter_to_match(filters: &[GridFilterCond], custom_where: Option<&str>) -> DbResult<Option<String>> {
    super::mongodb::filter_to_match(filters, custom_where)
}

/// `$out` or `$merge` when an enabled card writes, at any depth. Pure.
pub fn pipeline_write_stage(spec: &PipelineSpec) -> Option<&'static str> {
    super::mongodb::spec_write_stage(spec)
}

/// Preview the cards `req` names, each card's result going to `on_chunk` as
/// it lands. Stoppable through `cancel_run` with `req.run_id`; a stopped
/// refresh resolves with `cancelled`, keeping what was sent. Each refresh is
/// one activity entry of the app's own: ok, the first card error, or stopped.
pub async fn mongo_pipeline_preview(
    conn_id: &str,
    req: &PipelinePreviewRequest,
    on_chunk: impl FnMut(PreviewChunk) -> DbResult<()> + Send,
) -> DbResult<PreviewSummary> {
    let t = std::time::Instant::now();
    let mut first_error: Option<String> = None;
    let mut inner = on_chunk;
    let mut sink = |chunk: PreviewChunk| {
        if first_error.is_none() {
            first_error = chunk.error.clone();
        }
        inner(chunk)
    };
    let id = conn_id.to_string();
    let res =
        with_connection(conn_id, move |a| async move { mongo_pipeline_preview_on(&*a, &id, req, &mut sink).await })
            .await;
    let text = super::mongodb::preview_activity_text(req);
    let failed = match &res {
        Ok(s) if s.cancelled => Some(DbError::Cancelled),
        Ok(_) => first_error.map(DbError::InvalidOperation),
        Err(e) => Some(DbError::InvalidOperation(e.to_string())),
    };
    match failed {
        Some(e) => crate::activity::log_err_origin(conn_id, "mongo", &text, t, &e, "app"),
        None => crate::activity::log_ok_origin(conn_id, "mongo", &text, t, 0, "app"),
    }
    res
}

/// [`mongo_pipeline_preview`] on an adapter the caller already holds.
pub async fn mongo_pipeline_preview_on(
    a: &dyn DbAdapter,
    conn_id: &str,
    req: &PipelinePreviewRequest,
    sink: PreviewSink<'_>,
) -> DbResult<PreviewSummary> {
    let run = req.run_id.as_deref().map(|id| runs::register(conn_id, id));
    let run_ref = run.as_ref();
    let res = runs::until_abandoned(run_ref, a.mongo_pipeline_preview(req, run_ref, sink)).await;
    if let Some(r) = &run {
        r.finish().await;
    }
    match res {
        Err(DbError::Cancelled) => Ok(PreviewSummary { cancelled: true, source_estimate: None }),
        other => other,
    }
}

/// Run the whole pipeline, streaming its rows and documents to `on_batch`.
/// Logged like a console run, with the shell text and the streamed count.
pub async fn mongo_pipeline_run_stream(
    conn_id: &str,
    req: &PipelineRunRequest,
    on_batch: impl FnMut(QueryChunk) -> DbResult<()> + Send,
) -> DbResult<MongoRunResult> {
    let t = std::time::Instant::now();
    let script = compose_pipeline(&req.collection, &req.spec).shell;
    let streamed = Arc::new(AtomicUsize::new(0));
    let counter = streamed.clone();
    let mut inner = on_batch;
    let mut sink = move |chunk: QueryChunk| {
        counter.fetch_add(chunk.rows.len(), Ordering::Relaxed);
        inner(chunk)
    };
    let id = conn_id.to_string();
    let res = with_connection(conn_id, move |a| async move {
        mongo_pipeline_run_stream_on(&*a, &id, req, &mut sink).await
    })
    .await;
    match &res {
        Ok(r) if r.cancelled => crate::activity::log_stmt_err(conn_id, "mongo", &script, t, &DbError::Cancelled),
        Ok(_) => {
            let rows = streamed.load(Ordering::Relaxed) as i64;
            crate::activity::log_stmt_ok(conn_id, "mongo", &script, t, rows)
        }
        Err(e) => crate::activity::log_stmt_err(conn_id, "mongo", &script, t, e),
    }
    res
}

/// [`mongo_pipeline_run_stream`] on an adapter the caller already holds, with
/// no activity log. A stopped run resolves as `Ok` with `cancelled: true`.
pub async fn mongo_pipeline_run_stream_on(
    a: &dyn DbAdapter,
    conn_id: &str,
    req: &PipelineRunRequest,
    sink: BatchSink<'_>,
) -> DbResult<MongoRunResult> {
    let t = std::time::Instant::now();
    let run = req.run_id.as_deref().map(|id| runs::register(conn_id, id));
    let run_ref = run.as_ref();
    let res = runs::until_abandoned(run_ref, a.mongo_pipeline_run(req, run_ref, sink)).await;
    if let Some(r) = &run {
        r.finish().await;
    }
    match res {
        Err(DbError::Cancelled) => Ok(MongoRunResult {
            cancelled: true,
            elapsed_ms: t.elapsed().as_millis(),
            ..Default::default()
        }),
        other => other,
    }
}
