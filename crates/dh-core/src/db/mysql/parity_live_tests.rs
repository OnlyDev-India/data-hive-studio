//! The relation diagram, compare and explain against real servers (build
//! plan slices 9 to 11), `#[ignore]`d like `live_tests.rs` and run the same
//! way:
//!
//! ```text
//! DH_TEST_MYSQL_URL=mysql://root:pw@127.0.0.1:3316/dh_test \
//! DH_TEST_MARIADB_URL=mysql://root:pw@127.0.0.1:3317/dh_test \
//!   cargo test -p dh-core -- --ignored mysql_live
//! ```

use serde_json::json;
use crate::api::{CompareChunk, CompareDataRequest, CompareFileKind, DiffKind, DiffRow, PlanDialect, PlanNode, TableRef};
use crate::db::{compare_data_on, compare_to_writer_on, DbAdapter, DIFF_PAGE_SIZE};
use super::live_tests::{connect, urls};
use super::{Flavor, MySqlAdapter};

fn suffix() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..10].to_string()
}

async fn run(a: &MySqlAdapter, sqls: &[String]) {
    for sql in sqls {
        a.run_sql(None, sql).await.unwrap_or_else(|e| panic!("{sql}: {e}"));
    }
}

/// AC-22: a database's tables, columns and foreign keys, a multi column key
/// as one link, and a key into another database as a stub.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_relation_diagram_reads_tables_and_foreign_keys() {
    for (key, url) in urls() {
        let a = connect(&url, json!({})).await;
        let s = suffix();
        let (db, other) = (format!("dh_g_{s}"), format!("dh_go_{s}"));
        run(&a, &[
            format!("CREATE DATABASE {db}"),
            format!("CREATE DATABASE {other}"),
            format!("CREATE TABLE {other}.accounts (id INT PRIMARY KEY)"),
            format!("CREATE TABLE {db}.orders (id INT, region CHAR(2), account_id INT, PRIMARY KEY (id, region), \
                     CONSTRAINT fk_acc FOREIGN KEY (account_id) REFERENCES {other}.accounts (id) ON DELETE CASCADE)"),
            format!("CREATE TABLE {db}.lines (n INT PRIMARY KEY, order_id INT, region CHAR(2), \
                     CONSTRAINT fk_line FOREIGN KEY (order_id, region) REFERENCES {db}.orders (id, region))"),
            format!("CREATE VIEW {db}.v AS SELECT 1 AS x"),
        ])
        .await;

        let (g, statements) = a.schema_graph(Some(&db)).await.unwrap();
        assert_eq!(statements.len(), 4);
        let names: Vec<_> = g.tables.iter().filter(|t| !t.stub).map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["lines", "orders"], "{key}: views are left out");
        let orders = g.tables.iter().find(|t| t.name == "orders").unwrap();
        assert!(orders.schema.is_none());
        let pk: Vec<_> = orders.columns.iter().filter(|c| c.primary_key).map(|c| c.name.as_str()).collect();
        assert_eq!(pk, ["id", "region"], "{key}");
        let line = g.links.iter().find(|l| l.id == "fk_line").unwrap();
        assert_eq!((line.from_columns.len(), line.to_table.as_str()), (2, "orders"), "{key}");
        assert_eq!(line.to_schema, None);
        let acc = g.links.iter().find(|l| l.id == "fk_acc").expect("cross database link");
        assert_eq!(acc.to_schema.as_deref(), Some(other.as_str()), "{key}");
        assert_eq!(acc.on_delete.as_deref(), Some("CASCADE"));
        let stub = g.tables.iter().find(|t| t.stub).unwrap();
        assert_eq!((stub.schema.as_deref(), stub.name.as_str()), (Some(other.as_str()), "accounts"));

        run(&a, &[format!("DROP DATABASE {db}"), format!("DROP DATABASE {other}")]).await;
    }
}

fn side(conn: &str, db: &str, table: &str) -> TableRef {
    TableRef { conn_id: conn.into(), conn_key: String::new(), database: Some(db.into()), schema: None, table: table.into() }
}

