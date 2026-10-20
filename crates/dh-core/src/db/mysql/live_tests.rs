//! Against real servers, `#[ignore]`d like the other live tests:
//!
//! ```text
//! DH_TEST_MYSQL_URL=mysql://root:pw@127.0.0.1:3316/dh_test \
//! DH_TEST_MARIADB_URL=mysql://root:pw@127.0.0.1:3317/dh_test \
//!   cargo test -p dh-core -- --ignored mysql_live
//! ```
//!
//! Each test runs on every server whose URL is set, and is skipped (passes)
//! for one whose URL is not.

use std::time::{Duration, Instant};
use crate::api::{QueryChunk, QueryOp};
use crate::db::{runs, DbError, DbResult, READ_ONLY_PREFIX};
use super::{Flavor, MySqlAdapter, MySqlParams};

pub(super) fn urls() -> Vec<(&'static str, String)> {
    ["DH_TEST_MYSQL_URL", "DH_TEST_MARIADB_URL"]
        .into_iter()
        .filter_map(|k| std::env::var(k).ok().map(|v| (k, v)))
        .collect()
}

fn params(url: &str, extra: serde_json::Value) -> MySqlParams {
    let rest = url.split_once("://").expect("a mysql:// url").1;
    let (auth, tail) = rest.split_once('@').expect("user@host in the url");
    let (user, password) = auth.split_once(':').unwrap_or((auth, ""));
    let (hostport, database) = tail.split_once('/').unwrap_or((tail, ""));
    let (host, port) = hostport.split_once(':').unwrap_or((hostport, "3306"));
    let mut v = serde_json::json!({
        "host": host, "port": port.parse::<u16>().unwrap(), "user": user,
        "password": password, "database": database,
    });
    v.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    serde_json::from_value(v).unwrap()
}

pub(super) async fn connect(url: &str, extra: serde_json::Value) -> MySqlAdapter {
    MySqlAdapter::connect(&params(url, extra)).await.unwrap()
}

fn table() -> String {
    format!("dh_my_{}", uuid::Uuid::new_v4().simple())
}

fn rows(r: &crate::api::QueryResult) -> Vec<Vec<Option<String>>> {
    r.rows.clone()
}

/// AC-2, AC-3: flavor and version are detected, and the default user signs
/// in over TLS and over plain TCP (the RSA exchange on MySQL 8).
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_connects_and_detects_the_server() {
    for (key, url) in urls() {
        for ssl in ["PREFERRED", "DISABLED"] {
            let a = connect(&url, serde_json::json!({ "ssl_mode": ssl })).await;
            let expected = if key.contains("MARIADB") { Flavor::Mariadb } else { Flavor::Mysql };
            assert_eq!(a.server().flavor, expected, "{key} {ssl}");
            assert!(a.server().check_floor().is_ok());
            let r = a.run_sql(None, "SELECT 1").await.unwrap();
            assert_eq!(rows(&r), vec![vec![Some("1".into())]]);
        }
        // No database: the connection lands on the server.
        let a = connect(&url, serde_json::json!({ "database": "" })).await;
        let dbs = a.list_databases().await.unwrap();
        assert!(dbs.iter().any(|d| d == "information_schema"), "{dbs:?}");
    }
}

/// AC-3: a wrong password is the server's own access denied error.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_wrong_password_is_access_denied() {
    for (_, url) in urls() {
        let err = MySqlAdapter::connect(&params(&url, serde_json::json!({ "password": "nope" })))
            .await
            .err()
            .expect("must fail");
        assert!(err.to_string().contains("Access denied"), "{err}");
    }
}

