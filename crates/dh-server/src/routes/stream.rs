//! The streaming routes (spec 0011): the same reads as `/sql`, `/op` and
//! `/mongo/run`, answered as NDJSON so the page fills while the database is
//! still producing rows, plus `/cancel` to stop a run.
//!
//! One JSON object per line, tagged by `t`: `chunk` (rows), then `done` with
//! the final result (rows omitted), or `error` when the run failed after the
//! first chunk. A run that fails or is refused before any line was ready
//! answers with its normal status and text instead, so the existing error
//! handling and the read only hint keep working.

use super::data::op_reads;
use super::{fail, handle_of, Live, Shared};
use crate::bodies::{CancelBody, ExecuteOpBody, RunMongoBody, SqlBody};
use axum::body::{Body, Bytes};
use axum::extract::{RawPathParams, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use dh_core::api::QueryChunk;
use dh_core::db::{
    mongo_script_class, run_mongo_stream_on, run_sql_stream_on, sql_class, DbError, DbResult, Dialect, StmtClass,
};
use futures_util::future::BoxFuture;
use futures_util::Stream;
use serde::Serialize;
use serde_json::{json, Value};
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;
use tokio::sync::mpsc;

/// How many chunks may wait between the database task and the response. The
/// server holds no more rows than this for a stream.
const QUEUE: usize = 4;

type Sink = Box<dyn FnMut(QueryChunk) -> DbResult<()> + Send>;

enum Event {
    /// One finished NDJSON line, with its newline.
    Line(Bytes),
    /// The run failed before any line went out.
    Failed(String),
}

#[derive(Serialize)]
struct ChunkLine<'a> {
    t: &'static str,
    #[serde(flatten)]
    chunk: &'a QueryChunk,
}

fn line(value: &impl Serialize) -> Bytes {
    let mut text = serde_json::to_string(value).unwrap_or_else(|_| "{}".into());
    text.push('\n');
    Bytes::from(text)
}

pub(super) async fn sql_stream(
    State(st): State<Shared>,
    Live(a): Live,
    params: RawPathParams,
    Json(b): Json<SqlBody>,
) -> Response {
    // A script is refused as a whole before any statement runs.
    if sql_class(Dialect::Postgres, &b.sql) != StmtClass::Read {
        if let Err(r) = st.refuse_writes() {
            return r;
        }
    }
    let handle = handle_of(&params);
    let (run_id, id) = (b.run_id.clone(), handle.clone());
    stream_response(st, handle, run_id.clone(), move |sink| {
        Box::pin(async move {
            let mut sink = sink;
            let res = run_sql_stream_on(
                &*a,
                &id,
                b.database.as_deref(),
                b.schema.as_deref(),
                &b.sql,
                run_id.as_deref(),
                &mut *sink,
            )
            .await?;
            Ok(json!(res))
        })
    })
    .await
}

pub(super) async fn op_stream(
    State(st): State<Shared>,
    Live(a): Live,
    params: RawPathParams,
    Json(b): Json<ExecuteOpBody>,
) -> Response {
    if !op_reads(&b.op) {
        if let Err(r) = st.refuse_writes() {
            return r;
        }
    }
    stream_response(st, handle_of(&params), None, move |sink| {
        Box::pin(async move {
            let mut sink = sink;
            let outcome = a
                .execute_op_stream(b.database.as_deref(), b.schema.as_deref(), &b.op, &mut *sink)
                .await?;
            Ok(json!(outcome.result))
        })
    })
    .await
}

pub(super) async fn mongo_run_stream(
    State(st): State<Shared>,
    Live(a): Live,
    params: RawPathParams,
    Json(b): Json<RunMongoBody>,
) -> Response {
    if mongo_script_class(&b.script) != StmtClass::Read {
        if let Err(r) = st.refuse_writes() {
            return r;
        }
    }
    let handle = handle_of(&params);
    let (run_id, id) = (b.run_id.clone(), handle.clone());
    stream_response(st, handle, run_id.clone(), move |sink| {
        Box::pin(async move {
            let mut sink = sink;
            let res = run_mongo_stream_on(
                &*a,
                &id,
                &b.database,
                b.collection.as_deref(),
                &b.script,
                run_id.as_deref(),
                &mut *sink,
            )
            .await?;
            Ok(json!(res))
        })
    })
    .await
}

