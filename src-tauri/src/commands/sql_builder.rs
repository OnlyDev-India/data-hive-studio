use crate::api::{SqlBuilderPreviewRequest, SqlPreviewChunk, SqlPreviewSummary};
use super::to_err;

/// Preview query builder cards, read only; each card's result streams
/// through the channel as it lands, then the summary resolves. Stoppable
/// through `cancel_run`.
#[tauri::command]
pub async fn sql_builder_preview(
    conn_id: String,
    request: SqlBuilderPreviewRequest,
    channel: tauri::ipc::Channel<SqlPreviewChunk>,
) -> Result<SqlPreviewSummary, String> {
    crate::db::sql_builder_preview(&conn_id, &request, move |chunk| {
        channel
            .send(chunk)
            .map_err(|e| crate::db::DbError::InvalidOperation(format!("ipc send failed: {e}")))
    })
    .await
    .map_err(to_err)
}
