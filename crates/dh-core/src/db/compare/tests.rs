use super::*;
use crate::api::{CompareChunk, CompareStatus, DiffKind, DiffRow, KeyVal};
use crate::db::SqliteAdapter;

async fn sqlite(setup: &[&str]) -> SqliteAdapter {
    let dir = std::env::temp_dir().join("dh-studio-tests");
    std::fs::create_dir_all(&dir).unwrap();
    let a = SqliteAdapter::connect(dir.join(format!("cmp-{}.db", uuid::Uuid::new_v4())))
        .await
        .unwrap();
    for sql in setup {
        a.run_sql(sql, None).await.unwrap();
    }
    a
}

fn side(table: &str) -> TableRef {
    TableRef { conn_id: "c".into(), conn_key: String::new(), database: None, schema: None, table: table.into() }
}

fn req(key: &[&str], cols: &[&str]) -> CompareDataRequest {
    CompareDataRequest {
        left: side("l"),
        right: side("r"),
        key_columns: key.iter().map(|s| s.to_string()).collect(),
        columns: cols.iter().map(|s| s.to_string()).collect(),
        filter: None,
        after_key: None,
        count_all: true,
        page_size: DIFF_PAGE_SIZE,
        run_id: uuid::Uuid::new_v4().to_string(),
    }
}

struct Ran {
    res: DbResult<CompareSummary>,
    rows: Vec<DiffRow>,
    chunks: Vec<CompareChunk>,
}

async fn run(a: &SqliteAdapter, req: &CompareDataRequest) -> Ran {
    let mut chunks = Vec::new();
    let mut sink = |c: CompareChunk| {
        chunks.push(c);
        Ok(())
    };
    let res = compare_data_on(a, a, "conn-test", req, &mut sink).await;
    let rows = chunks
        .iter()
        .filter_map(|c| match c {
            CompareChunk::Rows { rows } => Some(rows.clone()),
            _ => None,
        })
        .flatten()
        .collect();
    Ran { res, rows, chunks }
}

fn keys_of(rows: &[DiffRow]) -> Vec<(DiffKind, String)> {
    rows.iter().map(|r| (r.kind, r.key_display.join(","))).collect()
}

const TABLES: [&str; 2] = [
    "CREATE TABLE l (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER)",
    "CREATE TABLE r (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER)",
];

#[tokio::test]
async fn finds_changed_left_only_and_right_only_rows_in_key_order() {
    let a = sqlite(&[
        TABLES[0],
        TABLES[1],
        "INSERT INTO l VALUES (1,'a',1),(2,'b',2),(3,'c',3),(4,'d',4),(5,'e',5),(6,'f',6),(7,'g',7)",
        "INSERT INTO r VALUES (1,'a',1),(2,'B',2),(3,'c',30),(4,'D',40),(5,'e',5),(8,'h',8)",
    ])
    .await;

    let ran = run(&a, &req(&["id"], &["name", "qty"])).await;
    let s = ran.res.unwrap();

    assert_eq!(s.status, CompareStatus::Done);
    assert_eq!((s.counts.identical, s.counts.changed, s.counts.left_only, s.counts.right_only), (2, 3, 2, 1));
    assert_eq!((s.rows_read.left, s.rows_read.right), (7, 6));
    assert_eq!(s.total_diffs, Some(6));
    assert_eq!(s.next_key, None);
    assert_eq!(
        keys_of(&ran.rows),
        vec![
            (DiffKind::Changed, "2".into()),
            (DiffKind::Changed, "3".into()),
            (DiffKind::Changed, "4".into()),
            (DiffKind::LeftOnly, "6".into()),
            (DiffKind::LeftOnly, "7".into()),
            (DiffKind::RightOnly, "8".into()),
        ]
    );
    let four = &ran.rows[2];
    assert_eq!(four.changed, Some(vec![0, 1]));
    assert_eq!(four.left, Some(vec![Some("d".into()), Some("4".into())]));
    assert_eq!(four.right, Some(vec![Some("D".into()), Some("40".into())]));
    assert_eq!(four.key, vec![KeyVal::Int("4".into())]);
    assert_eq!(ran.rows[3].right, None);
    assert_eq!(ran.rows[5].left, None);
}

