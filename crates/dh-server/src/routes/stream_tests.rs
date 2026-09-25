//! Streaming route tests (spec 0011), on an in memory SQLite handle. The
//! routes wait for room with `block_in_place`, so these run on a multi thread
//! runtime like the real server.

use super::{router, AppState, Shared};
use crate::config::Config;
use axum::body::Body;
use axum::http::{header, Request, Response, StatusCode};
use dh_core::api::ConnGuard;
use dh_core::db::SqliteAdapter;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::sync::Arc;
use tower::ServiceExt;

const LONG_QUERY: &str = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 200000000) SELECT x FROM c";

fn cfg() -> Config {
    Config { bind: "127.0.0.1:8080".into(), ..Default::default() }
}

async fn state(cfg: Config) -> Shared {
    let st = AppState::new(cfg);
    let a = SqliteAdapter::open("t", None, &ConnGuard::default()).await.unwrap();
    st.handles.insert("h1".into(), Arc::new(a));
    st
}

async fn post(st: &Shared, path: &str, body: Value) -> Response<Body> {
    let req = Request::builder()
        .method("POST")
        .uri(path)
        .header(header::HOST, "localhost:8080")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    router(st.clone(), None).oneshot(req).await.unwrap()
}

async fn text(res: Response<Body>) -> String {
    String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap()
}

