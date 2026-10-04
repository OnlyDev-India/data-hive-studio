use crate::api::{CompareChunk, CompareDataRequest, CompareFileKind, CompareFileSummary, CompareSummary};

use super::to_err;

/// Diff two tables' rows. Differences stream through the channel in
/// batches, then the summary resolves. `run_id` makes it stoppable through
/// `cancel_run` under the left connection; a stopped diff resolves with
/// status `stopped`, keeping what was sent.
#[tauri::command]
pub async fn compare_data(
    request: CompareDataRequest,
    channel: tauri::ipc::Channel<CompareChunk>,
) -> Result<CompareSummary, String> {
    crate::db::compare_data(&request, move |chunk| {
        channel
            .send(chunk)
            .map_err(|e| crate::db::DbError::InvalidOperation(format!("ipc send failed: {e}")))
    })
    .await
    .map_err(to_err)
}

/// Write every difference (CSV or JSON) or the data sync script to `path`,
/// from a fresh run with the request's key, columns, and filter. Stoppable
/// like `compare_data`; a stopped run writes no file.
#[tauri::command]
pub async fn compare_data_to_file(
    request: CompareDataRequest,
    kind: CompareFileKind,
    path: String,
) -> Result<CompareFileSummary, String> {
    crate::db::compare_data_to_file(&request, kind, &path).await.map_err(to_err)
}