#[tokio::test]
async fn equal_values_across_types_zones_and_key_order_are_identical() {
    let a = sqlite(&[
        "CREATE TABLE l (id INTEGER PRIMARY KEY, n INTEGER, j JSON, t DATETIME, s TEXT)",
        "CREATE TABLE r (id INTEGER PRIMARY KEY, n REAL, j JSON, t DATETIME, s TEXT)",
        r#"INSERT INTO l VALUES (1, 1, '{"a":1,"b":[1,2]}', '2024-03-01T10:00:00+02:00', 'a')"#,
        r#"INSERT INTO r VALUES (1, 1.0, '{"b":[1,2],"a":1.0}', '2024-03-01 08:00:00', 'a ')"#,
    ])
    .await;

    let ran = run(&a, &req(&["id"], &["n", "j", "t", "s"])).await;
    let s = ran.res.unwrap();

    assert_eq!(s.counts.changed, 1);
    assert_eq!(ran.rows[0].changed, Some(vec![3]), "only the trailing space differs");
}

#[tokio::test]
async fn null_only_equals_null() {
    let a = sqlite(&[
        TABLES[0],
        TABLES[1],
        "INSERT INTO l VALUES (1, NULL, NULL), (2, '', 0)",
        "INSERT INTO r VALUES (1, NULL, NULL), (2, NULL, NULL)",
    ])
    .await;

    let s = run(&a, &req(&["id"], &["name", "qty"])).await.res.unwrap();

    assert_eq!((s.counts.identical, s.counts.changed), (1, 1));
}

#[tokio::test]
async fn a_repeated_key_stops_the_run_naming_the_side_and_value() {
    let a = sqlite(&[
        TABLES[0],
        TABLES[1],
        "INSERT INTO l VALUES (1,'a',1),(2,'b',2)",
        "INSERT INTO r VALUES (1,'a',1),(2,'a',2)",
    ])
    .await;

    let err = run(&a, &req(&["name"], &["qty"])).await.res.unwrap_err().to_string();

    assert!(err.contains("not unique on the right side"), "{err}");
    assert!(err.contains("(name)") && err.contains("a appears"), "{err}");
}

#[tokio::test]
async fn a_null_key_stops_the_run() {
    let a = sqlite(&[TABLES[0], TABLES[1], "INSERT INTO l VALUES (1,NULL,1)", "INSERT INTO r VALUES (1,'a',1)"]).await;

    let err = run(&a, &req(&["name"], &["qty"])).await.res.unwrap_err().to_string();

    assert!(err.contains("holds NULL on the left side"), "{err}");
}

#[tokio::test]
async fn a_key_the_database_orders_differently_is_refused_not_misread() {
    let a = sqlite(&[
        "CREATE TABLE l (code TEXT COLLATE NOCASE PRIMARY KEY, v INTEGER)",
        "CREATE TABLE r (code TEXT COLLATE NOCASE PRIMARY KEY, v INTEGER)",
        "INSERT INTO l VALUES ('a',1),('B',2)",
        "INSERT INTO r VALUES ('a',1),('B',2)",
    ])
    .await;

    let err = run(&a, &req(&["code"], &["v"])).await.res.unwrap_err().to_string();

    assert!(err.contains("did not return rows in key order"), "{err}");
}

#[tokio::test]
async fn a_filter_applies_to_both_sides_and_its_error_names_the_side() {
    let a = sqlite(&[
        TABLES[0],
        TABLES[1],
        "INSERT INTO l VALUES (1,'a',1),(2,'b',2),(3,'c',3)",
        "INSERT INTO r VALUES (1,'x',1),(2,'b',2)",
    ])
    .await;

    let mut filtered = req(&["id"], &["name"]);
    filtered.filter = Some("id >= 2 -- a note".into());
    let s = run(&a, &filtered).await.res.unwrap();
    assert_eq!((s.counts.identical, s.counts.left_only, s.counts.changed), (1, 1, 0));

    let mut broken = req(&["id"], &["name"]);
    broken.filter = Some("no_such_column = 1".into());
    let err = run(&a, &broken).await.res.unwrap_err().to_string();
    assert!(err.starts_with("Left side:") && err.contains("no_such_column"), "{err}");
}

#[tokio::test]
async fn a_filter_cannot_write() {
    let a = sqlite(&[TABLES[0], TABLES[1], "INSERT INTO l VALUES (1,'a',1)"]).await;

    let mut sneaky = req(&["id"], &["name"]);
    sneaky.filter = Some("1) ; DELETE FROM l; SELECT (1".into());
    let _ = run(&a, &sneaky).await;

    let left = a.run_sql("SELECT count(*) FROM l", None).await.unwrap();
    assert_eq!(left.rows[0][0].as_deref(), Some("1"));
}

