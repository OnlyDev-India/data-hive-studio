//! MySQL and MariaDB through the team server (spec 0025 AC-26), against real
//! servers, `#[ignore]`d like the other live tests:
//!
//! ```text
//! DH_TEST_MYSQL_URL=mysql://root:pw@127.0.0.1:3316/dh_test \
//! DH_TEST_MARIADB_URL=mysql://root:pw@127.0.0.1:3317/dh_test \
//!   cargo test -p dh-server -- --ignored mysql_route
//! ```
//!
//! Each test runs on every server whose URL is set, connecting with the
//! picker entry that matches it.

use super::{router, AppState, Shared};
use crate::config::Config;
use axum::body::Body;
use axum::http::{header, Request, Response, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;

fn servers() -> Vec<(&'static str, String)> {
    [("mysql", "DH_TEST_MYSQL_URL"), ("mariadb", "DH_TEST_MARIADB_URL")]
        .into_iter()
        .filter_map(|(kind, key)| std::env::var(key).ok().map(|v| (kind, v)))
        .collect()
}

/// The `/v1/connect` body for a `mysql://user:pw@host:port/db` URL.
fn details(kind: &str, url: &str) -> Value {
    let rest = url.split_once("://").expect("a mysql:// url").1;
    let (auth, tail) = rest.split_once('@').expect("user@host in the url");
    let (user, password) = auth.split_once(':').unwrap_or((auth, ""));
    let (hostport, database) = tail.split_once('/').unwrap_or((tail, ""));
    let (host, port) = hostport.split_once(':').unwrap_or((hostport, "3306"));
    json!({
        "kind": kind, "host": host, "port": port.parse::<u16>().unwrap(),
        "user": user, "password": password, "database": database,
    })
}

fn state() -> Shared {
    AppState::new(Config { bind: "127.0.0.1:8080".into(), ..Default::default() })
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

/// Every chunk's rows, then the done line.
fn streamed(body: &str) -> (Vec<Value>, Value) {
    let lines: Vec<Value> = body.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    let rows = lines
        .iter()
        .filter(|l| l["t"] == "chunk")
        .flat_map(|l| l["rows"].as_array().unwrap().clone())
        .collect();
    (rows, lines.last().unwrap().clone())
}

async fn connect(st: &Shared, kind: &str, url: &str) -> (String, Value) {
    let res = post(st, "/v1/connect", details(kind, url)).await;
    assert_eq!(res.status(), StatusCode::OK, "{kind}");
    let body: Value = serde_json::from_str(&text(res).await).unwrap();
    (body["handle"].as_str().unwrap().to_string(), body["server"].clone())
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_route_connects_and_reports_the_detected_server() {
    for (kind, url) in servers() {
        let st = state();
        let (_, server) = connect(&st, kind, &url).await;
        assert_eq!(server["flavor"], kind, "{server}");
        assert!(server["version"].as_str().unwrap().split('.').count() == 3, "{server}");
        // The other picker entry still connects; the reply names the server
        // actually reached.
        let other = if kind == "mysql" { "mariadb" } else { "mysql" };
        let (_, server) = connect(&st, other, &url).await;
        assert_eq!(server["flavor"], kind, "{server}");
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_route_refuses_file_paths_before_connecting() {
    for (kind, url) in servers() {
        let st = state();
        let mut body = details(kind, &url);
        body["ssl_ca_file"] = json!("/etc/ssl/ca.pem");
        let res = post(&st, "/v1/connect", body).await;
        assert_eq!(res.status(), StatusCode::UNPROCESSABLE_ENTITY, "{kind}");
        let refusal: Value = serde_json::from_str(&text(res).await).unwrap();
        assert_eq!(refusal["field"], "ssl_ca_file", "{kind}");
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_route_a_wrong_password_never_echoes_it() {
    for (kind, url) in servers() {
        let st = state();
        let mut body = details(kind, &url);
        body["password"] = json!("not-the-password-1234");
        let res = post(&st, "/v1/connect", body).await;
        assert_eq!(res.status(), StatusCode::BAD_GATEWAY, "{kind}");
        let message = text(res).await;
        assert!(message.contains("1045") && !message.contains("not-the-password-1234"), "{kind}: {message}");
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_route_streams_a_query_and_a_filtered_grid_read() {
    for (kind, url) in servers() {
        let st = state();
        let (h, _) = connect(&st, kind, &url).await;
        let sql = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 900) SELECT i FROM n";
        let res = post(&st, &format!("/v1/c/{h}/sql-stream"), json!({ "sql": sql })).await;
        assert_eq!(res.status(), StatusCode::OK, "{kind}");
        let (rows, done) = streamed(&text(res).await);
        assert_eq!(rows.len(), 900, "{kind}");
        assert_eq!(done["t"], "done", "{kind}");

        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let t = format!("dh_route_{kind}_{nanos}");
        let setup = format!("CREATE TABLE {t} (id INT PRIMARY KEY, b BIT(4))");
        assert_eq!(post(&st, &format!("/v1/c/{h}/sql"), json!({ "sql": setup })).await.status(), StatusCode::OK);
        let fill = format!("INSERT INTO {t} VALUES (1, b'0101'), (2, b'0011')");
        assert_eq!(post(&st, &format!("/v1/c/{h}/sql"), json!({ "sql": fill })).await.status(), StatusCode::OK);

        let op = json!({
            "kind": "select", "table": t,
            "filters": [{ "column": "b", "op": "eq", "value": "b'0101'" }],
        });
        let res = post(&st, &format!("/v1/c/{h}/op-stream"), op).await;
        assert_eq!(res.status(), StatusCode::OK, "{kind}");
        let (rows, _) = streamed(&text(res).await);
        assert_eq!(rows, vec![json!(["1", "b'0101'"])], "{kind}");

        let drop = format!("DROP TABLE {t}");
        post(&st, &format!("/v1/c/{h}/sql"), json!({ "sql": drop })).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_route_cancel_stops_the_running_query() {
    for (kind, url) in servers() {
        let st = state();
        let (h, _) = connect(&st, kind, &url).await;
        let run_id = format!("sleep-{kind}");
        let started = std::time::Instant::now();
        let canceller = {
            let (st, h, run_id) = (st.clone(), h.clone(), run_id.clone());
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                post(&st, &format!("/v1/c/{h}/cancel"), json!({ "run_id": run_id })).await.status()
            })
        };
        let res = post(&st, &format!("/v1/c/{h}/sql-stream"), json!({ "sql": "SELECT SLEEP(30)", "run_id": run_id })).await;
        let body = text(res).await;
        assert_eq!(canceller.await.unwrap(), StatusCode::OK, "{kind}");
        assert!(started.elapsed().as_secs() < 10, "{kind}: the sleep ran on");
        let (_, done) = streamed(&body);
        assert_eq!(done["result"]["cancelled"], true, "{kind}: {body}");

        // The next query on the handle runs at once.
        let res = post(&st, &format!("/v1/c/{h}/sql-stream"), json!({ "sql": "SELECT 2" })).await;
        let (rows, _) = streamed(&text(res).await);
        assert_eq!(rows, vec![json!(["2"])], "{kind}");
    }
}
