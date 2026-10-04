//! The aggregation builder: parse, compose and the filter seed are pure
//! and need no handle; previews and Run stream as NDJSON like the console.

use super::stream::stream_response;
use super::{handle_of, json_or, Live, Shared};
use crate::bodies::{ComposePipelineBody, FilterMatchBody, ParsePipelineBody, RenderStageBody};
use axum::extract::{RawPathParams, State};
use axum::response::Response;
use axum::Json;
use dh_core::api::{PipelinePreviewRequest, PipelineRunRequest, PreviewChunk};
use dh_core::db::{
    compose_pipeline, mongo_filter_to_match, mongo_pipeline_parse, mongo_pipeline_preview_on, mongo_pipeline_render_stage,
    mongo_pipeline_run_stream_on, pipeline_write_stage,
};
use serde_json::json;

pub(super) async fn compose(Json(b): Json<ComposePipelineBody>) -> Response {
    json_or(Ok::<_, String>(compose_pipeline(&b.collection, &b.spec)))
}

pub(super) async fn parse(Json(b): Json<ParsePipelineBody>) -> Response {
    json_or(mongo_pipeline_parse(&b.text))
}

pub(super) async fn render(Json(b): Json<RenderStageBody>) -> Response {
    json_or(mongo_pipeline_render_stage(&b.op, b.value))
}

pub(super) async fn filter_match(Json(b): Json<FilterMatchBody>) -> Response {
    json_or(mongo_filter_to_match(&b.filters, b.custom_where.as_deref()))
}

/// Previews never write, so a read only server allows them.
pub(super) async fn preview_stream(
    State(st): State<Shared>,
    Live(a): Live,
    params: RawPathParams,
    Json(req): Json<PipelinePreviewRequest>,
) -> Response {
    let handle = handle_of(&params);
    let (run_id, id) = (req.run_id.clone(), handle.clone());
    stream_response::<PreviewChunk>(st, handle, run_id, move |sink| {
        Box::pin(async move {
            let mut sink = sink;
            let summary = mongo_pipeline_preview_on(&*a, &id, &req, &mut *sink).await?;
            Ok(json!(summary))
        })
    })
    .await
}

pub(super) async fn run_stream(
    State(st): State<Shared>,
    Live(a): Live,
    params: RawPathParams,
    Json(req): Json<PipelineRunRequest>,
) -> Response {
    if pipeline_write_stage(&req.spec).is_some() {
        if let Err(r) = st.refuse_writes() {
            return r;
        }
    }
    let handle = handle_of(&params);
    let (run_id, id) = (req.run_id.clone(), handle.clone());
    stream_response(st, handle, run_id, move |sink| {
        Box::pin(async move {
            let mut sink = sink;
            let res = mongo_pipeline_run_stream_on(&*a, &id, &req, &mut *sink).await?;
            Ok(json!(res))
        })
    })
    .await
}