#[tokio::test]
async fn pages_resume_after_the_last_key_shown() {
    let a = sqlite(&[
        TABLES[0],
        TABLES[1],
        "WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v + 1 FROM n WHERE v < 10) INSERT INTO l SELECT v, 'n', v FROM n",
    ])
    .await;

    let mut first = req(&["id"], &["name"]);
    first.page_size = 4;
    let ran = run(&a, &first).await;
    let s = ran.res.unwrap();
    assert_eq!(ran.rows.len(), 4);
    assert_eq!(s.total_diffs, Some(10));
    assert_eq!(s.counts.left_only, 10);
    assert_eq!(s.next_key, Some(vec![KeyVal::Int("4".into())]));
    assert!(ran.chunks.iter().any(|c| matches!(c, CompareChunk::PageFull { last_key } if last_key == &vec![KeyVal::Int("4".into())])));

    let mut second = req(&["id"], &["name"]);
    second.page_size = 4;
    second.count_all = false;
    second.after_key = s.next_key;
    let ran = run(&a, &second).await;
    let s = ran.res.unwrap();
    assert_eq!(keys_of(&ran.rows).iter().map(|k| k.1.as_str()).collect::<Vec<_>>(), ["5", "6", "7", "8"]);
    assert_eq!(s.total_diffs, None);
    assert_eq!(s.next_key, Some(vec![KeyVal::Int("8".into())]));

    let mut last = req(&["id"], &["name"]);
    last.page_size = 4;
    last.count_all = false;
    last.after_key = s.next_key;
    let ran = run(&a, &last).await;
    assert_eq!(ran.rows.len(), 2);
    assert_eq!(ran.res.unwrap().next_key, None);
}

#[tokio::test]
async fn a_page_that_ends_exactly_on_the_last_difference_has_no_next_page() {
    let a = sqlite(&[TABLES[0], TABLES[1], "INSERT INTO l VALUES (1,'a',1),(2,'b',2)"]).await;

    let mut exact = req(&["id"], &["name"]);
    exact.page_size = 2;
    let s = run(&a, &exact).await.res.unwrap();

    assert_eq!(s.total_diffs, Some(2));
    assert_eq!(s.next_key, None);
}

#[tokio::test]
async fn a_composite_key_orders_and_resumes_on_every_column() {
    let a = sqlite(&[
        "CREATE TABLE l (a INTEGER, b TEXT, v INTEGER, PRIMARY KEY (a, b))",
        "CREATE TABLE r (a INTEGER, b TEXT, v INTEGER, PRIMARY KEY (a, b))",
        "INSERT INTO l VALUES (1,'x',1),(1,'y',2),(2,'x',3)",
        "INSERT INTO r VALUES (1,'x',1),(1,'y',9),(2,'a',3)",
    ])
    .await;

    let ran = run(&a, &req(&["a", "b"], &["v"])).await;
    assert_eq!(
        keys_of(&ran.rows),
        vec![
            (DiffKind::Changed, "1,y".into()),
            (DiffKind::RightOnly, "2,a".into()),
            (DiffKind::LeftOnly, "2,x".into()),
        ]
    );

    let mut resumed = req(&["a", "b"], &["v"]);
    resumed.after_key = Some(vec![KeyVal::Int("1".into()), KeyVal::Text("y".into())]);
    let ran = run(&a, &resumed).await;
    assert_eq!(ran.rows.len(), 2);
}

#[tokio::test]
async fn a_stopped_run_reports_stopped_not_an_error() {
    let a = sqlite(&[TABLES[0], TABLES[1], "INSERT INTO l VALUES (1,'a',1)"]).await;
    let stopped = req(&["id"], &["name"]);
    // Stop lands before the run starts: it must still end as stopped.
    crate::db::cancel_run("conn-test", &stopped.run_id).await;

    let s = run(&a, &stopped).await.res.unwrap();

    assert_eq!(s.status, CompareStatus::Stopped);
    assert_eq!(s.total_diffs, None);
}

#[tokio::test]
async fn a_table_compared_with_itself_has_no_differences() {
    let a = sqlite(&[TABLES[0], TABLES[1], "INSERT INTO l VALUES (1,'a',1),(2,'b',2)"]).await;
    let mut same = req(&["id"], &["name", "qty"]);
    same.right = side("l");

    let ran = run(&a, &same).await;

    assert!(ran.rows.is_empty());
    assert_eq!(ran.res.unwrap().counts.identical, 2);
}

