//! Table comparison (spec 0018): `/compare/data` streams a data diff as
//! NDJSON, and `/compare/file` streams an export or a data sync script as a
//! download. The path's handle is the left side; the body names the right
//! side's handle, which must be open on this server too.

use super::stream::{keep_handle_alive, stream_response};
use super::{close_all, fail, handle_of, Live, Shared};
use axum::body::{Body, Bytes};
use axum::extract::{RawPathParams, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use dh_core::api::{CompareChunk, CompareDataRequest, CompareFileKind, CompareStatus};
use dh_core::db::{compare_data_on, compare_to_writer_on, DbAdapter, ScriptSyntax};
use futures_util::{stream, StreamExt};
use serde::Deserialize;
use serde_json::json;
use std::io::{self, Write};
use std::sync::Arc;
use tokio::sync::mpsc;

/// A read, so a read only server allows it. Stop reaches it through the left
/// handle's `/cancel`.
pub(super) async fn data(
    State(st): State<Shared>,
    Live(left): Live,
    params: RawPathParams,
    Json(req): Json<CompareDataRequest>,
) -> Response {
    let Some(right) = right_side(&st, &req) else {
        return fail("The right side's connection is not open on the server. Reopen it and try again.");
    };
    let handle = handle_of(&params);
    let id = handle.clone();
    let right_alive = keep_handle_alive(st.clone(), req.right.conn_id.clone());
    stream_response::<CompareChunk>(st, handle, Some(req.run_id.clone()), move |sink| {
        Box::pin(async move {
            let mut sink = sink;
            let summary = compare_data_on(&*left, &*right, &id, &req, &mut *sink).await;
            right_alive.abort();
            Ok(json!(summary?))
        })
    })
    .await
}

fn right_side(st: &Shared, req: &CompareDataRequest) -> Option<Arc<dyn DbAdapter>> {
    let (right, expired) = st.handles.get(&req.right.conn_id);
    close_all(expired);
    right
}

#[derive(Deserialize)]
pub(super) struct FileBody {
    #[serde(flatten)]
    request: CompareDataRequest,
    kind: CompareFileKind,
}

/// How much of the file is sent at once, and how many pieces may wait.
const PIECE: usize = 64 * 1024;
const QUEUE: usize = 4;

enum Piece {
    Bytes(Bytes),
    Failed(String),
    Done,
}

/// Hands the file to the response in pieces, waiting for room so the server
/// never holds more than a few pieces.
struct BodyWriter {
    buf: Vec<u8>,
    tx: mpsc::Sender<Piece>,
}

impl BodyWriter {
    fn send(&mut self) -> io::Result<()> {
        if self.buf.is_empty() {
            return Ok(());
        }
        let piece = Piece::Bytes(Bytes::from(std::mem::take(&mut self.buf)));
        tokio::task::block_in_place(|| self.tx.blocking_send(piece))
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "the client closed the download"))
    }
}

impl Write for BodyWriter {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        self.buf.extend_from_slice(data);
        if self.buf.len() >= PIECE {
            self.send()?;
        }
        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.send()
    }
}

fn file_name(req: &CompareDataRequest, kind: CompareFileKind, syntax: ScriptSyntax) -> (String, &'static str) {
    let base = format!("{}-vs-{}", req.left.table, req.right.table);
    let safe: String = base.chars().map(|c| if c.is_alphanumeric() || "-_.".contains(c) { c } else { '_' }).collect();
    match kind {
        CompareFileKind::Csv => (format!("{safe}.csv"), "text/csv; charset=utf-8"),
        CompareFileKind::Json => (format!("{safe}.json"), "application/json"),
        CompareFileKind::SyncScript if syntax == ScriptSyntax::Mongosh => {
            (format!("{safe}-sync.js"), "text/javascript; charset=utf-8")
        }
        CompareFileKind::SyncScript => (format!("{safe}-sync.sql"), "application/sql; charset=utf-8"),
    }
}

/// Every difference as a file download. Nothing is written to the server's
/// disk. A run that fails before the first piece answers with a normal
/// error; one that fails later cuts the download short.
pub(super) async fn file(
    State(st): State<Shared>,
    Live(left): Live,
    params: RawPathParams,
    Json(body): Json<FileBody>,
) -> Response {
    let FileBody { request: req, kind } = body;
    let Some(right) = right_side(&st, &req) else {
        return fail("The right side's connection is not open on the server. Reopen it and try again.");
    };
    let (name, content_type) = file_name(&req, kind, right.script_syntax());
    let handle = handle_of(&params);
    let (tx, mut rx) = mpsc::channel::<Piece>(QUEUE);
    let left_alive = keep_handle_alive(st.clone(), handle.clone());
    let right_alive = keep_handle_alive(st, req.right.conn_id.clone());
    tokio::spawn(async move {
        let mut w = BodyWriter { buf: Vec::new(), tx: tx.clone() };
        let res = compare_to_writer_on(&*left, &*right, &handle, &req, kind, &mut w).await;
        left_alive.abort();
        right_alive.abort();
        let last = match res {
            Ok(s) if s.status == CompareStatus::Done => Piece::Done,
            Ok(_) => Piece::Failed("The export was stopped.".into()),
            Err(e) => Piece::Failed(e.to_string()),
        };
        let _ = tx.send(last).await;
    });

    let first = match rx.recv().await {
        None => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        Some(Piece::Failed(message)) => return fail(message),
        Some(Piece::Done) => Bytes::new(),
        Some(Piece::Bytes(b)) => b,
    };
    let rest = stream::unfold(Some(rx), |rx| async move {
        let mut rx = rx?;
        match rx.recv().await {
            Some(Piece::Bytes(b)) => Some((Ok(b), Some(rx))),
            Some(Piece::Failed(message)) => Some((Err(io::Error::other(message)), None)),
            Some(Piece::Done) | None => None,
        }
    });
    let body = stream::once(async move { Ok::<_, io::Error>(first) }).chain(rest);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{name}\""))
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from_stream(body))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}