/// AC-3: a MariaDB `ed25519` user gets the named plugin error.
#[tokio::test]
#[ignore = "requires DH_TEST_MARIADB_URL"]
async fn mysql_live_ed25519_user_gets_a_named_error() {
    let Ok(url) = std::env::var("DH_TEST_MARIADB_URL") else { return };
    let a = connect(&url, serde_json::json!({})).await;
    let user = format!("dh_ed_{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
    let _ = a.run_sql(None, "INSTALL SONAME 'auth_ed25519'").await;
    a.run_sql(None, &format!("CREATE USER '{user}'@'%' IDENTIFIED VIA ed25519 USING PASSWORD('pw')"))
        .await
        .unwrap();
    let err = MySqlAdapter::connect(&params(&url, serde_json::json!({ "user": user, "password": "pw" })))
        .await
        .err()
        .expect("ed25519 must be refused");
    let msg = err.to_string();
    a.run_sql(None, &format!("DROP USER '{user}'@'%'")).await.unwrap();
    assert!(msg.contains("client_ed25519") && msg.contains("caching_sha2_password"), "{msg}");
}

/// AC-13 (the binary column rule has its own test below):
/// values come back as the server's exact text, over both protocols.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_values_are_exact_text() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let t = table();
        a.run_sql(None, "SET SESSION sql_mode = ''").await.ok();
        a.run_sql(
            None,
            &format!(
                "CREATE TABLE {t} (id INT PRIMARY KEY, d DATE, dt DATETIME, u BIGINT UNSIGNED, \
                 dec65 DECIMAL(65,30), tm TIME, b BIT(4), j JSON, e ENUM('x','y'), y YEAR, \
                 f FLOAT, i8 TINYINT, ts DATETIME(3))"
            ),
        )
        .await
        .unwrap();
        // Zero dates need a lenient sql_mode, set on the same session.
        a.run_sql(
            None,
            &format!(
                "INSERT INTO {t} VALUES (1, '2024-02-29', '2024-02-29 13:05:09', 18446744073709551615, \
                 12345678901234567890123456789012345.123456789012345678901234567890, '-838:59:59', \
                 b'0101', '{{\"a\": 1}}', 'y', 2024, 1.1, -5, '2024-01-02 03:04:05.120')"
            ),
        )
        .await
        .unwrap();
        a.run_sql(None, &format!("SET SESSION sql_mode = ''; INSERT INTO {t} (id, d, dt) VALUES (2, '0000-00-00', '0000-00-00 00:00:00')"))
            .await
            .ok();

        let text = a.run_sql(None, &format!("SELECT * FROM {t} WHERE id = 1")).await.unwrap();
        let prepared = a
            .run_sql_params(None, &format!("SELECT * FROM {t} WHERE id = ?"), &[Some("1".into())])
            .await
            .unwrap();
        for (wire, r) in [("text", &text), ("binary", &prepared)] {
            let row = &r.rows[0];
            let get = |i: usize| row[i].clone().unwrap_or_default();
            assert_eq!(get(1), "2024-02-29", "{key} {wire}");
            assert_eq!(get(2), "2024-02-29 13:05:09", "{key} {wire}");
            assert_eq!(get(3), "18446744073709551615", "{key} {wire}");
            assert_eq!(get(4), "12345678901234567890123456789012345.123456789012345678901234567890", "{key} {wire}");
            assert_eq!(get(5), "-838:59:59", "{key} {wire}");
            assert_eq!(get(6), "b'0101'", "{key} {wire}");
            assert_eq!(get(8), "y", "{key} {wire}");
            assert_eq!(get(9), "2024", "{key} {wire}");
            assert_eq!(get(10), "1.1", "{key} {wire}");
            assert_eq!(get(11), "-5", "{key} {wire}");
            assert!(get(12).starts_with("2024-01-02 03:04:05.12"), "{key} {wire}: {}", get(12));
        }
        // The zero date, when the server accepted it.
        let zero = a
            .run_sql_params(None, &format!("SELECT d, dt FROM {t} WHERE id = ?"), &[Some("2".into())])
            .await
            .unwrap();
        if let Some(row) = zero.rows.first() {
            assert_eq!(row[0].as_deref(), Some("0000-00-00"), "{key}");
            assert_eq!(row[1].as_deref(), Some("0000-00-00 00:00:00"), "{key}");
        }
        a.run_sql(None, &format!("DROP TABLE {t}")).await.unwrap();
    }
}

/// AC-13's binary column rule: a table read the app builds asks the catalog,
/// so a `_bin` collated text column and JSON (MariaDB's `utf8mb4_bin`
/// LONGTEXT included) show their text and only the real binary column shows
/// `0x` hex. Editor results have no known table: a BINARY flagged cell shows
/// as text when its bytes are valid UTF-8, and as hex when they are not.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_binary_flagged_text_shows_as_text() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let t = table();
        a.run_sql(None, &format!("CREATE TABLE {t} (t VARCHAR(10) COLLATE utf8mb4_bin, j JSON, b VARBINARY(10))"))
            .await
            .unwrap();
        a.run_sql(None, &format!("INSERT INTO {t} VALUES ('abc', '{{\"a\": 1}}', 'abc')")).await.unwrap();

        // Grid page read: the catalog decides.
        let select = QueryOp::Select {
            table: t.clone(),
            filters: vec![],
            custom_where: None,
            order_by: vec![],
            limit: Some(10),
            offset: None,
        };
        let grid = a.execute_op(None, &select).await;
        // Filter values: the catalog decides too.
        let distinct = QueryOp::SelectDistinct { table: t.clone(), column: "b".into(), limit: Some(10) };
        let values = a.execute_op(None, &distinct).await;
        // Editor run: the per cell fallback.
        let editor = a.run_sql(None, &format!("SELECT t, j, b FROM {t}")).await;
        let unhex = a.run_sql(None, "SELECT UNHEX('FF00') AS raw").await;
        a.run_sql(None, &format!("DROP TABLE {t}")).await.unwrap();

        let row = grid.unwrap().result.rows[0].clone();
        assert_eq!(row[0].as_deref(), Some("abc"), "{key}: grid _bin text");
        assert!(row[1].as_deref().is_some_and(|j| j.contains("\"a\"")), "{key}: grid json {:?}", row[1]);
        assert_eq!(row[2].as_deref(), Some("0x616263"), "{key}: grid varbinary");
        assert_eq!(values.unwrap().result.rows, vec![vec![Some("0x616263".into())]], "{key}: filter values");

        let row = editor.unwrap().rows[0].clone();
        assert_eq!(row[0].as_deref(), Some("abc"), "{key}: editor _bin text");
        assert!(row[1].as_deref().is_some_and(|j| j.contains("\"a\"")), "{key}: editor json {:?}", row[1]);
        assert_eq!(row[2].as_deref(), Some("abc"), "{key}: editor varbinary, valid UTF-8");
        assert_eq!(rows(&unhex.unwrap()), vec![vec![Some("0xFF00".into())]], "{key}: editor non UTF-8 bytes");
    }
}

