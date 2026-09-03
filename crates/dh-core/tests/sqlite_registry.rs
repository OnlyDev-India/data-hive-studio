//! Integration test exercising the public `db::` registry API end to end
//! against a real (temp-file) SQLite connection — the same path
//! `src-tauri/commands.rs` forwards into.

mod common;

use common::temp_sqlite_conn;

#[tokio::test]
async fn fresh_database_has_no_tables() {
    let conn_id = temp_sqlite_conn().await;
    let tables = dh_core::db::list_tables(&conn_id).await.unwrap();
    assert!(tables.is_empty());
}

#[tokio::test]
async fn created_table_is_visible_via_list_tables() {
    let conn_id = temp_sqlite_conn().await;
    dh_core::db::run_sql(&conn_id, "CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT)")
        .await
        .unwrap();

    let tables = dh_core::db::list_tables(&conn_id).await.unwrap();
    assert!(tables.iter().any(|t| t.name == "widgets"));
}