fn request(left: TableRef, right: TableRef, cols: &[&str], page_size: usize) -> CompareDataRequest {
    CompareDataRequest {
        left,
        right,
        key_columns: vec!["k".into()],
        columns: cols.iter().map(|c| c.to_string()).collect(),
        filter: None,
        after_key: None,
        count_all: true,
        page_size,
        run_id: uuid::Uuid::new_v4().to_string(),
    }
}

async fn diff(l: &dyn DbAdapter, r: &dyn DbAdapter, req: &CompareDataRequest) -> (crate::api::CompareSummary, Vec<DiffRow>) {
    let mut found = Vec::new();
    let mut sink = |c: CompareChunk| {
        if let CompareChunk::Rows { rows } = c {
            found.extend(rows);
        }
        Ok(())
    };
    let s = compare_data_on(l, r, "mysql-cmp-test", req, &mut sink).await.unwrap();
    (s, found)
}

fn table_sql(db: &str, collation: &str) -> Vec<String> {
    vec![
        format!("CREATE TABLE {db}.t (k VARCHAR(10) COLLATE {collation} PRIMARY KEY, n BIGINT UNSIGNED, \
                 d DECIMAL(65,30), b BIT(4), raw VARBINARY(4), j JSON, at DATETIME)"),
    ]
}

/// AC-24: compare works within one server and across MySQL and MariaDB,
/// with case insensitive keys ordered in binary on both sides, values
/// compared by type, resumed pages, and a MySQL sync script.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL and DH_TEST_MARIADB_URL"]
async fn mysql_live_compare_across_mysql_and_mariadb() {
    let (Ok(my_url), Ok(maria_url)) = (std::env::var("DH_TEST_MYSQL_URL"), std::env::var("DH_TEST_MARIADB_URL")) else {
        return;
    };
    let my = connect(&my_url, json!({})).await;
    let maria = connect(&maria_url, json!({})).await;
    assert_eq!((my.server().flavor, maria.server().flavor), (Flavor::Mysql, Flavor::Mariadb));
    let db = format!("dh_c_{}", suffix());
    run(&my, &[format!("CREATE DATABASE {db}")]).await;
    run(&maria, &[format!("CREATE DATABASE {db}")]).await;
    run(&my, &table_sql(&db, "utf8mb4_0900_ai_ci")).await;
    run(&maria, &table_sql(&db, "utf8mb4_unicode_ci")).await;
    run(&my, &[format!(
        "INSERT INTO {db}.t VALUES \
         ('a', 18446744073709551615, 1.5, b'0101', 0xDEAD, '{{\"a\": 1, \"b\": [1, 2]}}', '2024-03-01 08:00:00'), \
         ('B', 2, 2, b'1', 'hi', '[]', NULL), \
         ('c', 3, 3, b'0', NULL, NULL, NULL)"
    )])
    .await;
    // Same `a` (JSON keys in another order, decimal padded differently),
    // a changed `B`, no `c`, and an extra `d`.
    run(&maria, &[format!(
        "INSERT INTO {db}.t VALUES \
         ('a', 18446744073709551615, 1.50, b'0101', 0xDEAD, '{{\"b\":[1,2],\"a\":1}}', '2024-03-01 08:00:00'), \
         ('B', 2, 2, b'11', 'hi', '[]', NULL), \
         ('d', 4, 4, b'0', NULL, NULL, NULL)"
    )])
    .await;

    let cols = ["n", "d", "b", "raw", "j", "at"];
    let req = request(side("my", &db, "t"), side("maria", &db, "t"), &cols, DIFF_PAGE_SIZE);
    let (s, found) = diff(&my, &maria, &req).await;
    let c = s.counts;
    assert_eq!((c.identical, c.changed, c.left_only, c.right_only), (1, 1, 1, 1), "{found:?}");
    // Binary order: `B` (0x42) before `c` (0x63) before `d`, though `a` sorts first in the collation too.
    let got: Vec<_> = found.iter().map(|r| (r.kind, r.key_display[0].clone())).collect();
    assert_eq!(
        got,
        [(DiffKind::Changed, "B".into()), (DiffKind::LeftOnly, "c".into()), (DiffKind::RightOnly, "d".into())]
    );
    assert_eq!(found[0].changed, Some(vec![2]), "only the BIT column differs");

    // Pages resume after the last key, the same rows come back.
    let mut paged = Vec::new();
    let mut req = request(side("my", &db, "t"), side("maria", &db, "t"), &cols, 1);
    loop {
        let (s, rows) = diff(&my, &maria, &req).await;
        paged.extend(rows.into_iter().map(|r| r.key_display[0].clone()));
        match s.next_key {
            Some(k) => {
                req.after_key = Some(k);
                req.run_id = uuid::Uuid::new_v4().to_string();
            }
            None => break,
        }
    }
    assert_eq!(paged, ["B", "c", "d"]);

    // The sync script is MySQL, with the BIT value as its literal.
    let mut req = request(side("my", &db, "t"), side("maria", &db, "t"), &cols, DIFF_PAGE_SIZE);
    req.run_id = uuid::Uuid::new_v4().to_string();
    let mut script = Vec::new();
    compare_to_writer_on(&my, &maria, "mysql-cmp-test", &req, CompareFileKind::SyncScript, &mut script).await.unwrap();
    let script = String::from_utf8(script).unwrap();
    assert!(script.contains(&format!("UPDATE `{db}`.`t` SET `b` = b'0001' WHERE `k` = 'B';")), "{script}");
    assert!(script.contains(&format!("DELETE FROM `{db}`.`t` WHERE `k` = 'd';")), "{script}");
    assert!(script.contains("X'dead'") || !script.contains("0xDEAD"), "{script}");
    // Running it on the right side makes the two match.
    for stmt in script.lines().filter(|l| !l.starts_with("--") && !l.trim().is_empty()) {
        maria.run_sql(Some(&db), stmt).await.unwrap_or_else(|e| panic!("{stmt}: {e}"));
    }
    let mut req = request(side("my", &db, "t"), side("maria", &db, "t"), &cols, DIFF_PAGE_SIZE);
    req.run_id = uuid::Uuid::new_v4().to_string();
    let (s, _) = diff(&my, &maria, &req).await;
    assert_eq!(s.counts.differences(), 0, "{script}");

    // A filter is read only: a second statement never runs.
    let mut bad = request(side("my", &db, "t"), side("my", &db, "t"), &["n"], DIFF_PAGE_SIZE);
    bad.filter = Some(format!("1 = 1; DELETE FROM {db}.t"));
    let mut sink = |_: CompareChunk| Ok(());
    assert!(compare_data_on(&my, &my, "mysql-cmp-test", &bad, &mut sink).await.is_err());
    let left = my.run_sql(None, &format!("SELECT COUNT(*) FROM {db}.t")).await.unwrap();
    assert_eq!(left.rows, vec![vec![Some("3".into())]]);

    run(&my, &[format!("DROP DATABASE {db}")]).await;
    run(&maria, &[format!("DROP DATABASE {db}")]).await;
}

