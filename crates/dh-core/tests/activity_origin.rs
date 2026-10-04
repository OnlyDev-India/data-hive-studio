//! With saving app queries off (the default, never turned on in this test
//! binary), the user's own writes and DDL are recorded and the app's reads
//! and connects are not.

mod common;

use common::temp_sqlite_conn;
use dh_core::api::QueryOp;

fn kinds(conn_id: &str) -> Vec<String> {
    dh_core::activity::snapshot(500)
        .into_iter()
        .filter(|e| e.conn_id == conn_id)
        .map(|e| e.kind)
        .collect()
}

#[tokio::test]
async fn user_actions_are_recorded_and_app_reads_are_not() {
    let conn_id = temp_sqlite_conn().await;
    dh_core::db::run_sql(&conn_id, None, None, "CREATE TABLE w (id INTEGER PRIMARY KEY, name TEXT)", "user")
        .await
        .unwrap();
    let row = std::collections::BTreeMap::from([
        ("id".to_string(), Some("1".to_string())),
        ("name".to_string(), Some("gear".to_string())),
    ]);
    let insert = QueryOp::Insert { table: "w".into(), values: row.clone(), skip_empty: false };
    dh_core::db::execute_op(&conn_id, None, None, &insert).await.unwrap();
    let select = QueryOp::Select {
        table: "w".into(),
        filters: vec![],
        custom_where: None,
        order_by: vec![],
        limit: Some(10),
        offset: None,
    };
    dh_core::db::execute_op(&conn_id, None, None, &select).await.unwrap();
    dh_core::db::table_schema(&conn_id, None, None, "w").await.unwrap();
    dh_core::db::duplicate_table(&conn_id, None, None, "w", "w_copy", true).await.unwrap();
    let delete = QueryOp::Delete { table: "w".into(), match_row: row };
    dh_core::db::execute_op(&conn_id, None, None, &delete).await.unwrap();

    let logged = kinds(&conn_id);
    for kind in ["sql", "insert", "duplicate", "delete"] {
        assert!(logged.iter().any(|k| k == kind), "{kind} missing from {logged:?}");
    }
    for kind in ["connect", "select", "schema"] {
        assert!(!logged.iter().any(|k| k == kind), "{kind} should not be stored: {logged:?}");
    }
}
