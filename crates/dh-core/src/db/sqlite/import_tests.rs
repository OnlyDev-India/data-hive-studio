use serde_json::{json, Value};
use crate::api::{ImportData, ImportOnError, ImportRequest};
use super::SqliteAdapter;

async fn adapter_with_users() -> SqliteAdapter {
    let dir = std::env::temp_dir().join("dh-studio-tests");
    std::fs::create_dir_all(&dir).unwrap();
    let a = SqliteAdapter::connect(dir.join(format!("import-{}.db", uuid::Uuid::new_v4())))
        .await
        .unwrap();
    sqlx::query("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)")
        .execute(&a.pool)
        .await
        .unwrap();
    a
}

fn request(rows: Vec<Vec<Value>>, on_error: ImportOnError, dry_run: bool) -> ImportRequest {
    ImportRequest {
        table: "users".into(),
        create_sql: None,
        data: ImportData::Rows {
            columns: vec!["id".into(), "name".into(), "age".into()],
            rows,
        },
        on_error,
        dry_run,
        run_id: None,
        source_label: None,
    }
}

async fn count(a: &SqliteAdapter) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM users").fetch_one(&a.pool).await.unwrap()
}

#[tokio::test]
async fn clean_file_commits_every_row() {
    let a = adapter_with_users().await;
    let rows = (1..=5).map(|i| vec![json!(i), json!(format!("u{i}")), json!(20 + i)]).collect();
    let r = a.import_rows(&request(rows, ImportOnError::Rollback, false)).await.unwrap();
    assert!(r.committed);
    assert_eq!((r.inserted, r.failed_total), (5, 0));
    assert_eq!(count(&a).await, 5);
}

#[tokio::test]
async fn rollback_mode_writes_nothing_and_lists_every_bad_row() {
    let a = adapter_with_users().await;
    let mut rows: Vec<Vec<Value>> =
        (1..=100).map(|i| vec![json!(i), json!("ok"), json!(1)]).collect();
    rows[9][1] = Value::Null; // NOT NULL name
    rows[70][1] = Value::Null;
    let r = a.import_rows(&request(rows, ImportOnError::Rollback, false)).await.unwrap();
    assert!(!r.committed);
    assert_eq!(r.failed_total, 2);
    assert_eq!(r.failed.iter().map(|f| f.index).collect::<Vec<_>>(), vec![9, 70]);
    assert_eq!(r.failed[0].column.as_deref(), Some("name"));
    assert_eq!(count(&a).await, 0);
}

#[tokio::test]
async fn skip_mode_keeps_the_good_rows() {
    let a = adapter_with_users().await;
    let mut rows: Vec<Vec<Value>> =
        (1..=100).map(|i| vec![json!(i), json!("ok"), json!(1)]).collect();
    rows[9][1] = Value::Null;
    rows[70][1] = Value::Null;
    let r = a.import_rows(&request(rows, ImportOnError::Skip, false)).await.unwrap();
    assert!(r.committed);
    assert_eq!((r.inserted, r.failed_total), (98, 2));
    assert_eq!(count(&a).await, 98);
}

#[tokio::test]
async fn check_run_reports_but_writes_nothing() {
    let a = adapter_with_users().await;
    let mut rows: Vec<Vec<Value>> =
        (1..=100).map(|i| vec![json!(i), json!("ok"), json!(1)]).collect();
    rows[0][1] = Value::Null;
    rows[1][1] = Value::Null;
    let r = a.import_rows(&request(rows, ImportOnError::Skip, true)).await.unwrap();
    assert!(!r.committed && r.dry_run);
    assert_eq!((r.inserted, r.failed_total), (98, 2));
    assert_eq!(count(&a).await, 0);
}

#[tokio::test]
async fn repeated_primary_key_fails_only_that_row() {
    let a = adapter_with_users().await;
    sqlx::query("INSERT INTO users VALUES (2, 'existing', 1)").execute(&a.pool).await.unwrap();
    let rows = vec![
        vec![json!(1), json!("a"), json!(1)],
        vec![json!(2), json!("dup"), json!(1)],
        vec![json!(3), json!("c"), json!(1)],
    ];
    let r = a.import_rows(&request(rows, ImportOnError::Skip, false)).await.unwrap();
    assert_eq!((r.inserted, r.failed_total), (2, 1));
    assert_eq!(r.failed[0].index, 1);
    assert_eq!(count(&a).await, 3);
}

#[tokio::test]
async fn nested_json_binds_as_text_and_empty_file_is_fine() {
    let a = adapter_with_users().await;
    let rows = vec![vec![json!(1), json!({"a": [1, 2]}), json!(true)]];
    let r = a.import_rows(&request(rows, ImportOnError::Rollback, false)).await.unwrap();
    assert!(r.committed);
    let name: String = sqlx::query_scalar("SELECT name FROM users").fetch_one(&a.pool).await.unwrap();
    assert_eq!(name, "{\"a\":[1,2]}");
    let empty = a.import_rows(&request(vec![], ImportOnError::Rollback, false)).await.unwrap();
    assert!(empty.committed && empty.inserted == 0);
}

