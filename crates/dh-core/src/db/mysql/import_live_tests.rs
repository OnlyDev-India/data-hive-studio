//! Import against real servers (build plan slice 8), `#[ignore]`d like
//! `live_tests.rs` and run the same way:
//!
//! ```text
//! DH_TEST_MYSQL_URL=mysql://root:pw@127.0.0.1:3316/dh_test \
//! DH_TEST_MARIADB_URL=mysql://root:pw@127.0.0.1:3317/dh_test \
//!   cargo test -p dh-core -- --ignored mysql_live
//! ```

use serde_json::{json, Value};
use crate::api::{ImportData, ImportOnError, ImportRequest};
use super::live_tests::{connect, urls};
use super::MySqlAdapter;

fn table() -> String {
    format!("dh_imp_{}", &uuid::Uuid::new_v4().simple().to_string()[..12])
}

fn request(table: &str, columns: &[&str], rows: Vec<Vec<Value>>) -> ImportRequest {
    ImportRequest {
        table: table.into(),
        create_sql: None,
        data: ImportData::Rows { columns: columns.iter().map(|c| c.to_string()).collect(), rows },
        on_error: ImportOnError::Rollback,
        dry_run: false,
        run_id: None,
        source_label: None,
    }
}

async fn one(a: &MySqlAdapter, sql: &str) -> Vec<Vec<Option<String>>> {
    a.run_sql(None, sql).await.unwrap().rows
}

async fn exists(a: &MySqlAdapter, table: &str) -> bool {
    let sql = format!(
        "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '{table}'"
    );
    one(a, &sql).await == vec![vec![Some("1".into())]]
}

/// AC-21: exporting a table and importing the file back stores the same
/// bytes and the same bits, so `CHECKSUM TABLE` matches.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_import_round_trips_bytes_and_bits() {
    for (key, url) in urls() {
        let a = connect(&url, json!({})).await;
        let (src, dst) = (table(), table());
        let ddl = |t: &str| format!(
            "CREATE TABLE {t} (id INT PRIMARY KEY, raw VARBINARY(10), b BIT(4), d DATE, note VARCHAR(20))"
        );
        a.run_sql(None, &ddl(&src)).await.unwrap();
        a.run_sql(None, &ddl(&dst)).await.unwrap();
        a.run_sql(
            None,
            &format!("INSERT INTO {src} VALUES (1, 0xDEAD00, b'0101', '0000-00-00', 'a'), (2, 'hi', b'1', NULL, NULL)"),
        )
        .await
        .ok();
        // A strict sql_mode refuses the zero date: insert row 1 without it.
        if one(&a, &format!("SELECT COUNT(*) FROM {src}")).await != vec![vec![Some("2".into())]] {
            a.run_sql(
                None,
                &format!("INSERT INTO {src} VALUES (1, 0xDEAD00, b'0101', '2024-01-02', 'a'), (2, 'hi', b'1', NULL, NULL)"),
            )
            .await
            .unwrap();
        }

        // What the grid and export show, sent back as an import.
        let shown = one(&a, &format!("SELECT id, HEX(raw), b, d, note FROM {src} ORDER BY id")).await;
        assert_eq!(shown[0][2].as_deref(), Some("b'0101'"), "{key}");
        let page = a
            .execute_op(None, &crate::api::QueryOp::Select {
                table: src.clone(),
                filters: vec![],
                custom_where: None,
                order_by: vec![crate::api::OrderByCond { column: "id".into(), dir: "asc".into() }],
                limit: None,
                offset: None,
            })
            .await
            .unwrap()
            .result
            .rows;
        let rows: Vec<Vec<Value>> = page
            .iter()
            .map(|r| r.iter().map(|c| c.clone().map(Value::String).unwrap_or(Value::Null)).collect())
            .collect();
        assert_eq!(rows[0][1], json!("0xDEAD00"), "{key}");
        let report = a
            .import_rows(None, &request(&dst, &["id", "raw", "b", "d", "note"], rows))
            .await
            .unwrap();
        assert!(report.committed && report.failed.is_empty(), "{key} {report:?}");
        assert_eq!(report.inserted, 2);
        let s = one(&a, &format!("CHECKSUM TABLE {src}")).await[0][1].clone();
        let d = one(&a, &format!("CHECKSUM TABLE {dst}")).await[0][1].clone();
        assert_eq!(s, d, "{key}");
        let back = one(&a, &format!("SELECT HEX(raw), b + 0 FROM {dst} ORDER BY id")).await;
        assert_eq!(back[0], vec![Some("DEAD00".into()), Some("5".into())], "{key}");
        assert_eq!(back[1], vec![Some("6869".into()), Some("1".into())], "{key}");
        a.run_sql(None, &format!("DROP TABLE {src}, {dst}")).await.unwrap();
    }
}

