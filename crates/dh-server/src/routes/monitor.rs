//! The server monitor's two routes (spec 0025). A snapshot is never logged; a
//! kill is refused whole on a `DH_READ_ONLY` server, whatever the browser
//! sends, because a kill is not a write and so never reaches the adapter's
//! own read only guard.

use super::{handle_of, json_or, Live, Shared};
use axum::body::Bytes;
use axum::extract::{RawPathParams, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use dh_core::api::KillRequest;
use dh_core::db::{monitor_kill_on, monitor_snapshot_on, MONITOR_UNAVAILABLE_PREFIX};
use serde_json::json;

/// 422 when this connection cannot be monitored (SQLite, an old Postgres, a
/// Mongo without `$currentOp`), 504 when the read hit its 2 second limit.
fn snapshot_error(text: String) -> Response {
    let lower = text.to_lowercase();
    let status = if lower.contains("statement timeout") || lower.contains("exceeded time limit") {
        StatusCode::GATEWAY_TIMEOUT
    } else if text.contains(MONITOR_UNAVAILABLE_PREFIX) || lower.contains("not available for this connection") {
        StatusCode::UNPROCESSABLE_ENTITY
    } else {
        StatusCode::BAD_REQUEST
    };
    (status, text).into_response()
}

pub(super) async fn snapshot(Live(a): Live, params: RawPathParams) -> Response {
    match monitor_snapshot_on(&handle_of(&params), a.as_ref()).await {
        Ok(snap) => Json(snap).into_response(),
        Err(e) => snapshot_error(e.to_string()),
    }
}

pub(super) async fn kill(State(st): State<Shared>, Live(a): Live, params: RawPathParams, body: Bytes) -> Response {
    if st.cfg.read_only {
        return (StatusCode::FORBIDDEN, Json(json!({"error": "server_read_only"}))).into_response();
    }
    let req: KillRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({"error": "invalid", "message": e.to_string()})),
            )
                .into_response()
        }
    };
    json_or(monitor_kill_on(&handle_of(&params), a.as_ref(), req).await)
}
