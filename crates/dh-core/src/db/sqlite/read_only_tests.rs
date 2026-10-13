//! The query builder's read only run and preview on a real SQLite file.

use super::*;
use crate::api::{QueryChunk, SqlBuilderPreviewRequest, SqlPreviewChunk, SqlPreviewTarget};
use crate::db::sql_builder::TIME_LIMIT_ERROR;
use crate::db::{sql_builder_preview_on, DbAdapter};

async fn seeded() -> SqliteAdapter {
    let dir = std::env::temp_dir().join("dh-studio-tests");
    std::fs::create_dir_all(&dir).unwrap();
    let a = SqliteAdapter::connect(dir.join(format!("ro-{}.db", uuid::Uuid::new_v4()))).await.unwrap();
    sqlx::query("CREATE TABLE orders (id INTEGER PRIMARY KEY, region TEXT, total INTEGER)")
        .execute(&a.pool)
        .await
        .unwrap();
    for i in 1..=50 {
        let region = if i % 2 == 0 { "east" } else { "west" };
        sqlx::query("INSERT INTO orders VALUES (?, ?, ?)")
            .bind(i)
            .bind(region)
            .bind(i * 10)
            .execute(&a.pool)
            .await
            .unwrap();
    }
    a
}

async fn count(a: &SqliteAdapter) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM orders").fetch_one(&a.pool).await.unwrap()
}

#[tokio::test]
async fn a_read_only_run_refuses_a_write_and_leaves_writes_working_after() {
    let a = seeded().await;
    let write = "WITH x AS (SELECT 99, 'z', 1) INSERT INTO orders SELECT * FROM x";
    let res = DbAdapter::run_read_only(&a, None, None, write, None, None, &mut |_| Ok(())).await;
    assert!(res.is_err(), "the write must fail under query_only");
    assert_eq!(count(&a).await, 50);

    // Every pooled connection is back to writable.
    for i in 0..12 {
        sqlx::query("INSERT INTO orders VALUES (?, 'n', 0)")
            .bind(1000 + i)
            .execute(&a.pool)
            .await
            .unwrap();
    }
    assert_eq!(count(&a).await, 62);
}

#[tokio::test]
async fn a_read_only_run_streams_its_rows() {
    let a = seeded().await;
    let mut rows = 0;
    let mut sink = |c: QueryChunk| {
        rows += c.rows.len();
        Ok(())
    };
    let res = DbAdapter::run_read_only(&a, None, None, "SELECT * FROM orders", None, None, &mut sink)
        .await
        .unwrap();
    assert_eq!(res.columns, vec!["id", "region", "total"]);
    assert_eq!(rows, 50);
}

#[tokio::test]
async fn a_slow_read_passes_its_time_limit() {
    let a = seeded().await;
    let slow = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n) SELECT count(*) FROM n";
    let res = DbAdapter::run_read_only(&a, None, None, slow, Some(50), None, &mut |_| Ok(())).await;
    match res {
        Err(DbError::InvalidOperation(m)) => assert_eq!(m, TIME_LIMIT_ERROR),
        other => panic!("expected the time limit, got {other:?}"),
    }
}

#[tokio::test]
async fn a_refresh_counts_each_card_and_stops_after_a_failing_one() {
    let a = seeded().await;
    let from = "(SELECT * FROM orders LIMIT 40) AS orders";
    let target = |id: &str, sql: String| SqlPreviewTarget { clause_id: id.into(), sql };
    let req = SqlBuilderPreviewRequest {
        database: None,
        schema: None,
        targets: vec![
            target("from", format!("SELECT *, COUNT(*) OVER () AS __dh_count FROM {from} LIMIT 20")),
            target(
                "where",
                format!("SELECT *, COUNT(*) OVER () AS __dh_count FROM {from} WHERE region = 'east' LIMIT 20"),
            ),
            target(
                "group",
                format!(
                    "SELECT region, COUNT(*) AS n, COUNT(*) OVER () AS __dh_count FROM {from} GROUP BY region LIMIT 20"
                ),
            ),
            target("bad", format!("SELECT nope, COUNT(*) OVER () AS __dh_count FROM {from} LIMIT 20")),
        ],
        probe_sql: Some("SELECT COUNT(*) AS n FROM (SELECT 1 FROM orders LIMIT 41) AS p".into()),
        table: "orders".into(),
        cap: 40,
        time_ms: 5_000,
        concurrency: 1,
        run_id: None,
    };
    let mut chunks: Vec<SqlPreviewChunk> = vec![];
    let summary = sql_builder_preview_on(&a, "c", &req, &mut |c| {
        chunks.push(c);
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(summary.source_rows, Some(41));
    let by = |id: &str| chunks.iter().find(|c| c.clause_id == id).unwrap();
    assert_eq!(by("from").count, 40);
    assert_eq!(by("from").rows.len(), 20);
    assert_eq!(by("from").columns, vec!["id", "region", "total"]);
    assert_eq!(by("where").count, 20);
    assert_eq!(by("group").count, 2);
    assert!(by("bad").error.as_deref().unwrap().contains("nope"));
    assert!(!by("bad").timed_out);
}

#[tokio::test]
async fn a_card_holding_two_statements_is_refused() {
    let a = seeded().await;
    let req = SqlBuilderPreviewRequest {
        database: None,
        schema: None,
        targets: vec![SqlPreviewTarget { clause_id: "x".into(), sql: "SELECT 1; DELETE FROM orders".into() }],
        probe_sql: None,
        table: "orders".into(),
        cap: 10,
        time_ms: 5_000,
        concurrency: 2,
        run_id: None,
    };
    let mut chunks: Vec<SqlPreviewChunk> = vec![];
    sql_builder_preview_on(&a, "c", &req, &mut |c| {
        chunks.push(c);
        Ok(())
    })
    .await
    .unwrap();
    assert!(chunks[0].error.is_some());
    assert_eq!(count(&a).await, 50);
}