#[tokio::test]
async fn batches_are_sent_as_the_scan_goes() {
    let a = sqlite(&[
        TABLES[0],
        TABLES[1],
        "WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v + 1 FROM n WHERE v < 1200) INSERT INTO l SELECT v, 'n', v FROM n",
    ])
    .await;

    let ran = run(&a, &req(&["id"], &["name"])).await;

    let batches = ran.chunks.iter().filter(|c| matches!(c, CompareChunk::Rows { .. })).count();
    assert!(batches >= 3, "{batches} batch(es)");
    assert_eq!(ran.rows.len(), 1200);
}

#[tokio::test]
async fn stopping_mid_run_keeps_the_rows_found_and_the_rows_read() {
    let a = sqlite(&[
        TABLES[0],
        TABLES[1],
        "WITH RECURSIVE n(v) AS (SELECT 1 UNION ALL SELECT v + 1 FROM n WHERE v < 200000) INSERT INTO l SELECT v, 'n', v FROM n",
    ])
    .await;
    let r = req(&["id"], &["name"]);
    let run_id = r.run_id.clone();
    let mut rows = 0usize;
    let mut asked = false;
    let mut sink = |c: CompareChunk| {
        if let CompareChunk::Rows { rows: batch } = c {
            rows += batch.len();
            if !asked {
                asked = true;
                let id = run_id.clone();
                tokio::spawn(async move { crate::db::cancel_run("conn-test", &id).await });
            }
        }
        Ok(())
    };

    let s = compare_data_on(&a, &a, "conn-test", &r, &mut sink).await.unwrap();

    assert_eq!(s.status, CompareStatus::Stopped);
    assert!(rows > 0 && rows < 200_000, "{rows} rows");
    assert_eq!(s.counts.left_only as usize, rows);
    assert!(s.rows_read.left >= rows as u64 && s.rows_read.left < 200_000);
}

async fn to_text(a: &SqliteAdapter, r: &CompareDataRequest, kind: crate::api::CompareFileKind) -> (String, u64) {
    let mut out = Vec::new();
    let s = compare_to_writer_on(a, a, "conn-test", r, kind, &mut out).await.unwrap();
    assert_eq!(s.status, CompareStatus::Done);
    (String::from_utf8(out).unwrap(), s.rows_written)
}

#[tokio::test]
async fn the_sync_script_makes_a_rerun_show_no_differences() {
    let a = sqlite(&[
        "CREATE TABLE l (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER, b BLOB)",
        "CREATE TABLE r (id INTEGER PRIMARY KEY, name TEXT, qty INTEGER, b BLOB)",
        "INSERT INTO l VALUES (1,'a',1,X'00'),(2,'it''s',2,NULL),(3,'c',NULL,X'ff'),(4,'d',4,NULL)",
        "INSERT INTO r VALUES (1,'a',1,X'00'),(2,'b',2,NULL),(3,'c',3,X'ff'),(9,'z',9,NULL)",
    ])
    .await;
    let r = req(&["id"], &["name", "qty", "b"]);

    let (script, written) = to_text(&a, &r, crate::api::CompareFileKind::SyncScript).await;
    assert_eq!(written, 4);
    assert!(script.contains("UPDATE \"r\" SET \"name\" = 'it''s' WHERE \"id\" = 2;"), "{script}");
    a.run_sql(&script, None).await.unwrap();

    let s = run(&a, &r).await.res.unwrap();
    assert_eq!(s.counts.differences(), 0);
    assert_eq!(s.counts.identical, 4);
}

#[tokio::test]
async fn an_export_holds_every_difference_past_one_page() {
    let a = sqlite(&[
        TABLES[0],
        TABLES[1],
        "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 300) \
         INSERT INTO l SELECT i, 'x', i FROM n",
    ])
    .await;
    let mut r = req(&["id"], &["name", "qty"]);
    r.page_size = 10;

    let (csv, written) = to_text(&a, &r, crate::api::CompareFileKind::Csv).await;
    assert_eq!(written, 300);
    assert_eq!(csv.lines().count(), 301);
    let (json, _) = to_text(&a, &r, crate::api::CompareFileKind::Json).await;
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v.as_array().unwrap().len(), 300);
}