fn labels(n: &PlanNode, out: &mut Vec<String>) {
    out.push(n.label.clone());
    for c in &n.children {
        labels(c, out);
    }
}

/// AC-25 and AC-17: an estimate never runs the statement, Analyze runs it
/// in a transaction that is rolled back, the server's own message shows for
/// a statement it can't analyze, and a read only connection refuses
/// Analyze of a write.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_explain_estimates_and_analyzes_with_rollback() {
    for (key, url) in urls() {
        let a = connect(&url, json!({})).await;
        let t = format!("dh_ex_{}", suffix());
        run(&a, &[
            format!("CREATE TABLE {t} (id INT PRIMARY KEY, n INT, KEY (n))"),
            format!("INSERT INTO {t} VALUES (1, 1), (2, 2), (3, 3)"),
        ])
        .await;
        let dialect = match a.server().flavor {
            Flavor::Mysql => PlanDialect::Mysql,
            Flavor::Mariadb => PlanDialect::Mariadb,
        };

        let est = a.explain_sql(None, &format!("SELECT * FROM {t} WHERE n > 1;"), false, None).await;
        assert_eq!(est.dialect, dialect);
        assert!(est.error.is_none() && est.unsupported.is_none(), "{key} {est:?}");
        let mut seen = Vec::new();
        labels(est.root.as_ref().unwrap(), &mut seen);
        assert!(seen.iter().any(|l| l.contains("scan") || l.contains("lookup")), "{key} {seen:?}");

        let an = a.explain_sql(None, &format!("SELECT * FROM {t} WHERE n > 1"), true, None).await;
        assert!(an.error.is_none(), "{key} {an:?}");
        let root = an.root.unwrap();
        let mut any_actual = false;
        let mut stack = vec![&root];
        while let Some(n) = stack.pop() {
            any_actual |= n.actual_rows.is_some() || n.actual_time_ms.is_some();
            stack.extend(n.children.iter());
        }
        assert!(any_actual, "{key}: analyze carries real numbers");

        // A write: MariaDB analyzes it and rolls it back; MySQL can't analyze
        // a single table DELETE and its own message shows. Either way the
        // rows stay.
        let del = a.explain_sql(None, &format!("DELETE FROM {t} WHERE n > 1"), true, None).await;
        match a.server().flavor {
            Flavor::Mariadb => assert!(del.error.is_none() && del.root.is_some(), "{key} {del:?}"),
            Flavor::Mysql => assert!(del.error.is_some() || del.root.is_some(), "{key} {del:?}"),
        }
        let count = a.run_sql(None, &format!("SELECT COUNT(*) FROM {t}")).await.unwrap();
        assert_eq!(count.rows, vec![vec![Some("3".into())]], "{key}: analyze must roll back");
        let upd = a.explain_sql(None, &format!("UPDATE {t} a JOIN {t} b ON a.id = b.id SET a.n = 9"), true, None).await;
        assert!(upd.error.is_none() || upd.root.is_none(), "{key} {upd:?}");
        let sum = a.run_sql(None, &format!("SELECT SUM(n) FROM {t}")).await.unwrap();
        assert_eq!(sum.rows, vec![vec![Some("6".into())]], "{key}: a multi table update is rolled back");

        // An estimate of a write never runs it, and DDL is refused unsent.
        let est = a.explain_sql(None, &format!("DELETE FROM {t}"), false, None).await;
        assert!(est.error.is_none(), "{key} {est:?}");
        assert!(a.explain_sql(None, "DROP TABLE x", false, None).await.unsupported.is_some());
        let bad = a.explain_sql(None, "SELECT * FROM no_such_table", false, None).await;
        assert!(bad.error.as_deref().is_some_and(|e| e.contains("no_such_table")), "{key} {bad:?}");

        let ro = connect(&url, json!({ "read_only": true })).await;
        let refused = ro.explain_sql(None, &format!("DELETE FROM {t}"), true, None).await;
        assert!(refused.error.as_deref().is_some_and(|e| e.starts_with(crate::db::READ_ONLY_PREFIX)), "{key} {refused:?}");
        // MySQL won't even estimate a write in a read only session; that
        // second guard stays, with a message that says why.
        let est = ro.explain_sql(None, &format!("DELETE FROM {t}"), false, None).await;
        assert!(est.error.as_deref().is_some_and(|e| e.contains("read only connection")), "{key} {est:?}");
        assert!(ro.explain_sql(None, &format!("SELECT * FROM {t}"), false, None).await.error.is_none());

        run(&a, &[format!("DROP TABLE {t}")]).await;
    }
}

/// AC-25: Stop ends an Analyze on the server, and the rollback still runs.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_stop_ends_an_analyze() {
    for (key, url) in urls() {
        let a = connect(&url, json!({})).await;
        let id = uuid::Uuid::new_v4().to_string();
        let handle = crate::db::runs::register("mysql-explain-test", &id);
        let stopper = {
            let id = id.clone();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                crate::db::runs::cancel("mysql-explain-test", &id).await
            })
        };
        let start = std::time::Instant::now();
        let res = a.explain_sql(None, "SELECT SLEEP(20)", true, Some(&handle)).await;
        let _ = stopper.await;
        assert!(start.elapsed().as_secs() < 10, "{key}: Stop must end it");
        assert!(res.cancelled || res.error.is_none(), "{key} {res:?}");
        let next = a.run_sql(None, "SELECT 1").await.unwrap();
        assert_eq!(next.rows, vec![vec![Some("1".into())]]);
    }
}
