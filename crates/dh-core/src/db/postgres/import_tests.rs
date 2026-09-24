//! `import_rows` against a real server (spec 0008). All `#[ignore]`d: run with
//! `cargo test -p dh-core -- --ignored pg_import` against the throwaway
//! instance the server tests use (`DH_TEST_DATABASE_URL`, default
//! `postgres://postgres@127.0.0.1:5544/dh_server_test`).
use serde_json::{json, Value};
use crate::api::{ImportData, ImportOnError, ImportRequest};
use super::params::PgParams;
use super::PgAdapter;

const LIVE: &str = "requires a live Postgres test database, see server::store::test_pg_url";

fn params() -> PgParams {
    let url = std::env::var("DH_TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://postgres@127.0.0.1:5544/dh_server_test".to_string());
    let rest = url.strip_prefix("postgres://").expect("a postgres:// url");
    let (auth, tail) = rest.split_once('@').expect("user@host in the url");
    let (user, password) = auth.split_once(':').unwrap_or((auth, ""));
    let (hostport, database) = tail.split_once('/').expect("/database in the url");
    let (host, port) = hostport.split_once(':').unwrap_or((hostport, "5432"));
    serde_json::from_value(json!({
        "host": host, "port": port.parse::<u16>().unwrap(), "user": user,
        "password": password, "database": database, "ssl_mode": "disable",
        "pool_max": 2,
    }))
    .unwrap()
}

fn request(table: &str, create_sql: Option<String>, rows: Vec<Vec<Value>>, on_error: ImportOnError, dry_run: bool) -> ImportRequest {
    ImportRequest {
        table: table.into(),
        create_sql,
        data: ImportData::Rows { columns: vec!["id".into(), "amount".into(), "meta".into()], rows },
        on_error,
        dry_run,
        run_id: None,
        source_label: None,
    }
}

async fn exists(a: &PgAdapter, table: &str) -> bool {
    sqlx::query_scalar::<_, bool>("SELECT to_regclass($1) IS NOT NULL")
        .bind(format!("public.{table}"))
        .fetch_one(&a.pool)
        .await
        .unwrap()
}

async fn count(a: &PgAdapter, table: &str) -> i64 {
    sqlx::query_scalar(&format!("SELECT count(*) FROM public.{table}")).fetch_one(&a.pool).await.unwrap()
}

fn tag() -> String {
    format!("imp_{}", uuid::Uuid::new_v4().simple())
}

/// AC-5, AC-8, AC-14, AC-15: casts, a bad numeric and a repeated key are bad
/// rows, and Roll back writes nothing while Skip keeps the good rows.
#[tokio::test]
#[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
async fn pg_import_rollback_and_skip() {
    let _ = LIVE;
    let a = PgAdapter::connect(&params()).await.unwrap();
    let t = tag();
    sqlx::query(&format!("CREATE TABLE public.{t} (id int PRIMARY KEY, amount numeric(6,2) NOT NULL, meta jsonb)"))
        .execute(&a.pool)
        .await
        .unwrap();
    let rows = vec![
        vec![json!("1"), json!("10.50"), json!({"a": [1]})],
        vec![json!("2"), json!("abc"), Value::Null],
        vec![json!("1"), json!("3"), Value::Null],
        vec![json!("4"), json!("99999"), Value::Null],
        vec![json!("5"), json!("7"), Value::Null],
    ];

    let r = a.import_rows(None, Some("public"), &request(&t, None, rows.clone(), ImportOnError::Rollback, false)).await.unwrap();
    assert!(!r.committed);
    assert_eq!(r.failed_total, 3);
    assert_eq!(r.failed.iter().map(|f| f.index).collect::<Vec<_>>(), vec![1, 2, 3]);
    assert_eq!(count(&a, &t).await, 0);

    let r = a.import_rows(None, Some("public"), &request(&t, None, rows, ImportOnError::Skip, false)).await.unwrap();
    assert!(r.committed);
    assert_eq!((r.inserted, r.failed_total), (2, 3));
    assert_eq!(count(&a, &t).await, 2);

    sqlx::query(&format!("DROP TABLE public.{t}")).execute(&a.pool).await.unwrap();
}

/// AC-9, AC-10, AC-12: a new table made inside the import is committed with
/// the rows, and a failed or checked import leaves no table behind.
#[tokio::test]
#[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
async fn pg_import_new_table_is_atomic() {
    let _ = LIVE;
    let a = PgAdapter::connect(&params()).await.unwrap();
    let t = tag();
    let create = format!("CREATE TABLE \"{t}\" (\"id\" integer, \"amount\" numeric(6,2), \"meta\" jsonb)");
    let good = vec![vec![json!("1"), json!("2.5"), json!({"k": 1})]];
    let bad = vec![good[0].clone(), vec![json!("x"), json!("1"), Value::Null]];

    let r = a.import_rows(None, Some("public"), &request(&t, Some(create.clone()), bad, ImportOnError::Rollback, false)).await.unwrap();
    assert!(!r.committed && r.failed_total == 1);
    assert!(!exists(&a, &t).await);

    let r = a.import_rows(None, Some("public"), &request(&t, Some(create.clone()), good.clone(), ImportOnError::Rollback, true)).await.unwrap();
    assert!(r.dry_run && !r.committed && r.inserted == 1);
    assert!(!exists(&a, &t).await);

    let r = a.import_rows(None, Some("public"), &request(&t, Some(create), good, ImportOnError::Rollback, false)).await.unwrap();
    assert!(r.committed);
    assert_eq!(count(&a, &t).await, 1);

    sqlx::query(&format!("DROP TABLE public.{t}")).execute(&a.pool).await.unwrap();
}