/// Stop a running stream. Cancel is allowed on a read only server: it writes
/// nothing. The run registry key is the handle plus the run id, so one handle
/// cannot stop another handle's run.
pub(super) async fn cancel(Live(_a): Live, params: RawPathParams, Json(b): Json<CancelBody>) -> Response {
    let outcome = dh_core::db::cancel_run(&handle_of(&params), &b.run_id).await;
    Json(outcome).into_response()
}

/// Run `work` on its own task, feeding its chunks to a response body. Nothing
/// is sent until the first line is ready, so a run that fails first still
/// answers with a normal status.
async fn stream_response(
    st: Shared,
    handle: String,
    run_id: Option<String>,
    work: impl FnOnce(Sink) -> BoxFuture<'static, DbResult<Value>> + Send + 'static,
) -> Response {
    let (tx, mut rx) = mpsc::channel::<Event>(QUEUE);
    let sent = Arc::new(AtomicBool::new(false));

    let sink_tx = tx.clone();
    let sink_sent = sent.clone();
    let sink: Sink = Box::new(move |chunk| {
        let bytes = line(&ChunkLine { t: "chunk", chunk: &chunk });
        sink_sent.store(true, Ordering::SeqCst);
        // The run calls this from async code, so waiting for room must not
        // stall the runtime's other tasks.
        tokio::task::block_in_place(|| sink_tx.blocking_send(Event::Line(bytes)))
            .map_err(|_| DbError::InvalidOperation("the client closed the stream".into()))
    });

    let keepalive = keep_handle_alive(st, handle.clone());
    tokio::spawn(async move {
        let res = work(sink).await;
        keepalive.abort();
        let event = match res {
            Ok(result) => Event::Line(line(&json!({"t": "done", "result": result}))),
            Err(e) if !sent.load(Ordering::SeqCst) => Event::Failed(e.to_string()),
            Err(e) => Event::Line(line(&json!({"t": "error", "message": e.to_string()}))),
        };
        let _ = tx.send(event).await;
    });

    match rx.recv().await {
        None => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        Some(Event::Failed(message)) => fail(message),
        Some(Event::Line(first)) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/x-ndjson")
            .header(header::CACHE_CONTROL, "no-store")
            .header("x-accel-buffering", "no")
            .body(Body::from_stream(Lines {
                first: Some(first),
                rx,
                ended: false,
                cancel: run_id.map(|id| (handle, id)),
            }))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
    }
}

/// A running stream counts as use of its handle, so a run longer than the
/// idle timeout does not lose its pool.
fn keep_handle_alive(st: Shared, handle: String) -> tokio::task::JoinHandle<()> {
    let every = (st.handles.idle() / 3).clamp(Duration::from_millis(10), Duration::from_secs(60));
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(every).await;
            let (_, expired) = st.handles.get(&handle);
            super::close_all(expired);
        }
    })
}

/// The response body. When the browser drops it before the run ended (tab
/// closed, navigation), the run is cancelled on the database.
struct Lines {
    first: Option<Bytes>,
    rx: mpsc::Receiver<Event>,
    ended: bool,
    cancel: Option<(String, String)>,
}

impl Stream for Lines {
    type Item = Result<Bytes, Infallible>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        if let Some(first) = self.first.take() {
            return Poll::Ready(Some(Ok(first)));
        }
        match self.rx.poll_recv(cx) {
            Poll::Ready(Some(Event::Line(bytes))) => Poll::Ready(Some(Ok(bytes))),
            // Only ever the first event; a later one cannot be a plain
            // failure, so treat it as the end.
            Poll::Ready(Some(Event::Failed(_))) => {
                self.ended = true;
                Poll::Ready(None)
            }
            Poll::Ready(None) => {
                self.ended = true;
                Poll::Ready(None)
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

impl Drop for Lines {
    fn drop(&mut self) {
        if self.ended {
            return;
        }
        if let Some((handle, run_id)) = self.cancel.take() {
            tokio::spawn(async move {
                dh_core::db::cancel_run(&handle, &run_id).await;
            });
        }
    }
}
