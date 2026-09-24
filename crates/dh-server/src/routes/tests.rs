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
    let writes: [(&str, Value); 7] = [
        ("op", json!({"kind": "drop_table", "table": "t"})),
        ("schema-ops", json!({"ops": []})),
        ("duplicate", json!({"source": "a", "target": "b"})),
        (
            "import",
            json!({"request": {"table": "t", "data": {"kind": "rows", "columns": ["a"], "rows": [[1]]}}}),
        ),
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

// ---- more guards, limits and static files ----

fn keyed() -> Config {
    Config {
        access_key: Some("s3cret".into()),
        ..cfg()
    }
}

#[tokio::test]
async fn a_key_sent_under_another_scheme_or_empty_is_refused() {
    let (st, h) = state_with_handle(keyed()).await;
    let path = format!("/v1/c/{h}/tables");
    for auth in ["Basic s3cret", "Bearer ", "Bearer", "s3cret", "bearer s3cret"] {
        assert_eq!(
            call(&st, "GET", &path, &[("authorization", auth)], None).await.0,
            StatusCode::UNAUTHORIZED,
            "{auth}"
        );
    }
}

#[tokio::test]
async fn a_foreign_host_or_origin_is_refused_even_with_the_right_key() {
    let (st, h) = state_with_handle(keyed()).await;
    let path = format!("/v1/c/{h}/tables");
    let req = Request::builder()
        .uri(&path)
        .header(header::HOST, "evil.example")
        .header(header::AUTHORIZATION, "Bearer s3cret")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        router(st.clone(), None).oneshot(req).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let (status, _) = call(
        &st,
        "GET",
        &path,
        &[("authorization", "Bearer s3cret"), ("origin", "http://evil.example")],
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_request_with_no_host_header_is_refused() {
    let (st, _) = state_with_handle(cfg()).await;
    let req = Request::builder()
        .uri("/v1/info")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        router(st, None).oneshot(req).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn the_public_host_is_allowed_when_configured() {
    let (st, _) = state_with_handle(Config {
        public_url: Some("https://db.example.com".into()),
        ..cfg()
    })
    .await;
    let req = Request::builder()
        .uri("/v1/info")
        .header(header::HOST, "db.example.com")
        .header(header::ORIGIN, "https://db.example.com")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        router(st, None).oneshot(req).await.unwrap().status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn every_data_route_answers_404_for_an_unknown_handle_before_reading_the_body() {
    let (st, _) = state_with_handle(cfg()).await;
    let routes: [(&str, &str); 26] = [
        ("POST", "close"),
        ("GET", "tables"),
        ("GET", "schemas"),
        ("GET", "schema/t"),
        ("GET", "mongo/field-tree/c"),
        ("GET", "databases"),
        ("GET", "catalog"),
        ("POST", "schemas-in"),
        ("POST", "schema-objects"),
        ("GET", "roles"),
        ("POST", "extensions"),
        ("GET", "role-details"),
        ("GET", "active-schema"),
        ("PUT", "active-schema"),
        ("POST", "disconnect-database"),
        ("POST", "sql"),
        ("POST", "op"),
        ("POST", "schema-ops"),
        ("POST", "duplicate"),
        ("POST", "import"),
        ("POST", "import/capabilities"),
        ("POST", "mongo/documents"),
        ("POST", "mongo/documents/ext"),
        ("POST", "mongo/documents/save"),
        ("POST", "mongo/documents/insert"),
        ("POST", "mongo/run"),
    ];
    for (method, route) in routes {
        // `{}` is not a valid body for any of these, so a 404 proves the
        // handle was checked first.
        let (status, body) = call(
            &st,
            method,
            &format!("/v1/c/nope/{route}"),
            &[],
            Some(json!({})),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{method} {route}");
        assert!(body.contains("unknown_handle"), "{method} {route}: {body}");
    }
}

#[tokio::test]
async fn the_33rd_handle_evicts_the_least_recently_used_one_through_the_router() {
    let st = AppState::with_limits(cfg(), 2, Duration::from_secs(900));
    for name in ["h1", "h2", "h3"] {
        let a = SqliteAdapter::open("t", None, &ConnGuard::default())
            .await
            .unwrap();
        st.handles.insert(name.into(), Arc::new(a));
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    assert_eq!(st.handles.len(), 2);
    assert_eq!(
        call(&st, "GET", "/v1/c/h1/tables", &[], None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        call(&st, "GET", "/v1/c/h3/tables", &[], None).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn a_bad_connect_body_is_refused_and_opens_no_handle() {
    let (st, _) = state_with_handle(cfg()).await;
    let (status, text) = call(&st, "POST", "/v1/connect", &[], Some(json!([1, 2]))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(serde_json::from_str::<Value>(&text).unwrap()["error"], "invalid");
    let req = Request::builder()
        .method("POST")
        .uri("/v1/connect")
        .header(header::HOST, "localhost")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("{not json"))
        .unwrap();
    let res = router(st.clone(), None).oneshot(req).await.unwrap();
    assert!(res.status().is_client_error());
    assert_eq!(st.handles.len(), 1);
}

#[tokio::test]
async fn connect_answers_405_to_a_get() {
    let (st, _) = state_with_handle(cfg()).await;
    assert_eq!(
        call(&st, "GET", "/v1/connect", &[], None).await.0,
        StatusCode::METHOD_NOT_ALLOWED
    );
}

#[tokio::test]
async fn read_only_also_refuses_a_lock_breaker_and_a_write_hidden_after_a_read() {
    let (st, h) = state_with_handle(Config {
        read_only: true,
        ..cfg()
    })
    .await;
    for q in [
        "select set_config('default_transaction_read_only', 'off', false)",
        "select 1; drop table t",
    ] {
        let (status, body) = call(
            &st,
            "POST",
            &format!("/v1/c/{h}/sql"),
            &[],
            Some(json!({"sql": q, "read_only": false})),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{q}: {body}");
    }
}

#[tokio::test]
async fn without_the_server_switch_a_write_goes_through() {
    let (st, h) = state_with_handle(cfg()).await;
    let (status, body) = call(
        &st,
        "POST",
        &format!("/v1/c/{h}/sql"),
        &[],
        Some(json!({"sql": "create table t (a int)"})),
    )
    .await;
    assert!(status.is_success(), "{status} {body}");
}

struct Site(std::path::PathBuf);

impl Site {
    fn new() -> Self {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "dh-server-site-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.html"), "<h1>studio</h1>").unwrap();
        std::fs::write(dir.join("app.js"), "console.log(1)").unwrap();
        Site(dir)
    }

    async fn get(&self, st: &Shared, path: &str, host: &str) -> (StatusCode, String) {
        let req = Request::builder()
            .uri(path)
            .header(header::HOST, host)
            .body(Body::empty())
            .unwrap();
        let res = router(st.clone(), self.0.to_str()).oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }
}

impl Drop for Site {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[tokio::test]
async fn the_web_page_is_served_at_the_root_and_a_file_by_its_path() {
    let site = Site::new();
    let st = AppState::new(cfg());
    let (status, body) = site.get(&st, "/", "localhost").await;
    assert_eq!((status, body.as_str()), (StatusCode::OK, "<h1>studio</h1>"));
    let (status, body) = site.get(&st, "/app.js", "localhost").await;
    assert_eq!((status, body.as_str()), (StatusCode::OK, "console.log(1)"));
}

#[tokio::test]
async fn an_unknown_page_path_falls_back_to_the_index() {
    let site = Site::new();
    let st = AppState::new(cfg());
    let (_, body) = site.get(&st, "/some/deep/link", "localhost").await;
    assert_eq!(body, "<h1>studio</h1>");
}

#[tokio::test]
async fn static_files_stay_open_when_an_access_key_is_set() {
    let site = Site::new();
    let st = AppState::new(keyed());
    assert_eq!(site.get(&st, "/", "localhost").await.0, StatusCode::OK);
    assert_eq!(site.get(&st, "/app.js", "localhost").await.0, StatusCode::OK);
}

#[tokio::test]
async fn a_foreign_host_gets_403_for_a_page_too() {
    let site = Site::new();
    let st = AppState::new(cfg());
    assert_eq!(
        site.get(&st, "/", "evil.example").await.0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn with_no_static_dir_a_page_path_is_a_404() {
    let (st, _) = state_with_handle(cfg()).await;
    assert_eq!(
        call(&st, "GET", "/", &[], None).await.0,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn an_import_loads_rows_and_reports_them() {
    let (st, h) = state_with_handle(cfg()).await;
    let base = format!("/v1/c/{h}");
    let make = json!({"sql": "CREATE TABLE t (a INTEGER, b TEXT)"});
    assert_eq!(call(&st, "POST", &format!("{base}/sql"), &[], Some(make)).await.0, StatusCode::OK);
    let body = json!({"request": {
        "table": "t",
        "data": {"kind": "rows", "columns": ["a", "b"], "rows": [[1, "x"], [2, "y"]]},
    }});
    let (status, text) = call(&st, "POST", &format!("{base}/import"), &[], Some(body)).await;
    assert_eq!(status, StatusCode::OK, "{text}");
    let report: Value = serde_json::from_str(&text).unwrap();
    assert_eq!((report["inserted"].as_u64(), report["committed"].as_bool()), (Some(2), Some(true)));

    let (status, text) = call(&st, "POST", &format!("{base}/import/capabilities"), &[], Some(json!({}))).await;
    assert_eq!((status, text.as_str()), (StatusCode::OK, "{\"atomic\":true}"));
}
