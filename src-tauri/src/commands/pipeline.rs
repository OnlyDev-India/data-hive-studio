use crate::api::{
    ComposedPipeline, GridFilterCond, MongoRunResult, ParsedPipeline, PipelinePreviewRequest, PipelineRunRequest, PipelineSpec,
    PreviewChunk, PreviewSummary, QueryChunk,
};

use super::to_err;

/// The aggregation builder's cards in every text form, with an error per
/// card that does not compose.
#[tauri::command]
pub fn mongo_pipeline_compose(collection: String, spec: PipelineSpec) -> ComposedPipeline {
    crate::db::compose_pipeline(&collection, &spec)
}

/// Pipeline text (shell `aggregate` call or JSON array) as cards.
#[tauri::command]
pub fn mongo_pipeline_parse(text: String) -> Result<ParsedPipeline, String> {
    crate::db::mongo_pipeline_parse(&text).map_err(to_err)
}

/// A stage value in canonical Extended JSON as card body text, for a form.
#[tauri::command]
pub fn mongo_pipeline_render_stage(op: String, value: serde_json::Value) -> Result<String, String> {
    crate::db::mongo_pipeline_render_stage(&op, value).map_err(to_err)
}

/// A collection grid's filter as a `$match` card body, null with no filter.
#[tauri::command]
pub fn mongo_filter_to_match(
    filters: Vec<GridFilterCond>,
    custom_where: Option<String>,
) -> Result<Option<String>, String> {
    crate::db::mongo_filter_to_match(&filters, custom_where.as_deref()).map_err(to_err)
}

/// Preview builder cards; each card's result streams through the channel as
/// it lands, then the summary resolves. Stoppable through `cancel_run`.
#[tauri::command]
pub async fn mongo_pipeline_preview(
    conn_id: String,
    request: PipelinePreviewRequest,
    channel: tauri::ipc::Channel<PreviewChunk>,
) -> Result<PreviewSummary, String> {
    crate::db::mongo_pipeline_preview(&conn_id, &request, move |chunk| {
        channel
            .send(chunk)
            .map_err(|e| crate::db::DbError::InvalidOperation(format!("ipc send failed: {e}")))
    })
    .await
    .map_err(to_err)
}

/// Run the whole pipeline, streaming like `run_mongo_stream`.
#[tauri::command]
pub async fn mongo_pipeline_run_stream(
    conn_id: String,
    request: PipelineRunRequest,
    channel: tauri::ipc::Channel<QueryChunk>,
) -> Result<MongoRunResult, String> {
    crate::db::mongo_pipeline_run_stream(&conn_id, &request, move |chunk| {
        channel
            .send(chunk)
            .map_err(|e| crate::db::DbError::InvalidOperation(format!("ipc send failed: {e}")))
    })
    .await
    .map_err(to_err)
}