fn events(body: &str) -> Vec<Value> {
    body.lines().map(|l| serde_json::from_str(l).unwrap()).collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_select_answers_ndjson_chunks_then_a_done_line() {
    let st = state(cfg()).await;
    let res = post(&st, "/v1/c/h1/sql-stream", json!({"sql": "select 1 as one union select 2"})).await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers()[header::CONTENT_TYPE], "application/x-ndjson");
    assert_eq!(res.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(res.headers()["x-accel-buffering"], "no");
    let lines = events(&text(res).await);
    assert!(lines.iter().all(|l| l["t"] == "chunk" || l["t"] == "done"));
    let rows: usize = lines.iter().filter(|l| l["t"] == "chunk").map(|l| l["rows"].as_array().unwrap().len()).sum();
    assert_eq!(rows, 2);
    let done = lines.last().unwrap();
    assert_eq!(done["t"], "done");
    assert_eq!(done["result"]["columns"], json!(["one"]));
    assert_eq!(done["result"]["rows"], json!([]));
}

#[tokio::test(flavor = "multi_thread")]
async fn the_first_line_arrives_before_the_query_has_finished() {
    let st = state(cfg()).await;
    let started = std::time::Instant::now();
    let res = post(&st, "/v1/c/h1/sql-stream", json!({"sql": LONG_QUERY, "run_id": "first-line"})).await;
    assert_eq!(res.status(), StatusCode::OK);
    let mut body = res.into_body();
    let frame = body.frame().await.unwrap().unwrap().into_data().unwrap();
    assert!(!frame.is_empty());
    assert!(started.elapsed().as_secs() < 5, "the first line waited for the whole query");
    // Stop the rest of it; the stream then ends with a done line.
    let stopped = post(&st, "/v1/c/h1/cancel", json!({"run_id": "first-line"})).await;
    assert_eq!(stopped.status(), StatusCode::OK);
    let mut tail = String::new();
    while let Some(frame) = body.frame().await {
        if let Ok(data) = frame.unwrap().into_data() {
            tail.push_str(&String::from_utf8_lossy(&data));
        }
    }
    let last: Value = serde_json::from_str(tail.lines().last().unwrap()).unwrap();
    assert_eq!(last["t"], "done");
    assert_eq!(last["result"]["cancelled"], true);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_bad_statement_keeps_its_normal_400_with_text() {
    let st = state(cfg()).await;
    let res = post(&st, "/v1/c/h1/sql-stream", json!({"sql": "select * from missing_table"})).await;
    assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    assert!(text(res).await.to_lowercase().contains("missing_table"));
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unknown_handle_answers_404_before_the_body_is_read() {
    let st = state(cfg()).await;
    for path in ["sql-stream", "op-stream", "mongo/run-stream", "cancel"] {
        let req = Request::builder()
            .method("POST")
            .uri(format!("/v1/c/nope/{path}"))
            .header(header::HOST, "localhost")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("{not json"))
            .unwrap();
        let res = router(st.clone(), None).oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "{path}");
        assert_eq!(serde_json::from_str::<Value>(&text(res).await).unwrap(), json!({"error": "unknown_handle"}));
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_read_only_server_refuses_a_write_before_the_first_byte() {
    let st = state(Config { read_only: true, ..cfg() }).await;
    for (path, body) in [
        ("sql-stream", json!({"sql": "insert into t values (1)"})),
        ("op-stream", json!({"kind": "drop_table", "table": "t"})),
        ("mongo/run-stream", json!({"database": "d", "script": "db.c.deleteMany({})"})),
    ] {
        let res = post(&st, &format!("/v1/c/h1/{path}"), body).await;
        assert_eq!(res.status(), StatusCode::FORBIDDEN, "{path}");
    }
    // A read still streams.
    let res = post(&st, "/v1/c/h1/sql-stream", json!({"sql": "select 1"})).await;
    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test(flavor = "multi_thread")]
async fn cancel_of_a_finished_unknown_or_other_handles_run_is_not_running() {
    let st = state(cfg()).await;
    let other = SqliteAdapter::open("t", None, &ConnGuard::default()).await.unwrap();
    st.handles.insert("h2".into(), Arc::new(other));
    let res = post(&st, "/v1/c/h1/sql-stream", json!({"sql": "select 1", "run_id": "done-run"})).await;
    let _ = text(res).await;
    let finished = post(&st, "/v1/c/h1/cancel", json!({"run_id": "done-run"})).await;
    assert_eq!(serde_json::from_str::<Value>(&text(finished).await).unwrap(), json!({"state": "not_running"}));

    let unknown = post(&st, "/v1/c/h1/cancel", json!({"run_id": "never-existed"})).await;
    assert_eq!(serde_json::from_str::<Value>(&text(unknown).await).unwrap(), json!({"state": "not_running"}));

    // A run cannot be stopped through a different handle.
    let res = post(&st, "/v1/c/h1/sql-stream", json!({"sql": LONG_QUERY, "run_id": "owned-by-h1"})).await;
    let mut body = res.into_body();
    body.frame().await.unwrap().unwrap();
    let wrong = post(&st, "/v1/c/h2/cancel", json!({"run_id": "owned-by-h1"})).await;
    assert_eq!(serde_json::from_str::<Value>(&text(wrong).await).unwrap(), json!({"state": "not_running"}));
    post(&st, "/v1/c/h1/cancel", json!({"run_id": "owned-by-h1"})).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn dropping_the_response_cancels_the_run() {
    let st = state(cfg()).await;
    let res = post(&st, "/v1/c/h1/sql-stream", json!({"sql": LONG_QUERY, "run_id": "dropped"})).await;
    let mut body = res.into_body();
    body.frame().await.unwrap().unwrap();
    drop(body);
    // The run leaves the registry once the database stopped it, so a later
    // cancel finds nothing to stop.
    let mut state_seen = String::new();
    for _ in 0..40 {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let out = post(&st, "/v1/c/h1/cancel", json!({"run_id": "dropped"})).await;
        state_seen = text(out).await;
        if state_seen.contains("not_running") {
            return;
        }
    }
    panic!("the run was still going after the response was dropped: {state_seen}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_running_stream_keeps_its_handle_alive_past_the_idle_limit() {
    let st = AppState::with_limits(cfg(), 32, std::time::Duration::from_secs(1));
    let a = SqliteAdapter::open("t", None, &ConnGuard::default()).await.unwrap();
    st.handles.insert("h1".into(), Arc::new(a));
    let res = post(&st, "/v1/c/h1/sql-stream", json!({"sql": LONG_QUERY, "run_id": "idle-run"})).await;
    let mut body = res.into_body();
    body.frame().await.unwrap().unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
    assert!(st.handles.get("h1").0.is_some(), "the handle went idle while its stream was running");
    post(&st, "/v1/c/h1/cancel", json!({"run_id": "idle-run"})).await;
}