/// AC-21 with spec 0008: a bad row rolls the whole import back by default,
/// Skip commits the good rows, and each failure names its row and column.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_import_reports_bad_rows() {
    for (key, url) in urls() {
        let a = connect(&url, json!({})).await;
        let t = table();
        a.run_sql(None, &format!("CREATE TABLE {t} (id INT PRIMARY KEY, name VARCHAR(5) NOT NULL)")).await.unwrap();
        let rows = vec![
            vec![json!(1), json!("a")],
            vec![json!(2), json!(null)],
            vec![json!(3), json!("c")],
            vec![json!(1), json!("dup")],
        ];
        let report = a.import_rows(None, &request(&t, &["id", "name"], rows.clone())).await.unwrap();
        assert!(!report.committed, "{key}");
        assert_eq!(report.failed_total, 2, "{key} {report:?}");
        assert_eq!(report.failed[0].index, 1);
        assert_eq!(report.failed[0].column.as_deref(), Some("name"), "{key} {report:?}");
        assert_eq!(report.failed[1].index, 3);
        assert_eq!(one(&a, &format!("SELECT COUNT(*) FROM {t}")).await, vec![vec![Some("0".into())]], "{key}");

        let mut skip = request(&t, &["id", "name"], rows);
        skip.on_error = ImportOnError::Skip;
        let report = a.import_rows(None, &skip).await.unwrap();
        assert!(report.committed && report.inserted == 2, "{key} {report:?}");
        assert_eq!(one(&a, &format!("SELECT COUNT(*) FROM {t}")).await, vec![vec![Some("2".into())]], "{key}");
        a.run_sql(None, &format!("DROP TABLE {t}")).await.unwrap();
    }
}

/// A new table: Check (`dry_run`) leaves nothing behind, though MySQL
/// commits a `CREATE TABLE` on its own; a real import keeps the table.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_import_into_a_new_table_rolls_back_cleanly() {
    for (key, url) in urls() {
        let a = connect(&url, json!({})).await;
        let t = table();
        let mut req = request(&t, &["id", "v"], vec![vec![json!(1), json!("x")], vec![json!(2), json!("y")]]);
        req.create_sql = Some(format!("CREATE TABLE `{t}` (`id` INT PRIMARY KEY, `v` TEXT);"));
        req.dry_run = true;
        let report = a.import_rows(None, &req).await.unwrap();
        assert!(!report.committed && report.inserted == 2, "{key} {report:?}");
        assert!(!exists(&a, &t).await, "{key}: the checked table must be gone");

        req.dry_run = false;
        let report = a.import_rows(None, &req).await.unwrap();
        assert!(report.committed, "{key} {report:?}");
        assert!(exists(&a, &t).await, "{key}");
        assert!(report.statements[0].starts_with("CREATE TABLE"), "{report:?}");
        a.run_sql(None, &format!("DROP TABLE {t}")).await.unwrap();
    }
}

/// AC-21: chunks stay under `max_allowed_packet`, so rows far bigger in
/// total than the packet still load, with no `local_infile`.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_import_chunks_under_the_packet_limit() {
    for (key, url) in urls() {
        let a = connect(&url, json!({})).await;
        let t = table();
        a.run_sql(None, &format!("CREATE TABLE {t} (id INT PRIMARY KEY, body LONGTEXT)")).await.unwrap();
        let packet: usize = one(&a, "SELECT @@max_allowed_packet").await[0][0].as_deref().unwrap().parse().unwrap();
        // Three packets' worth of rows, each a quarter packet.
        let body = "x".repeat(packet / 4);
        let rows: Vec<Vec<Value>> = (0..12).map(|i| vec![json!(i), json!(body.clone())]).collect();
        let report = a.import_rows(None, &request(&t, &["id", "body"], rows)).await.unwrap();
        assert!(report.committed && report.failed.is_empty(), "{key} {report:?}");
        assert_eq!(
            one(&a, &format!("SELECT COUNT(*), SUM(LENGTH(body)) FROM {t}")).await,
            vec![vec![Some("12".into()), Some((12 * body.len()).to_string())]],
            "{key}"
        );
        a.run_sql(None, &format!("DROP TABLE {t}")).await.unwrap();
    }
}

/// AC-17: a read only connection refuses an import before it writes.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_import_is_refused_when_read_only() {
    for (key, url) in urls() {
        let a = connect(&url, json!({ "read_only": true })).await;
        let err = a.import_rows(None, &request("t", &["id"], vec![vec![json!(1)]])).await.unwrap_err();
        assert!(err.to_string().starts_with(crate::db::READ_ONLY_PREFIX), "{key} {err}");
    }
}
