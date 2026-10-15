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

fn urls() -> Vec<(&'static str, String)> {
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

async fn connect(url: &str, extra: serde_json::Value) -> MySqlAdapter {
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

/// AC-13 (all but the binary column rule, pending the spec amendment):
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

/// AC-13's binary rule: a `_bin` collated text column (and MariaDB's JSON,
/// a `utf8mb4_bin` LONGTEXT) shows its text, and only a real binary column
/// shows `0x` hex. EXPECTED TO FAIL until spec 0025 names a source for the
/// binary decision: sqlx exposes only the BINARY flag, which both carry.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL; pending spec 0025 amendment"]
async fn mysql_live_binary_flagged_text_shows_as_text() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let t = table();
        a.run_sql(None, &format!("CREATE TABLE {t} (t VARCHAR(10) COLLATE utf8mb4_bin, j JSON, b VARBINARY(10))"))
            .await
            .unwrap();
        a.run_sql(None, &format!("INSERT INTO {t} VALUES ('abc', '{{\"a\": 1}}', 'abc')")).await.unwrap();
        let r = a.run_sql(None, &format!("SELECT t, j, b FROM {t}")).await;
        a.run_sql(None, &format!("DROP TABLE {t}")).await.unwrap();
        let row = r.unwrap().rows[0].clone();
        assert_eq!(row[0].as_deref(), Some("abc"), "{key}: _bin text");
        assert!(row[1].as_deref().is_some_and(|j| j.contains("\"a\"")), "{key}: json {:?}", row[1]);
        assert_eq!(row[2].as_deref(), Some("0x616263"), "{key}: varbinary");
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

        // Writes wait for build plan slice 4 and say so.
        let insert = QueryOp::Insert { table: "items".into(), values: Default::default(), skip_empty: false };
        assert!(a.execute_op(Some(&other), &insert).await.is_err(), "{key}");

        a.run_sql(None, &format!("DROP DATABASE {other}")).await.unwrap();
    }
}