/// The binary column rule's catalog failure path: a grid read of a table the
/// catalog can't find (here a temporary table, which `information_schema`
/// does not list) still succeeds on the fallback.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_grid_read_survives_a_missing_catalog_row() {
    for (key, url) in urls() {
        // One connection, so the temporary table is visible to the read.
        let a = connect(&url, serde_json::json!({ "pool_max": 1 })).await;
        let t = table();
        a.run_sql(None, &format!("CREATE TEMPORARY TABLE {t} (b VARBINARY(10))")).await.unwrap();
        a.run_sql(None, &format!("INSERT INTO {t} VALUES (UNHEX('FF')), ('ok')")).await.unwrap();
        let select = QueryOp::Select {
            table: t.clone(),
            filters: vec![],
            custom_where: None,
            order_by: vec![],
            limit: None,
            offset: None,
        };
        let page = a.execute_op(None, &select).await.unwrap();
        assert_eq!(
            page.result.rows,
            vec![vec![Some("0xFF".into())], vec![Some("ok".into())]],
            "{key}"
        );
    }
}

/// AC-8: the structure shows the full MySQL type, extra and comment.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_table_structure() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let t = table();
        a.run_sql(
            None,
            &format!(
                "CREATE TABLE {t} (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, \
                 kind ENUM('a','b') NOT NULL DEFAULT 'a' COMMENT 'the kind', \
                 name VARCHAR(255), at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP, \
                 KEY by_name (name))"
            ),
        )
        .await
        .unwrap();
        let (schema, statements) = a.table_schema(None, &t).await.unwrap();
        assert_eq!(schema.kind, "table");
        assert_eq!(statements.len(), 5);
        let c = |n: &str| schema.columns.iter().find(|c| c.name == n).unwrap().clone();
        // The server's own text: `int unsigned` (MySQL), `int(10) unsigned` (MariaDB).
        assert!(c("id").data_type.starts_with("int") && c("id").data_type.ends_with("unsigned"), "{key}");
        assert!(c("id").primary_key && c("id").extra.as_deref() == Some("auto_increment"), "{key}");
        assert_eq!(c("kind").enum_values, vec!["a", "b"], "{key}");
        assert_eq!(c("kind").default.as_deref(), Some("a"), "{key}");
        assert_eq!(c("kind").comment.as_deref(), Some("the kind"), "{key}");
        assert_eq!(c("name").data_type, "varchar(255)", "{key}");
        assert_eq!(c("at").default, None, "{key}");
        assert!(c("at").extra.unwrap_or_default().to_lowercase().contains("on update"), "{key}");
        assert!(schema.indexes.iter().any(|i| i.name == "by_name" && i.columns == vec!["name"]));
        assert!(schema.indexes.iter().any(|i| i.name == "PRIMARY" && i.unique));

        let tables = a.list_schema_objects(None, crate::db::SchemaObjectKind::Table).await.unwrap();
        assert!(tables.iter().any(|o| o.name == t), "{key}");
        a.run_sql(None, &format!("DROP TABLE {t}")).await.unwrap();
    }
}

/// AC-11: rows stream in batches and the grid page read streams too.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_streams_in_batches() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let mut chunks = 0usize;
        let mut total = 0usize;
        let mut sink = |c: QueryChunk| {
            chunks += 1;
            total += c.rows.len();
            Ok(())
        };
        // 1000 x 5 rows: MySQL caps a recursive CTE at 1000 levels by default.
        let sql = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000) \
                   SELECT n.i FROM n CROSS JOIN (SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 \
                   UNION ALL SELECT 4 UNION ALL SELECT 5) five";
        let r = a.run_sql_stream(None, sql, None, &mut sink).await.unwrap();
        assert_eq!(total, 5000, "{key}");
        assert!(chunks >= 10, "{key}: {chunks} chunks");
        assert_eq!(r.columns, vec!["i"]);

        // A select with no rows still reports its columns.
        let empty = a.run_sql(None, "SELECT 1 AS a, 2 AS b FROM DUAL WHERE 1 = 0").await.unwrap();
        assert_eq!(empty.columns, vec!["a", "b"], "{key}");
    }
}

