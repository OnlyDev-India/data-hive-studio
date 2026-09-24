//! Route tests. A live handle is made by putting an in memory SQLite adapter
//! straight into the registry, so no database server is needed.

use super::{router, AppState, Shared};
use crate::config::Config;
use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use dh_core::api::ConnGuard;
use dh_core::db::SqliteAdapter;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tower::ServiceExt;

fn cfg() -> Config {
    Config {
        bind: "127.0.0.1:8080".into(),
        ..Default::default()
    }
}

async fn state_with_handle(cfg: Config) -> (Shared, String) {
    let st = AppState::new(cfg);
    let a = SqliteAdapter::open("t", None, &ConnGuard::default())
        .await
        .unwrap();
    st.handles.insert("h1".into(), Arc::new(a));
    (st, "h1".into())
}

async fn call(
    st: &Shared,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Option<Value>,
) -> (StatusCode, String) {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, "localhost:8080");
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let req = match body {
        Some(b) => req
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(b.to_string()))
            .unwrap(),
        None => req.body(Body::empty()).unwrap(),
    };
    let res = router(st.clone(), None).oneshot(req).await.unwrap();
    let status = res.status();
    (
        status,
        String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap(),
    )
}

#[test]
fn a_handle_is_128_random_bits_as_base64url() {
    let a = super::new_handle();
    let b = super::new_handle();
    assert_ne!(a, b);
    // 16 bytes without padding is 22 characters.
    assert_eq!(a.len(), 22);
    assert!(a
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
}

#[tokio::test]
async fn an_unknown_handle_answers_404_before_the_body_is_read() {
    let (st, _) = state_with_handle(cfg()).await;
    // A body that would not even parse: the handle check must come first.
    let req = Request::builder()
        .method("POST")
        .uri("/v1/c/nope/sql")
        .header(header::HOST, "localhost")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{not json"))
        .unwrap();
    let res = router(st, None).oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
    let body =
        String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!({"error": "unknown_handle"})
    );
}

#[tokio::test]
async fn a_live_handle_serves_a_data_route() {
    let (st, h) = state_with_handle(cfg()).await;
    let (status, body) = call(
        &st,
        "POST",
        &format!("/v1/c/{h}/sql"),
        &[],
        Some(json!({"sql": "select 1 as one"})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("one"));
    let (status, _) = call(&st, "GET", &format!("/v1/c/{h}/tables"), &[], None).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn close_frees_the_handle_at_once() {
    let (st, h) = state_with_handle(cfg()).await;
    assert_eq!(
        call(&st, "POST", &format!("/v1/c/{h}/close"), &[], None)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        call(&st, "GET", &format!("/v1/c/{h}/tables"), &[], None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(&st, "POST", &format!("/v1/c/{h}/close"), &[], None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn an_idle_handle_answers_404() {
    let st = AppState::with_limits(cfg(), 32, Duration::from_millis(30));
    let a = SqliteAdapter::open("t", None, &ConnGuard::default())
        .await
        .unwrap();
    st.handles.insert("h1".into(), Arc::new(a));
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert_eq!(
        call(&st, "GET", "/v1/c/h1/tables", &[], None).await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn the_access_key_guards_every_v1_route_but_info() {
    let (st, h) = state_with_handle(Config {
        access_key: Some("s3cret".into()),
        ..cfg()
    })
    .await;
    let path = format!("/v1/c/{h}/tables");
    assert_eq!(
        call(&st, "GET", &path, &[], None).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &st,
            "GET",
            &path,
            &[("authorization", "Bearer wrong")],
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &st,
            "GET",
            &path,
            &[("authorization", "Bearer s3cret-and-more")],
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        call(
            &st,
            "GET",
            &path,
            &[("authorization", "Bearer s3cret")],
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(&st, "POST", "/v1/connect", &[], Some(json!({})))
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    let (status, body) = call(&st, "GET", "/v1/info", &[], None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!({"key_required": true, "read_only": false})
    );
}

#[tokio::test]
async fn with_no_key_everything_is_open() {
    let (st, h) = state_with_handle(cfg()).await;
    assert_eq!(
        call(&st, "GET", &format!("/v1/c/{h}/tables"), &[], None)
            .await
            .0,
        StatusCode::OK
    );
    let (_, body) = call(&st, "GET", "/v1/info", &[], None).await;
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap(),
        json!({"key_required": false, "read_only": false})
    );
}

#[tokio::test]
async fn a_foreign_host_or_origin_gets_403() {
    let (st, h) = state_with_handle(cfg()).await;
    let path = format!("/v1/c/{h}/tables");
    let req = Request::builder()
        .uri(&path)
        .header(header::HOST, "evil.example")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        router(st.clone(), None)
            .oneshot(req)
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &st,
            "GET",
            &path,
            &[("origin", "http://evil.example")],
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        call(
            &st,
            "GET",
            &path,
            &[("origin", "http://localhost:8080")],
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    // The 403 for a foreign Origin also covers the open info route.
    assert_eq!(
        call(
            &st,
            "GET",
            "/v1/info",
            &[("origin", "http://evil.example")],
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn no_cors_headers_are_sent() {
    let (st, _) = state_with_handle(cfg()).await;
    let req = Request::builder()
        .uri("/v1/info")
        .header(header::HOST, "localhost")
        .body(Body::empty())
        .unwrap();
    let res = router(st, None).oneshot(req).await.unwrap();
    assert!(res.headers().get("access-control-allow-origin").is_none());
}

#[tokio::test]
async fn read_only_refuses_every_write_whatever_the_client_sends() {
    let (st, h) = state_with_handle(Config {
        read_only: true,
        ..cfg()
    })
    .await;
    let base = format!("/v1/c/{h}");
    let sql = |q: &str| Some(json!({"sql": q, "read_only": false}));
    // Reads still work.
    assert_eq!(
        call(&st, "POST", &format!("{base}/sql"), &[], sql("select 1"))
            .await
            .0,
        StatusCode::OK
    );
    for q in [
        "create table t (a int)",
        "insert into t values (1)",
        "drop table t",
    ] {
        assert_eq!(
            call(&st, "POST", &format!("{base}/sql"), &[], sql(q))
                .await
                .0,
            StatusCode::FORBIDDEN,
            "{q}"
        );
    }
    let writes: [(&str, Value); 6] = [
        ("op", json!({"kind": "drop_table", "table": "t"})),
        ("schema-ops", json!({"ops": []})),
        ("duplicate", json!({"source": "a", "target": "b"})),
        (
            "mongo/documents/save",
            json!({"collection": "c", "id": "1", "document_text": "{}"}),
        ),
        (
            "mongo/documents/insert",
            json!({"collection": "c", "document_text": "{}"}),
        ),
        ("mongo/collections", json!({"name": "c"})),
    ];
    for (route, body) in writes {
        let (status, text) = call(&st, "POST", &format!("{base}/{route}"), &[], Some(body)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{route}: {text}");
    }
    let (status, _) = call(
        &st,
        "POST",
        &format!("{base}/mongo/run"),
        &[],
        Some(json!({"database": "d", "script": "db.c.insertOne({})"})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (_, body) = call(&st, "GET", "/v1/info", &[], None).await;
    assert!(body.contains("\"read_only\":true"));
}

#[tokio::test]
async fn connect_names_the_refused_field_with_422() {
    let (st, _) = state_with_handle(cfg()).await;
    for (body, field) in [
        (json!({"kind": "sqlite", "host": "x"}), "kind"),
        (
            json!({"kind": "postgres", "host": "h", "user": "u", "ssl_ca_file": "/ca.pem"}),
            "ssl_ca_file",
        ),
        (
            json!({"kind": "postgres", "host": "h", "user": "u", "ssh": {"host": "j", "user": "u", "key_file": "/k"}}),
            "ssh.key_file",
        ),
    ] {
        let (status, text) = call(&st, "POST", "/v1/connect", &[], Some(body)).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(
            serde_json::from_str::<Value>(&text).unwrap()["field"],
            field
        );
    }
}

#[tokio::test]
async fn an_unreachable_database_is_a_502_with_no_secret_in_the_body() {
    let (st, _) = state_with_handle(cfg()).await;
    let body = json!({"kind": "postgres", "host": "127.0.0.1", "port": 1, "user": "u", "password": "hunter2-secret", "database": "d",
        "connect_timeout_secs": 2});
    let (status, text) = call(&st, "POST", "/v1/connect", &[], Some(body)).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY, "{text}");
    assert!(!text.contains("hunter2-secret"));
    assert_eq!(st.handles.len(), 1);
}
