//! Streaming Postgres results against a real server. All `#[ignore]`d, same
//! instance as the Stop tests: `cargo test -p dh-core -- --ignored pg_stream`.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use crate::api::QueryChunk;
use crate::db::postgres::params::PgParams;
use crate::db::{runs, DbError, DbResult};
use super::PgAdapter;

fn params() -> PgParams {
    let url = std::env::var("DH_TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres@127.0.0.1:5544/dh_server_test".to_string());
    let rest = url.strip_prefix("postgres://").expect("a postgres:// url");
    let (auth, tail) = rest.split_once('@').expect("user@host in the url");
    let (user, password) = auth.split_once(':').unwrap_or((auth, ""));
    let (hostport, database) = tail.split_once('/').expect("/database in the url");
    let (host, port) = hostport.split_once(':').unwrap_or((hostport, "5432"));
    serde_json::from_value(serde_json::json!({
        "host": host, "port": port.parse::<u16>().unwrap(), "user": user,
        "password": password, "database": database, "ssl_mode": "disable",
        "pool_max": 4,
    }))
    .unwrap()
}

/// What the sink saw: each chunk with the time it arrived.
type Seen = Arc<Mutex<Vec<(Instant, QueryChunk)>>>;

fn recording() -> (Seen, impl FnMut(QueryChunk) -> DbResult<()> + Send) {
    let seen: Seen = Arc::default();
    let inner = seen.clone();
    (seen, move |chunk: QueryChunk| {
        inner.lock().unwrap().push((Instant::now(), chunk));
        Ok(())
    })
}

fn row_total(seen: &Seen) -> usize {
    seen.lock().unwrap().iter().map(|(_, c)| c.rows.len()).sum()
}

/// A slow source delivers its first chunk long before its last
/// Row is read, and no chunk waits for a full batch of 500.
#[tokio::test]
#[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
async fn pg_stream_first_chunk_arrives_before_the_last_row() {
    let a = PgAdapter::connect(&params()).await.unwrap();
    let (seen, mut sink) = recording();

    let started = Instant::now();
    let res = a
        .run_sql_stream(None, None, "SELECT i, pg_sleep(0.01) FROM generate_series(1, 300) i", None, &mut sink)
        .await
        .unwrap();
    let finished = Instant::now();

    assert!(res.rows.is_empty(), "streamed rows never land in the result");
    let chunks = seen.lock().unwrap();
    assert!(chunks.len() > 1, "a 3 second trickle is more than one chunk");
    let first = chunks[0].0;
    assert!(first - started < Duration::from_secs(1), "first rows show up early");
    assert!(finished - first > Duration::from_secs(1), "the first chunk came well before the end");
    assert_eq!(chunks[0].1.columns.as_ref().map(|c| c[0].as_str()), Some("i"));
    assert!(chunks[1..].iter().all(|(_, c)| c.columns.is_none()));
    drop(chunks);
    assert_eq!(row_total(&seen), 300);
}

/// A result with rows takes its column names from the first row, and a
/// Result with none still reports real names.
#[tokio::test]
#[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
async fn pg_stream_reports_real_column_names_with_and_without_rows() {
    let a = PgAdapter::connect(&params()).await.unwrap();

    let (seen, mut sink) = recording();
    let res = a.run_sql_stream(None, None, "SELECT 1 AS one, 'x' AS two", None, &mut sink).await.unwrap();
    assert_eq!(res.columns, vec!["one", "two"]);
    assert_eq!(seen.lock().unwrap()[0].1.columns, Some(vec!["one".to_string(), "two".to_string()]));

    let (seen, mut sink) = recording();
    let res = a
        .run_sql_stream(None, None, "SELECT 1 AS one, 'x' AS two WHERE false", None, &mut sink)
        .await
        .unwrap();
    assert_eq!(res.columns, vec!["one", "two"]);
    let chunks = seen.lock().unwrap();
    assert_eq!(chunks.len(), 1);
    assert!(chunks[0].1.rows.is_empty());
    assert_eq!(chunks[0].1.columns, Some(vec!["one".to_string(), "two".to_string()]));
}

/// A big result does not sit in the adapter. Rows go to a sink that
/// Drops them and the returned result holds none.
#[tokio::test]
#[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
async fn pg_stream_a_million_rows_into_a_dropping_sink() {
    let a = PgAdapter::connect(&params()).await.unwrap();
    let mut total = 0usize;
    let mut biggest = 0usize;
    let mut sink = |c: QueryChunk| {
        total += c.rows.len();
        biggest = biggest.max(c.rows.len());
        Ok(())
    };
    let res = a
        .run_sql_stream(None, None, "SELECT i, md5(i::text) FROM generate_series(1, 1000000) i", None, &mut sink)
        .await
        .unwrap();
    assert!(res.rows.is_empty());
    assert_eq!(total, 1_000_000);
    assert!(biggest <= 500, "no chunk is larger than one batch, got {biggest}");
}

/// Stop during a stream keeps the rows already sent, and the next query
/// Runs at once.
#[tokio::test]
#[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
async fn pg_stream_stop_keeps_the_rows_already_sent() {
    let a = PgAdapter::connect(&params()).await.unwrap();
    let run = runs::register("t-pg-stream", "run-stream-stop");
    let stopper = tokio::spawn(async {
        tokio::time::sleep(Duration::from_millis(700)).await;
        runs::cancel("t-pg-stream", "run-stream-stop").await
    });
    let (seen, mut sink) = recording();

    let res = a
        .run_sql_stream(
            None,
            None,
            "SELECT i, pg_sleep(0.01) FROM generate_series(1, 5000) i",
            Some(&run),
            &mut sink,
        )
        .await;
    run.finish().await;
    stopper.await.unwrap();

    assert!(matches!(res, Err(DbError::Cancelled)), "got {res:?}");
    let kept = row_total(&seen);
    assert!(kept > 0 && kept < 5000, "kept {kept}");
    let next = a.run_sql(None, None, "SELECT 1").await.unwrap();
    assert_eq!(next.rows, vec![vec![Some("1".to_string())]]);
}

/// An error after rows have arrived keeps those rows.
#[tokio::test]
#[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
async fn pg_stream_a_late_error_keeps_the_rows_before_it() {
    let a = PgAdapter::connect(&params()).await.unwrap();
    let (seen, mut sink) = recording();

    let res = a
        .run_sql_stream(None, None, "SELECT 1 / (i - 40) FROM generate_series(1, 100) i", None, &mut sink)
        .await;

    assert!(matches!(res, Err(DbError::SqlEngine(_))), "got {res:?}");
    assert_eq!(row_total(&seen), 39);
}

/// A write runs as before and sends no chunks.
#[tokio::test]
#[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
async fn pg_stream_a_write_sends_no_chunks() {
    let a = PgAdapter::connect(&params()).await.unwrap();
    let table = format!("dh_stream_{}", uuid::Uuid::new_v4().simple());
    let (seen, mut sink) = recording();

    a.run_sql_stream(None, None, &format!("CREATE TABLE public.{table} (a int)"), None, &mut sink).await.unwrap();
    let res = a
        .run_sql_stream(None, None, &format!("INSERT INTO public.{table} VALUES (1), (2)"), None, &mut sink)
        .await
        .unwrap();

    assert_eq!(res.rows_affected, 2);
    assert!(!res.is_select);
    assert!(seen.lock().unwrap().is_empty());
    a.run_sql(None, None, &format!("DROP TABLE public.{table}")).await.unwrap();
}