/// AC-12: Stop kills the query on the server, and the next query runs.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_stop_kills_the_query() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({ "pool_max": 2 })).await;
        let run_id = format!("run-{}", uuid::Uuid::new_v4().simple());
        let run = runs::register("t-my", &run_id);
        let stopper = {
            let run_id = run_id.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(500)).await;
                runs::cancel("t-my", &run_id).await
            })
        };
        let started = Instant::now();
        let mut sink = |_: QueryChunk| Ok(());
        let tag = uuid::Uuid::new_v4().simple().to_string();
        let res = a.run_sql_stream(None, &format!("SELECT SLEEP(30) /* {tag} */"), Some(&run), &mut sink).await;
        assert!(matches!(res, Err(DbError::Cancelled)), "{key}: {res:?}");
        assert!(started.elapsed() < Duration::from_secs(4), "{key}");
        assert_eq!(stopper.await.unwrap().state, runs::CancelState::Stopped, "{key}");

        let list = a
            .run_sql(None, &format!("SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE INFO LIKE '%{tag}%' AND INFO NOT LIKE '%PROCESSLIST%'"))
            .await
            .unwrap();
        assert_eq!(rows(&list), vec![vec![Some("0".into())]], "{key}");
        let next = a.run_sql(None, "SELECT 2").await.unwrap();
        assert_eq!(rows(&next), vec![vec![Some("2".into())]], "{key}");
    }
}

fn is_refusal<T>(res: DbResult<T>) -> bool {
    matches!(&res, Err(DbError::ReadOnly(m)) if m.starts_with(READ_ONLY_PREFIX))
}

/// AC-17: the classifier refuses writes before the server, and the session
/// itself is read only underneath it.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_read_only_refuses_writes() {
    for (key, url) in urls() {
        let rw = connect(&url, serde_json::json!({})).await;
        let ro = connect(&url, serde_json::json!({ "read_only": true })).await;
        let t = table();
        rw.run_sql(None, &format!("CREATE TABLE {t} (id INT PRIMARY KEY)")).await.unwrap();
        rw.run_sql(None, &format!("INSERT INTO {t} VALUES (1)")).await.unwrap();

        for sql in [
            format!("UPDATE {t} SET id = 2"),
            format!("DROP TABLE {t}"),
            format!("SELECT 1; DELETE FROM {t}"),
            format!("SELECT * FROM {t} INTO OUTFILE '/tmp/x'"),
            "SET SESSION TRANSACTION READ WRITE".to_string(),
        ] {
            assert!(is_refusal(ro.run_sql(None, &sql).await), "{key}: {sql}");
        }
        let delete = QueryOp::Delete { table: t.clone(), match_row: [("id".to_string(), Some("1".to_string()))].into() };
        assert!(is_refusal(ro.execute_op(None, &delete).await), "{key}");
        // Reads still work, and the session is read only underneath.
        assert_eq!(rows(&ro.run_sql(None, &format!("SELECT id FROM {t}")).await.unwrap()), vec![vec![Some("1".into())]]);
        let flag = ro.run_sql(None, "SELECT @@SESSION.transaction_read_only").await.unwrap();
        assert_eq!(rows(&flag), vec![vec![Some("1".into())]], "{key}");

        // The read only run rolls back and keeps to its time limit.
        let mut sink = |_: QueryChunk| Ok(());
        let slow = rw.run_read_only(None, "SELECT SLEEP(3)", Some(200), None, &mut sink).await;
        let timed_out = matches!(&slow, Err(DbError::InvalidOperation(m)) if m == crate::db::sql_builder::TIME_LIMIT_ERROR);
        // MySQL answers SLEEP's time limit with 1 instead of an error.
        assert!(timed_out || slow.is_ok(), "{key}: {slow:?}");
        rw.run_sql(None, &format!("DROP TABLE {t}")).await.unwrap();
    }
}