#[tokio::test]
async fn bad_requests_are_refused_before_writing() {
    let a = adapter_with_users().await;
    let ragged = request(vec![vec![json!(1)]], ImportOnError::Rollback, false);
    assert!(a.import_rows(&ragged).await.is_err());
    let mut dup = request(vec![], ImportOnError::Rollback, false);
    dup.data = ImportData::Rows { columns: vec!["id".into(), "id".into()], rows: vec![] };
    assert!(a.import_rows(&dup).await.is_err());
    let mut unknown = request(vec![vec![json!(1), json!("a"), json!(1)]], ImportOnError::Rollback, false);
    unknown.table = "nope".into();
    let r = a.import_rows(&unknown).await.unwrap();
    assert!(!r.committed && r.failed_total == 1);
}

const CREATE_PETS: &str = "CREATE TABLE pets (id INTEGER PRIMARY KEY, name TEXT NOT NULL)";

fn pets_request(rows: Vec<Vec<Value>>, on_error: ImportOnError, dry_run: bool) -> ImportRequest {
    ImportRequest {
        table: "pets".into(),
        create_sql: Some(CREATE_PETS.into()),
        data: ImportData::Rows { columns: vec!["id".into(), "name".into()], rows },
        on_error,
        dry_run,
        run_id: None,
        source_label: None,
    }
}

async fn pets_exist(a: &SqliteAdapter) -> bool {
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE name = 'pets'")
        .fetch_one(&a.pool)
        .await
        .unwrap();
    n == 1
}

#[tokio::test]
async fn new_table_is_created_and_filled_in_one_commit() {
    let a = adapter_with_users().await;
    let rows = vec![vec![json!(1), json!("rex")], vec![json!(2), json!("tom")]];
    let r = a.import_rows(&pets_request(rows, ImportOnError::Rollback, false)).await.unwrap();
    assert!(r.committed && r.inserted == 2);
    assert_eq!(r.statements[0], CREATE_PETS);
    assert!(pets_exist(&a).await);
}

#[tokio::test]
async fn failed_or_checked_import_leaves_no_new_table() {
    let a = adapter_with_users().await;
    let bad = vec![vec![json!(1), json!("rex")], vec![json!(2), Value::Null]];
    let r = a.import_rows(&pets_request(bad, ImportOnError::Rollback, false)).await.unwrap();
    assert!(!r.committed && r.failed_total == 1);
    assert!(!pets_exist(&a).await);

    let ok = vec![vec![json!(1), json!("rex")]];
    let r = a.import_rows(&pets_request(ok, ImportOnError::Rollback, true)).await.unwrap();
    assert!(!r.committed && r.inserted == 1);
    assert!(!pets_exist(&a).await);
}

#[tokio::test]
async fn create_sql_that_is_not_one_create_table_is_refused() {
    let a = adapter_with_users().await;
    let mut req = pets_request(vec![], ImportOnError::Rollback, false);
    req.create_sql = Some("CREATE TABLE pets (id INT); DROP TABLE users".into());
    assert!(a.import_rows(&req).await.is_err());
    assert_eq!(count(&a).await, 0); // users still there
}

#[tokio::test]
async fn creating_a_table_that_exists_is_an_error_not_a_bad_row() {
    let a = adapter_with_users().await;
    let mut req = pets_request(vec![], ImportOnError::Rollback, false);
    req.create_sql = Some("CREATE TABLE users (id INT)".into());
    req.table = "users".into();
    assert!(a.import_rows(&req).await.is_err());
}

#[tokio::test]
async fn cancel_rolls_the_whole_import_back_and_progress_is_reported() {
    use crate::api::ImportProgress;
    use crate::db::import::{ImportCtl, IMPORT_CTL};
    use std::sync::{Arc, Mutex};

    let a = adapter_with_users().await;
    let rows = (1..=2500).map(|i| vec![json!(i), json!("ok"), json!(1)]).collect();
    // Stop was asked before the import started, so it starts cancelled.
    crate::db::cancel_run("import-test", "import-cancel-1").await;
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    let ctl = Arc::new(ImportCtl {
        run: Some(crate::db::runs::register("import-test", "import-cancel-1")),
        progress: Some(Box::new(move |p: ImportProgress| sink.lock().unwrap().push(p.done))),
    });
    let r = IMPORT_CTL
        .scope(ctl.clone(), a.import_rows(&request(rows, ImportOnError::Skip, false)))
        .await
        .unwrap();
    ctl.run.as_ref().unwrap().finish().await;
    assert!(r.cancelled && !r.committed);
    assert_eq!(count(&a).await, 0);
    assert_eq!(*seen.lock().unwrap(), vec![0]);
}

#[tokio::test]
async fn progress_counts_rows_before_each_batch() {
    use crate::api::ImportProgress;
    use crate::db::import::{ImportCtl, IMPORT_CTL};
    use std::sync::{Arc, Mutex};

    let a = adapter_with_users().await;
    let rows = (1..=2500).map(|i| vec![json!(i), json!("ok"), json!(1)]).collect();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    let ctl = Arc::new(ImportCtl {
        run: None,
        progress: Some(Box::new(move |p: ImportProgress| sink.lock().unwrap().push((p.done, p.total)))),
    });
    let r = IMPORT_CTL
        .scope(ctl, a.import_rows(&request(rows, ImportOnError::Rollback, false)))
        .await
        .unwrap();
    assert!(r.committed && !r.cancelled);
    assert_eq!(*seen.lock().unwrap(), vec![(0, 2500), (1000, 2500), (2000, 2500)]);
}
