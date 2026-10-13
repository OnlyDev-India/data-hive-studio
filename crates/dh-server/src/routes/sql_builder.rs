//! The SQL query builder's previews, streamed as NDJSON like the console.
//! Run goes through `/sql/stream` with `read_only`.

use super::stream::stream_response;
use super::{handle_of, Live, Shared};
use axum::extract::{RawPathParams, State};
use axum::response::Response;
use axum::Json;
use dh_core::api::{SqlBuilderPreviewRequest, SqlPreviewChunk};
use dh_core::db::sql_builder_preview_on;
use serde_json::json;

/// Previews run read only, so a read only server allows them.
pub(super) async fn preview_stream(
    State(st): State<Shared>,
    Live(a): Live,
    params: RawPathParams,
    Json(req): Json<SqlBuilderPreviewRequest>,
) -> Response {
    let handle = handle_of(&params);
    let (run_id, id) = (req.run_id.clone(), handle.clone());
    stream_response::<SqlPreviewChunk>(st, handle, run_id, move |sink| {
        Box::pin(async move {
            let mut sink = sink;
            let summary = sql_builder_preview_on(&*a, &id, &req, &mut *sink).await?;
            Ok(json!(summary))
        })
    })
    .await
}