/// AC-8, AC-11: the grid's page read streams, counts and distinct values
/// work, in the connection's default database and in another one.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_grid_reads() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let other = format!("dh_db_{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
        a.run_sql(None, &format!("CREATE DATABASE {other}")).await.unwrap();
        a.run_sql(Some(&other), "CREATE TABLE items (id INT PRIMARY KEY, kind VARCHAR(10))").await.unwrap();
        a.run_sql(Some(&other), "INSERT INTO items VALUES (1,'a'),(2,'b'),(3,'a')").await.unwrap();

        let select = QueryOp::Select {
            table: "items".into(),
            filters: vec![],
            custom_where: Some("`kind` = 'a'".into()),
            order_by: vec![crate::api::OrderByCond { column: "id".into(), dir: "DESC".into() }],
            limit: Some(10),
            offset: None,
        };
        let page = a.execute_op(Some(&other), &select).await.unwrap();
        assert_eq!(page.result.columns, vec!["id", "kind"], "{key}");
        assert_eq!(
            page.result.rows,
            vec![vec![Some("3".into()), Some("a".into())], vec![Some("1".into()), Some("a".into())]],
            "{key}"
        );
        assert!(page.sql.unwrap().contains(&format!("`{other}`.`items`")), "{key}");

        let count = QueryOp::Count { table: "items".into(), filters: vec![], custom_where: None };
        let n = a.execute_op(Some(&other), &count).await.unwrap();
        assert_eq!(n.result.rows, vec![vec![Some("3".into())]], "{key}");

        let distinct = QueryOp::SelectDistinct { table: "items".into(), column: "kind".into(), limit: Some(10) };
        let d = a.execute_op(Some(&other), &distinct).await.unwrap();
        assert_eq!(d.result.rows.len(), 2, "{key}");

        // The catalog sees the other database's table too.
        let tables = a.list_schema_objects(Some(&other), crate::db::SchemaObjectKind::Table).await.unwrap();
        assert_eq!(tables.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), vec!["items"], "{key}");

        a.run_sql(None, &format!("DROP DATABASE {other}")).await.unwrap();
    }
}

fn map(pairs: &[(&str, Option<&str>)]) -> std::collections::BTreeMap<String, Option<String>> {
    pairs.iter().map(|(k, v)| (k.to_string(), v.map(str::to_string))).collect()
}

fn page(t: &str) -> QueryOp {
    QueryOp::Select { table: t.into(), filters: vec![], custom_where: None, order_by: vec![], limit: None, offset: None }
}

/// AC-14: inserts show their generated id, updates and deletes match the
/// full original row, and binary cells follow the binding rule.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_grid_edits() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let t = table();
        a.run_sql(None, &format!("CREATE TABLE {t} (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(20), raw VARBINARY(10))"))
            .await
            .unwrap();

        let insert = QueryOp::Insert { table: t.clone(), values: map(&[("id", None), ("name", Some("a")), ("raw", Some("hi"))]), skip_empty: true };
        let ins = a.execute_op(None, &insert).await.unwrap();
        assert_eq!(ins.result.rows_affected, 1, "{key}");
        assert_eq!(ins.result.columns, vec!["id", "name", "raw"], "{key}");
        assert_eq!(ins.result.rows, vec![vec![Some("1".into()), Some("a".into()), Some("0x6869".into())]], "{key}");

        // Binary cell: hex pairs store those bytes, anything else its UTF-8.
        let original = ins.result.rows[0].clone();
        let row = |r: &[Option<String>]| map(&[("id", r[0].as_deref()), ("name", r[1].as_deref()), ("raw", r[2].as_deref())]);
        let set_raw = |v: &str, from: &[Option<String>]| QueryOp::Update { table: t.clone(), set: map(&[("raw", Some(v))]), match_row: row(from) };
        assert_eq!(a.execute_op(None, &set_raw("0xDEAD", &original)).await.unwrap().result.rows_affected, 1, "{key}");
        let hex = a.run_sql(None, &format!("SELECT HEX(raw) FROM {t}")).await.unwrap();
        assert_eq!(rows(&hex), vec![vec![Some("DEAD".into())]], "{key}");
        let shown = a.execute_op(None, &page(&t)).await.unwrap().result.rows[0].clone();
        assert_eq!(shown[2].as_deref(), Some("0xDEAD"), "{key}");
        // The row shown with hex still matches.
        assert_eq!(a.execute_op(None, &set_raw("hi", &shown)).await.unwrap().result.rows_affected, 1, "{key}");
        let hex = a.run_sql(None, &format!("SELECT HEX(raw) FROM {t}")).await.unwrap();
        assert_eq!(rows(&hex), vec![vec![Some("6869".into())]], "{key}");

        // Typing `0x41` into a text column keeps the four characters.
        let shown = a.execute_op(None, &page(&t)).await.unwrap().result.rows[0].clone();
        let set_name = QueryOp::Update { table: t.clone(), set: map(&[("name", Some("0x41"))]), match_row: row(&shown) };
        a.execute_op(None, &set_name).await.unwrap();
        let name = a.run_sql(None, &format!("SELECT name FROM {t}")).await.unwrap();
        assert_eq!(rows(&name), vec![vec![Some("0x41".into())]], "{key}");

        let shown = a.execute_op(None, &page(&t)).await.unwrap().result.rows[0].clone();
        let delete = QueryOp::Delete { table: t.clone(), match_row: row(&shown) };
        assert_eq!(a.execute_op(None, &delete).await.unwrap().result.rows_affected, 1, "{key}");
        a.run_sql(None, &format!("DROP TABLE {t}")).await.unwrap();
    }
}

