//! Spec 0007 end to end, through the public `db::` registry API the Tauri
//! commands forward into, against a real SQLite file opened read only: a
//! refusal is the typed error, it shows in the Activity log as a failed entry,
//! nothing changes, and everything that only reads still works.

use dh_core::api::{ConnGuard, QueryOp, SchemaOp};
use dh_core::db::{DbError, READ_ONLY_PREFIX};

/// A file with one table and one row, closed, then opened read only through
/// the registry. Returns the read only connection id.
async fn read_only_conn() -> String {
    let dir = std::env::temp_dir().join("dh-studio-tests");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(format!("ro-registry-{}.db", uuid::Uuid::new_v4()));
    let path = path.to_str().unwrap().to_string();

    let writable = dh_core::db::open_database_path(&path, ConnGuard::default()).await.unwrap();
    for sql in [
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT)",
        "INSERT INTO widgets VALUES (1, 'gear')",
    ] {
        dh_core::db::run_sql(&writable.id, None, None, sql, "app").await.unwrap();
    }
    dh_core::db::close_connection(&writable.id).await.unwrap();

    let guard = ConnGuard { read_only: true, env_label: Some("Production".into()), ..Default::default() };
    let info = dh_core::db::open_database_path(&path, guard).await.unwrap();
    // The flag and label travel on the live connection (AC-8's source).
    assert!(info.guard.read_only);
    assert_eq!(info.guard.env_label.as_deref(), Some("Production"));
    info.id
}

fn refusal_text<T>(res: Result<T, DbError>) -> String {
    match res {
        Err(DbError::ReadOnly(msg)) => msg,
        Err(other) => panic!("expected a read only refusal, got {other:?}"),
        Ok(_) => panic!("expected a read only refusal, the write went through"),
    }
}

fn failed_entry(conn_id: &str, pick: impl Fn(&dh_core::activity::ActivityEntry) -> bool) -> dh_core::activity::ActivityEntry {
    dh_core::activity::snapshot(500)
        .into_iter()
        .find(|e| e.conn_id == conn_id && !e.ok && pick(e))
        .expect("the refusal is in the Activity log as a failed entry")
}

/// AC-2, AC-7: the write from the editor is refused with the typed error and
/// logged as a failed entry that carries the statement.
#[tokio::test]
async fn an_editor_write_is_refused_and_logged() {
    let conn = read_only_conn().await;
    let sql = "UPDATE widgets SET name = 'cog'";
    let msg = refusal_text(dh_core::db::run_sql(&conn, None, None, sql, "user").await);
    assert!(msg.starts_with(READ_ONLY_PREFIX), "{msg}");

    let entry = failed_entry(&conn, |e| e.sql.as_deref() == Some(sql));
    assert!(entry.error.as_deref().is_some_and(|m| m.starts_with(READ_ONLY_PREFIX)));

    // The streaming path the editor's Run uses.
    let streamed = dh_core::db::run_sql_stream(&conn, None, None, "DELETE FROM widgets", None, |_| Ok(())).await;
    refusal_text(streamed);
    failed_entry(&conn, |e| e.sql.as_deref() == Some("DELETE FROM widgets"));

    let rows = dh_core::db::run_sql(&conn, None, None, "SELECT name FROM widgets", "app").await.unwrap();
    assert_eq!(rows.rows, vec![vec![Some("gear".to_string())]]);
}

/// AC-5, AC-7: grid ops, schema designer Apply and Duplicate are refused and
/// each is a failed entry in the Activity log.
#[tokio::test]
async fn structured_writes_are_refused_and_logged() {
    let conn = read_only_conn().await;

    let delete = QueryOp::Delete {
        table: "widgets".into(),
        match_row: [("id".to_string(), Some("1".to_string()))].into(),
    };
    refusal_text(dh_core::db::execute_op(&conn, None, None, &delete).await);
    failed_entry(&conn, |e| e.kind == "delete" && e.target.contains("widgets"));

    refusal_text(
        dh_core::db::execute_op_stream(&conn, None, None, &QueryOp::DropTable { table: "widgets".into() }, |_| Ok(()))
            .await,
    );
    failed_entry(&conn, |e| e.kind == "drop_table");

    let ops = [SchemaOp::DropColumn { table: "widgets".into(), name: "name".into() }];
    refusal_text(dh_core::db::apply_schema_ops(&conn, None, None, &ops).await);
    failed_entry(&conn, |e| e.kind == "ddl");

    refusal_text(dh_core::db::duplicate_table(&conn, None, None, "widgets", "widgets2", true).await);
    failed_entry(&conn, |e| e.kind == "duplicate");

    refusal_text(dh_core::db::execute_params(&conn, None, "DELETE FROM widgets WHERE id = ?", &["1".to_string()].map(Some)).await);

    let left = dh_core::db::list_tables(&conn).await.unwrap();
    assert_eq!(left.len(), 1, "no table was dropped or copied");
}

/// AC-14: everything that only reads keeps working.
#[tokio::test]
async fn reads_still_work() {
    let conn = read_only_conn().await;

    let select = QueryOp::Select {
        table: "widgets".into(),
        filters: vec![],
        custom_where: None,
        order_by: vec![],
        limit: Some(10),
        offset: None,
    };
    let page = dh_core::db::execute_op(&conn, None, None, &select).await.unwrap();
    assert_eq!(page.rows.len(), 1);
    let count = QueryOp::Count { table: "widgets".into(), filters: vec![], custom_where: None };
    dh_core::db::execute_op(&conn, None, None, &count).await.unwrap();

    dh_core::db::run_sql(&conn, None, None, "EXPLAIN QUERY PLAN SELECT * FROM widgets", "user").await.unwrap();
    dh_core::db::run_sql_stream(&conn, None, None, "SELECT * FROM widgets", None, |_| Ok(())).await.unwrap();
    dh_core::db::run_sql_params(&conn, None, "SELECT * FROM widgets WHERE id = ?", &[Some("1".into())])
        .await
        .unwrap();
    assert_eq!(dh_core::db::list_tables(&conn).await.unwrap().len(), 1);
    dh_core::db::table_schema(&conn, None, None, "widgets").await.unwrap();
    dh_core::db::set_active_schema(&conn, "main").await.unwrap();
    assert!(!dh_core::db::save_database(&conn).await.unwrap().is_empty());
    dh_core::db::close_connection(&conn).await.unwrap();
}

/// AC-1: a connection opened without a guard behaves exactly as before.
#[tokio::test]
async fn a_connection_without_a_guard_still_writes() {
    let conn = common_writable().await;
    dh_core::db::run_sql(&conn, None, None, "CREATE TABLE t (a INTEGER)", "app").await.unwrap();
    dh_core::db::run_sql(&conn, None, None, "INSERT INTO t VALUES (1)", "app").await.unwrap();
}

async fn common_writable() -> String {
    let name = format!("dh-core-ro-test-{}", uuid::Uuid::new_v4());
    dh_core::db::open_database(&dh_core::api::DbKind::Sqlite, &name, None, ConnGuard::default())
        .await
        .unwrap()
        .id
}