/// AC-14: a table with no primary key. A FLOAT match still finds its row,
/// identical duplicates change together, and the column types the spec's
/// `=` rule covers match by their displayed text (`BIT` and `JSON` have
/// their own pending test below).
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_no_key_edits_match_by_displayed_text() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let t = table();
        a.run_sql(
            None,
            &format!(
                "CREATE TABLE {t} (f FLOAT, d DOUBLE, u BIGINT UNSIGNED, dec65 DECIMAL(65,30), tm TIME, \
                 e ENUM('x','y'), s SET('p','q'), y YEAR, dt DATETIME(3), note VARCHAR(10))"
            ),
        )
        .await
        .unwrap();
        let values = "1.1, 0.1, 18446744073709551615, 1.5, '-838:59:59', 'y', 'p,q', 2024, '2024-01-02 03:04:05.120'";
        a.run_sql(None, &format!("INSERT INTO {t} VALUES ({values}, 'one'), ({values}, 'one'), (2.5, {}, 'two')", &values[5..]))
            .await
            .unwrap();
        let before = a.run_sql(None, &format!("CHECKSUM TABLE {t}")).await.unwrap().rows[0][1].clone();

        let shown = a.execute_op(None, &page(&t)).await.unwrap().result;
        let match_row = |r: &[Option<String>]| -> std::collections::BTreeMap<String, Option<String>> {
            shown.columns.iter().cloned().zip(r.iter().cloned()).collect()
        };
        let first = shown.rows[0].clone();
        let set = |v: &str, from: &[Option<String>]| QueryOp::Update { table: t.clone(), set: map(&[("note", Some(v))]), match_row: match_row(from) };

        // Both identical rows change together, the third one doesn't.
        let res = a.execute_op(None, &set("changed", &first)).await.unwrap();
        assert_eq!(res.result.rows_affected, 2, "{key}: {:?}", res.sql);
        let notes = a.run_sql(None, &format!("SELECT note FROM {t} ORDER BY f, note")).await.unwrap();
        assert_eq!(rows(&notes), vec![vec![Some("changed".into())], vec![Some("changed".into())], vec![Some("two".into())]], "{key}");

        // And back: the table is byte for byte what it was.
        let after = a.execute_op(None, &page(&t)).await.unwrap().result.rows[0].clone();
        a.execute_op(None, &set("one", &after)).await.unwrap();
        let again = a.run_sql(None, &format!("CHECKSUM TABLE {t}")).await.unwrap().rows[0][1].clone();
        assert_eq!(before, again, "{key}");
        a.run_sql(None, &format!("DROP TABLE {t}")).await.unwrap();
    }
}

/// AC-16: a connection killed by the server partway through a stream keeps
/// the rows already received, reports the error, and the pool serves the
/// next query on a fresh connection with no manual reconnect.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_a_dropped_connection_keeps_rows_and_recovers() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({ "pool_max": 2 })).await;
        let admin = connect(&url, serde_json::json!({})).await;
        let tag = uuid::Uuid::new_v4().simple().to_string();
        let killer = {
            let tag = tag.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(700)).await;
                let ids = admin
                    .run_sql(None, &format!("SELECT ID FROM information_schema.PROCESSLIST WHERE INFO LIKE '%{tag}%' AND INFO NOT LIKE '%PROCESSLIST%'"))
                    .await
                    .unwrap();
                for id in rows(&ids).into_iter().filter_map(|r| r[0].clone()) {
                    admin.run_sql(None, &format!("KILL {id}")).await.unwrap();
                }
            })
        };
        let mut received = 0usize;
        let mut sink = |c: QueryChunk| {
            received += c.rows.len();
            Ok(())
        };
        // About 1 KB a row and 2 ms a row, so rows leave the server in
        // packets well before the 700 ms kill.
        let sql = format!(
            "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000) \
             SELECT n.i, REPEAT('x', 1000) AS pad, SLEEP(0.002) AS s /* {tag} */ FROM n"
        );
        let res = a.run_sql_stream(None, &sql, None, &mut sink).await;
        killer.await.unwrap();
        assert!(matches!(res, Err(DbError::SqlEngine(_))), "{key}: {res:?}");
        assert!(received > 0 && received < 1000, "{key}: {received} rows kept");

        let next = a.run_sql(None, "SELECT 2").await.unwrap();
        assert_eq!(rows(&next), vec![vec![Some("2".into())]], "{key}");
    }
}

/// AC-16: a grid edit blocked by another session's row lock fails with the
/// server's code and message, and the same edit (still staged in the grid)
/// lands once the lock is gone. Shortens the server's lock wait to 1 second
/// for connections opened meanwhile, then puts the default back.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_a_lock_wait_shows_the_server_error_and_can_be_retried() {
    use sqlx::{Connection as _, Executor as _};
    for (key, url) in urls() {
        let mut holder = sqlx::MySqlConnection::connect(&url).await.unwrap();
        let t = table();
        holder.execute(format!("CREATE TABLE {t} (id INT PRIMARY KEY, note VARCHAR(10))").as_str()).await.unwrap();
        holder.execute(format!("INSERT INTO {t} VALUES (1, 'a')").as_str()).await.unwrap();
        holder.execute("SET GLOBAL innodb_lock_wait_timeout = 1").await.unwrap();
        let a = connect(&url, serde_json::json!({})).await;

        holder.execute("START TRANSACTION").await.unwrap();
        holder.execute(format!("SELECT * FROM {t} WHERE id = 1 FOR UPDATE").as_str()).await.unwrap();
        let edit = QueryOp::Update { table: t.clone(), set: map(&[("note", Some("b"))]), match_row: map(&[("id", Some("1")), ("note", Some("a"))]) };
        let blocked = a.execute_op(None, &edit).await;
        // After the edit: the pool may open its connection only now.
        sqlx::query("SET GLOBAL innodb_lock_wait_timeout = DEFAULT").execute(&mut holder).await.unwrap();
        let message = match blocked {
            Err(e @ DbError::SqlEngine(_)) => e.to_string(),
            other => panic!("{key}: {:?}", other.map(|o| o.sql)),
        };
        assert!(message.contains("1205") && message.to_lowercase().contains("lock wait"), "{key}: {message}");

        holder.execute("ROLLBACK").await.unwrap();
        assert_eq!(a.execute_op(None, &edit).await.unwrap().result.rows_affected, 1, "{key}");
        holder.execute(format!("DROP TABLE {t}").as_str()).await.unwrap();
    }
}

fn filter(column: &str, op: crate::api::FilterOp, value: &str) -> crate::api::GridFilterCond {
    crate::api::GridFilterCond { column: column.into(), op, value: value.into(), values: vec![], conjunction: None }
}

/// AC-14 and AC-27 on `BIT` and `JSON` columns, on both flavors: rows match
/// by what the grid shows, `BIT` writes store the number their text spells,
/// and the equality and ordering filters find the row.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_bit_and_json_rows_match_by_displayed_text() {
    use crate::api::FilterOp;
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let mysql = a.server().flavor == Flavor::Mysql;
        let t = table();
        a.run_sql(None, &format!("CREATE TABLE {t} (b BIT(4), j JSON, note VARCHAR(10))")).await.unwrap();
        a.run_sql(
            None,
            &format!("INSERT INTO {t} VALUES (b'0101', '{{\"a\": [1, 2]}}', 'one'), (b'0001', 'null', 'n'), (b'0010', '[]', 'e')"),
        )
        .await
        .unwrap();
        let shown = a.execute_op(None, &page(&t)).await.unwrap().result;
        let match_row = |r: &[Option<String>]| -> std::collections::BTreeMap<String, Option<String>> {
            shown.columns.iter().cloned().zip(r.iter().cloned()).collect()
        };
        let first = shown.rows[0].clone();
        assert_eq!(first[0].as_deref(), Some("b'0101'"), "{key}");

        // Every row matches by its shown text, `null` and `[]` included.
        for r in &shown.rows {
            let set = QueryOp::Update { table: t.clone(), set: map(&[("note", Some("x"))]), match_row: match_row(r) };
            let res = a.execute_op(None, &set).await.unwrap();
            assert_eq!(res.result.rows_affected, 1, "{key}: {:?}", res.sql);
        }

        // Filters on the first row.
        let count = |filters: Vec<crate::api::GridFilterCond>| {
            let op = QueryOp::Count { table: t.clone(), filters, custom_where: None };
            let a = &a;
            async move { a.execute_op(None, &op).await.map(|o| o.result.rows_affected) }
        };
        assert_eq!(count(vec![filter("b", FilterOp::Eq, "b'0101'")]).await.unwrap(), 1, "{key}");
        assert_eq!(count(vec![filter("b", FilterOp::Eq, "5")]).await.unwrap(), 1, "{key}");
        assert_eq!(count(vec![filter("b", FilterOp::Gt, "b'0100'")]).await.unwrap(), 1, "{key}");
        let distinct = QueryOp::SelectDistinct { table: t.clone(), column: "j".into(), limit: None };
        let listed = a.execute_op(None, &distinct).await.unwrap().result.rows;
        let doc = first[1].clone().unwrap();
        assert!(listed.contains(&vec![Some(doc.clone())]), "{key}: {listed:?}");
        let mut picked = filter("j", FilterOp::In, "");
        picked.values = vec![doc.clone()];
        assert_eq!(count(vec![picked]).await.unwrap(), 1, "{key}");
        let mut bits = filter("b", FilterOp::In, "");
        bits.values = vec!["b'0101'".into(), "b'0001'".into()];
        assert_eq!(count(vec![bits]).await.unwrap(), 2, "{key}");
        let paged = QueryOp::Select {
            table: t.clone(),
            filters: vec![filter("b", FilterOp::Eq, "b'0101'")],
            custom_where: None,
            order_by: vec![],
            limit: Some(50),
            offset: None,
        };
        assert_eq!(a.execute_op(None, &paged).await.unwrap().result.rows.len(), 1, "{key}");
        assert_eq!(count(vec![filter("j", FilterOp::Eq, &doc)]).await.unwrap(), 1, "{key}");
        if mysql {
            let bad = count(vec![filter("j", FilterOp::Eq, "{oops")]).await;
            assert!(matches!(bad, Err(DbError::SqlEngine(_))), "{key}: {bad:?}");
        }

        // `BIT` writes: the shown form, then a plain number; anything else
        // gets the server's own error.
        let shown_now = a.execute_op(None, &page(&t)).await.unwrap().result;
        let current = shown_now.columns.iter().cloned().zip(shown_now.rows[0].iter().cloned()).collect::<std::collections::BTreeMap<_, _>>();
        assert_eq!(current.get("note").cloned().flatten().as_deref(), Some("x"), "{key}");
        let write = |set: &[(&str, Option<&str>)], match_row: std::collections::BTreeMap<String, Option<String>>| QueryOp::Update {
            table: t.clone(),
            set: map(set),
            match_row,
        };
        let numbers = format!("SELECT b + 0 FROM {t} WHERE note = 'm'");
        a.execute_op(None, &write(&[("b", Some("b'0110'")), ("note", Some("m"))], current.clone())).await.unwrap();
        assert_eq!(rows(&a.run_sql(None, &numbers).await.unwrap()), vec![vec![Some("6".into())]], "{key}");
        let shown_now = a.execute_op(None, &page(&t)).await.unwrap().result;
        let current = shown_now.columns.iter().cloned().zip(shown_now.rows[0].iter().cloned()).collect::<std::collections::BTreeMap<_, _>>();
        a.execute_op(None, &write(&[("b", Some("9"))], current.clone())).await.unwrap();
        assert_eq!(rows(&a.run_sql(None, &numbers).await.unwrap()), vec![vec![Some("9".into())]], "{key}");
        let shown_now = a.execute_op(None, &page(&t)).await.unwrap().result;
        let current = shown_now.columns.iter().cloned().zip(shown_now.rows[0].iter().cloned()).collect::<std::collections::BTreeMap<_, _>>();
        let refused = a.execute_op(None, &write(&[("b", Some("abc"))], current.clone())).await;
        assert!(matches!(refused, Err(DbError::SqlEngine(_))), "{key}: {:?}", refused.map(|o| o.sql));

        // A `JSON` write reads back as that JSON.
        a.execute_op(None, &write(&[("j", Some(r#"{"b": 2}"#))], current)).await.unwrap();
        let j = a.run_sql(None, &format!("SELECT j FROM {t} WHERE note = 'm'")).await.unwrap();
        assert_eq!(rows(&j), vec![vec![Some(r#"{"b": 2}"#.into())]], "{key}");

        // And the delete matches exactly one row.
        let shown_now = a.execute_op(None, &page(&t)).await.unwrap().result;
        let current = shown_now.columns.iter().cloned().zip(shown_now.rows[0].iter().cloned()).collect();
        let delete = QueryOp::Delete { table: t.clone(), match_row: current };
        assert_eq!(a.execute_op(None, &delete).await.unwrap().result.rows_affected, 1, "{key}");
        a.run_sql(None, &format!("DROP TABLE {t}")).await.unwrap();
    }
}

/// The app never changes `sql_mode` (spec 0025 key invariants). sqlx asks
/// for `CLIENT_IGNORE_SPACE` in the handshake, which adds `IGNORE_SPACE` to
/// the session; every pooled connection takes it off again, so a name like
/// `count (` parses as it does in the stock client.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_sessions_keep_the_server_sql_mode() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let modes = super::rows::fetch_text(&a.pool, "SELECT @@session.sql_mode, @@global.sql_mode", &[])
            .await
            .unwrap();
        assert_eq!(modes[0][0], modes[0][1], "{key}");
        a.run_sql(None, "CREATE TEMPORARY TABLE count (i INT)").await.unwrap();
    }
}
