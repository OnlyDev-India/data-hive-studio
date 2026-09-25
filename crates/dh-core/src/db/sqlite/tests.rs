use super::*;
use crate::db::sqlite::interrupt::{InterruptHandle, run_error};
use std::time::Instant;
use crate::api::{QueryChunk, QueryOp, SchemaOp};

async fn test_adapter() -> SqliteAdapter {
    let dir = std::env::temp_dir().join("dh-studio-tests");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(format!("test-{}.db", uuid::Uuid::new_v4()));
    SqliteAdapter::connect(path).await.unwrap()
}

async fn index_exists(adapter: &SqliteAdapter, name: &str) -> bool {
    let rows: Vec<(String,)> =
        sqlx::query_as("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
            .bind(name)
            .fetch_all(&adapter.pool)
            .await
            .unwrap();
    !rows.is_empty()
}

/// The exact scenario that motivated the transaction: an index edit is a
/// DROP + CREATE pair. Realistic failure path — unique was toggled OFF
/// (batch 1 succeeded), duplicate rows snuck in while enforcement was
/// off, then toggling unique back ON fails on the UNIQUE violation. The
/// rollback must restore the non-unique index instead of leaving none.
#[tokio::test]
async fn failed_batch_rolls_back_drop_index() {
    let adapter = test_adapter().await;
    sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT)")
        .execute(&adapter.pool)
        .await
        .unwrap();
    sqlx::query("CREATE UNIQUE INDEX ux_email ON t (email)")
        .execute(&adapter.pool)
        .await
        .unwrap();

    // Batch 1 — toggle unique OFF: drop + recreate as a plain index.
    let batch1 = vec![
        SchemaOp::DropIndex { table: None, index: "ux_email".into() },
        SchemaOp::CreateIndex {
            table: "t".into(),
            name: "ux_email".into(),
            columns: vec!["email".into()],
            unique: false,
            column_dirs: None,
            sparse: None,
            ttl_seconds: None,
            partial_filter: None,
        },
    ];
    adapter.apply_schema_ops_batch(&batch1).await.unwrap();

    // With uniqueness no longer enforced, duplicate emails sneak in.
    sqlx::query("INSERT INTO t (email) VALUES ('a@x.dev'), ('a@x.dev')")
        .execute(&adapter.pool)
        .await
        .unwrap();

    // Batch 2 — toggle unique back ON: the CREATE hits the duplicates…
    let batch2 = vec![
        SchemaOp::DropIndex { table: None, index: "ux_email".into() },
        SchemaOp::CreateIndex {
            table: "t".into(),
            name: "ux_email".into(),
            columns: vec!["email".into()],
            unique: true,
            column_dirs: None,
            sparse: None,
            ttl_seconds: None,
            partial_filter: None,
        },
    ];
    let result = adapter.apply_schema_ops_batch(&batch2).await;
    assert!(result.is_err(), "batch should fail on the UNIQUE violation");
    // …so the DROP rolls back and the index survives, still non-unique.
    assert!(
        index_exists(&adapter, "ux_email").await,
        "DROP INDEX must be rolled back when the paired CREATE fails"
    );
    let sql: Vec<(Option<String>,)> = sqlx::query_as(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='ux_email'",
    )
    .fetch_all(&adapter.pool)
    .await
    .unwrap();
    let ddl = sql[0].0.as_deref().unwrap_or_default();
    assert!(
        !ddl.contains("UNIQUE"),
        "rolled-back index must be the pre-batch NON-unique one: {ddl}"
    );
}

/// A typo'd column in CreateIndex must fail loudly instead of SQLite's
/// double-quoted-string fallback silently creating an expression index.
#[tokio::test]
async fn create_index_rejects_unknown_column() {
    let adapter = test_adapter().await;
    sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT)")
        .execute(&adapter.pool)
        .await
        .unwrap();
    let ops = vec![SchemaOp::CreateIndex {
        table: "t".into(),
        name: "ix_bad".into(),
        columns: vec!["no_such_column".into()],
        unique: false,
        column_dirs: None,
        sparse: None,
        ttl_seconds: None,
        partial_filter: None,
    }];
    let result = adapter.apply_schema_ops_batch(&ops).await;
    assert!(result.is_err(), "unknown column must be rejected");
    assert!(
        !index_exists(&adapter, "ix_bad").await,
        "no index should exist for an unknown column"
    );
}

/// A fully valid batch commits every statement.
#[tokio::test]
async fn successful_batch_commits() {
    let adapter = test_adapter().await;
    sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT)")
        .execute(&adapter.pool)
        .await
        .unwrap();

    let ops = vec![
        SchemaOp::AddColumn {
            table: "t".into(),
            name: "phone".into(),
            data_type: "TEXT".into(),
            not_null: false,
            default: None,
        },
        SchemaOp::CreateIndex {
            table: "t".into(),
            name: "ix_phone".into(),
            columns: vec!["phone".into()],
            unique: true,
            column_dirs: None,
            sparse: None,
            ttl_seconds: None,
            partial_filter: None,
        },
    ];
    let ran = adapter.apply_schema_ops_batch(&ops).await.unwrap();
    assert_eq!(ran.len(), 2);
    assert!(index_exists(&adapter, "ix_phone").await);
}

/// Nothing from a failing batch leaks — not even earlier DDL like
/// renames or added columns.
#[tokio::test]
async fn failed_batch_rolls_back_ddl_from_earlier_ops() {
    let adapter = test_adapter().await;
    sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT)")
        .execute(&adapter.pool)
        .await
        .unwrap();

    let ops = vec![
        SchemaOp::RenameTable { table: "t".into(), new_name: "t2".into() },
        SchemaOp::DropIndex { table: None, index: "never_existed".into() },
    ];
    assert!(adapter.apply_schema_ops_batch(&ops).await.is_err());
    let tables: Vec<(String,)> =
        sqlx::query_as("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 't%'")
            .fetch_all(&adapter.pool)
            .await
            .unwrap();
    assert_eq!(tables.len(), 1, "only the original table should exist");
    assert_eq!(tables[0].0, "t", "the rename must have been rolled back");
}

/// FK suspension around the batch lets a rebuild-style intermediate state
/// pass, and enforcement is back ON afterwards.
#[tokio::test]
async fn foreign_keys_restored_after_batch() {
    use futures_util::future::BoxFuture;
    let adapter = test_adapter().await;
    let fk_on: BoxFuture<'_, bool> = Box::pin(async {
        let row: (i64,) = sqlx::query_as("PRAGMA foreign_keys")
            .fetch_one(&adapter.pool)
            .await
            .unwrap();
        row.0 == 1
    });
    assert!(fk_on.await, "pool default is foreign_keys = ON");

    sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY)")
        .execute(&adapter.pool)
        .await
        .unwrap();
    adapter.apply_schema_ops_batch(&vec![SchemaOp::RenameTable {
        table: "t".into(),
        new_name: "t2".into(),
    }])
    .await
    .unwrap();

    let row: (i64,) = sqlx::query_as("PRAGMA foreign_keys")
        .fetch_one(&adapter.pool)
        .await
        .unwrap();
    assert_eq!(row.0, 1, "FK enforcement must be restored after the batch");
}

#[tokio::test]
async fn bulk_update_writes_every_matching_row() {
    let adapter = test_adapter().await;
    sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, status TEXT)")
        .execute(&adapter.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO t (status) VALUES ('pending'), ('pending'), ('done')")
        .execute(&adapter.pool)
        .await
        .unwrap();

    let outcome = adapter
        .execute_op(&QueryOp::BulkUpdate {
            table: "t".into(),
            column: "status".into(),
            value: Some("archived".into()),
            filters: vec![crate::api::GridFilterCond {
                column: "status".into(),
                op: crate::api::FilterOp::Eq,
                value: "pending".into(),
                values: Vec::new(),
                conjunction: None,
            }],
            custom_where: None,
        })
        .await
        .unwrap();
    assert_eq!(outcome.result.rows_affected, 2);

    let rows: Vec<(String,)> = sqlx::query_as("SELECT status FROM t ORDER BY id")
        .fetch_all(&adapter.pool)
        .await
        .unwrap();
    assert_eq!(
        rows.into_iter().map(|(s,)| s).collect::<Vec<_>>(),
        vec!["archived", "archived", "done"]
    );
}

// ---- Stop a running query (spec 0006) ----

/// A statement that spends its whole time in ONE step (an aggregate
/// before the first row), so only a real interrupt can end it early.
const HEAVY_SELECT: &str = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 2000000000) SELECT count(*), sum(x) FROM c";

fn sink() -> impl FnMut(QueryChunk) -> DbResult<()> + Send {
    |_chunk: QueryChunk| Ok(())
}

#[tokio::test]
async fn stop_interrupts_a_heavy_single_step_and_frees_the_connection() {
    let a = test_adapter().await;
    let run = super::super::runs::register("t-sqlite", "run-sqlite-heavy");
    let stopper = tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        super::super::runs::cancel("t-sqlite", "run-sqlite-heavy").await
    });
    let started = Instant::now();
    let mut on_batch = sink();
    let res = a.run_sql_stream(HEAVY_SELECT, Some(&run), &mut on_batch).await;
    assert!(matches!(res, Err(DbError::Cancelled)), "got {res:?}");
    assert!(started.elapsed().as_secs() < 3, "the interrupt should land fast");
    let outcome = stopper.await.unwrap();
    assert_eq!(outcome.state, super::super::runs::CancelState::Stopped);
    // The connection is usable again right away (AC-2).
    let r = a.run_sql("SELECT 1", None).await.unwrap();
    assert_eq!(r.rows, vec![vec![Some("1".to_string())]]);
}

#[tokio::test]
async fn stopped_write_leaves_no_partial_change() {
    let a = test_adapter().await;
    a.run_sql("CREATE TABLE t (a INTEGER)", None).await.unwrap();
    a.run_sql("INSERT INTO t VALUES (7)", None).await.unwrap();
    let run = super::super::runs::register("t-sqlite", "run-sqlite-write");
    let stopper = tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        super::super::runs::cancel("t-sqlite", "run-sqlite-write").await
    });
    let update = format!(
        "UPDATE t SET a = (WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 2000000000) SELECT count(*) FROM c)"
    );
    let res = a.run_sql(&update, Some(&run)).await;
    assert!(matches!(res, Err(DbError::Cancelled)), "got {res:?}");
    stopper.await.unwrap();
    let r = a.run_sql("SELECT a FROM t", None).await.unwrap();
    assert_eq!(r.rows, vec![vec![Some("7".to_string())]]);
}

#[tokio::test]
async fn a_run_cancelled_before_it_starts_never_runs() {
    let a = test_adapter().await;
    // Stop arrives before the command does: it leaves a marker.
    super::super::runs::cancel("t-sqlite", "run-sqlite-early").await;
    let run = super::super::runs::register("t-sqlite", "run-sqlite-early");
    let mut on_batch = sink();
    let res = a.run_sql_stream(HEAVY_SELECT, Some(&run), &mut on_batch).await;
    assert!(matches!(res, Err(DbError::Cancelled)), "got {res:?}");
}

/// A genuine `SQLITE_INTERRUPT` error, raised by interrupting a heavy
/// statement directly on its connection (no run registry involved).
async fn interrupted_error(a: &SqliteAdapter) -> sqlx::Error {
    let mut conn = a.pool.acquire().await.unwrap();
    let handle = InterruptHandle(conn.lock_handle().await.unwrap().as_raw_handle());
    let interrupter = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        handle.interrupt();
    });
    let outcome = sqlx::query(HEAVY_SELECT).fetch_all(&mut *conn).await;
    interrupter.join().unwrap();
    match outcome {
        Ok(_) => panic!("the heavy statement should have been interrupted"),
        Err(e) => e,
    }
}

/// AC-13: an interrupt nobody asked for is an ordinary error; the same
/// interrupt after Stop is `Cancelled`.
#[tokio::test]
async fn interrupt_only_counts_as_stopped_when_stop_was_asked() {
    let a = test_adapter().await;

    let not_asked = super::super::runs::register("t-sqlite", "run-sqlite-not-asked");
    let err = interrupted_error(&a).await;
    assert!(matches!(run_error(err, Some(&not_asked)), DbError::SqlEngine(_)));

    // Stop for this id arrives first (marker), so the run starts flagged.
    super::super::runs::cancel("t-sqlite", "run-sqlite-asked").await;
    let asked = super::super::runs::register("t-sqlite", "run-sqlite-asked");
    let err = interrupted_error(&a).await;
    assert!(matches!(run_error(err, Some(&asked)), DbError::Cancelled));
}

/// The read only lock (spec 0007): a file opens with the read only flag, a temp
/// copy runs with `query_only`, and every write path is refused.
#[cfg(test)]
mod read_only_tests {
    use super::*;
    use crate::api::{QueryOp, SchemaOp};
    use std::sync::Arc;
    use crate::db::DbAdapter;
    use crate::db::READ_ONLY_PREFIX;

    fn ro() -> ConnGuard {
        ConnGuard { read_only: true, ..Default::default() }
    }

    fn scratch_path() -> PathBuf {
        let dir = std::env::temp_dir().join("dh-studio-tests");
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(format!("ro-{}.db", uuid::Uuid::new_v4()))
    }

    /// A writable database with one row, at a real path.
    async fn seeded(path: &PathBuf) -> SqliteAdapter {
        let a = SqliteAdapter::connect(path.clone()).await.unwrap();
        a.run_sql("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)", None).await.unwrap();
        a.run_sql("INSERT INTO t VALUES (1, 'a')", None).await.unwrap();
        a
    }

    /// Close a writable adapter the way the app does: WAL merged and removed,
    /// so the file on its own is the whole database.
    async fn close_writer(a: SqliteAdapter) {
        Arc::new(a).close().await;
    }

    fn is_refusal<T>(res: DbResult<T>) -> bool {
        matches!(&res, Err(DbError::ReadOnly(m)) if m.starts_with(READ_ONLY_PREFIX))
    }

    async fn count(a: &SqliteAdapter) -> String {
        let r = DbAdapter::run_sql(a, None, None, "SELECT count(*) FROM t").await.unwrap();
        r.rows[0][0].clone().unwrap()
    }

    /// AC-1: no guard given means a normal, writable connection.
    #[tokio::test]
    async fn a_connection_opened_without_the_flag_still_writes() {
        let path = scratch_path();
        close_writer(seeded(&path).await).await;
        let a = SqliteAdapter::open_at(&path, &ConnGuard::default()).await.unwrap();
        DbAdapter::run_sql(&a, None, None, "INSERT INTO t VALUES (2, 'b')").await.unwrap();
        assert_eq!(count(&a).await, "2");
    }

    /// AC-2, AC-14: on a file, reads work and a hand typed write is refused
    /// by the check.
    #[tokio::test]
    async fn file_reads_work_and_hand_typed_writes_are_refused() {
        let path = scratch_path();
        close_writer(seeded(&path).await).await;
        let a = SqliteAdapter::open_at(&path, &ro()).await.unwrap();

        let read = DbAdapter::run_sql(&a, None, None, "SELECT v FROM t").await.unwrap();
        assert_eq!(read.rows, vec![vec![Some("a".to_string())]]);
        DbAdapter::run_sql(&a, None, None, "PRAGMA table_info('t')").await.unwrap();
        DbAdapter::run_sql(&a, None, None, "EXPLAIN QUERY PLAN SELECT * FROM t").await.unwrap();

        for sql in ["UPDATE t SET v = 'b'", "INSERT INTO t VALUES (2, 'b')", "DROP TABLE t"] {
            assert!(is_refusal(DbAdapter::run_sql(&a, None, None, sql).await), "{sql}");
        }
        // A script with any refused statement runs none of its statements.
        assert!(is_refusal(
            DbAdapter::run_sql(&a, None, None, "SELECT 1; INSERT INTO t VALUES (3, 'c')").await
        ));
        assert_eq!(count(&a).await, "1");
    }

    /// AC-3: the open flag holds under the check. A write that gets past the
    /// check (it starts with WITH) is refused by the database and comes back
    /// as the typed error; a raw write straight to the pool fails too.
    #[tokio::test]
    async fn the_open_flag_refuses_what_the_check_lets_through() {
        let path = scratch_path();
        close_writer(seeded(&path).await).await;
        let a = SqliteAdapter::open_at(&path, &ro()).await.unwrap();

        let cte = "WITH x AS (SELECT 9, 'z') INSERT INTO t SELECT * FROM x";
        assert!(is_refusal(DbAdapter::run_sql(&a, None, None, cte).await));
        let streamed = DbAdapter::run_sql_stream(&a, None, None, cte, None, &mut |_| Ok(())).await;
        assert!(is_refusal(streamed));

        let raw = sqlx::query("INSERT INTO t VALUES (9, 'z')").execute(&a.pool).await;
        assert!(raw.is_err(), "the file must not be writable at all");
        let off = sqlx::query("PRAGMA query_only = OFF").execute(&a.pool).await;
        let after = sqlx::query("INSERT INTO t VALUES (9, 'z')").execute(&a.pool).await;
        assert!(off.is_err() || after.is_err(), "turning query_only off must not open the file");
        assert_eq!(count(&a).await, "1");
    }

    /// AC-3: the statements that could undo a lock are refused by the check.
    #[tokio::test]
    async fn lock_breakers_are_refused() {
        let path = scratch_path();
        close_writer(seeded(&path).await).await;
        let a = SqliteAdapter::open_at(&path, &ro()).await.unwrap();
        for sql in [
            "PRAGMA query_only = OFF",
            "PRAGMA writable_schema = ON",
            "ATTACH DATABASE ':memory:' AS x",
            "SELECT load_extension('nothing')",
            "BEGIN IMMEDIATE",
            "VACUUM",
        ] {
            assert!(is_refusal(DbAdapter::run_sql(&a, None, None, sql).await), "{sql}");
        }
    }

    /// AC-5: every structured write is refused before it runs.
    #[tokio::test]
    async fn structured_writes_are_refused() {
        let path = scratch_path();
        close_writer(seeded(&path).await).await;
        let a = SqliteAdapter::open_at(&path, &ro()).await.unwrap();

        let delete = QueryOp::Delete {
            table: "t".into(),
            match_row: [("id".to_string(), Some("1".to_string()))].into(),
        };
        let insert = QueryOp::Insert {
            table: "t".into(),
            values: [("id".to_string(), Some("5".to_string()))].into(),
            skip_empty: false,
        };
        let update = QueryOp::Update {
            table: "t".into(),
            set: [("v".to_string(), Some("b".to_string()))].into(),
            match_row: [("id".to_string(), Some("1".to_string()))].into(),
        };
        let bulk = QueryOp::BulkUpdate {
            table: "t".into(),
            column: "v".into(),
            value: Some("b".into()),
            filters: vec![],
            custom_where: None,
        };
        for op in [delete, insert, update, bulk, QueryOp::DropTable { table: "t".into() }] {
            assert!(is_refusal(DbAdapter::execute_op(&a, None, None, &op).await), "{op:?}");
            let streamed = DbAdapter::execute_op_stream(&a, None, None, &op, &mut |_| Ok(())).await;
            assert!(is_refusal(streamed), "{op:?}");
        }
        assert!(is_refusal(
            DbAdapter::execute_params(&a, None, "DELETE FROM t WHERE id = ?", &[Some("1".into())]).await
        ));
        assert!(is_refusal(DbAdapter::duplicate_table(&a, None, None, "t", "t2", true).await));
        let ops = [SchemaOp::DropColumn { table: "t".into(), name: "v".into() }];
        assert!(is_refusal(DbAdapter::apply_schema_ops_batch(&a, None, None, &ops).await));
        assert_eq!(count(&a).await, "1");
    }

    /// AC-14: everything that only reads keeps working.
    #[tokio::test]
    async fn reads_keep_working() {
        let path = scratch_path();
        close_writer(seeded(&path).await).await;
        let a = SqliteAdapter::open_at(&path, &ro()).await.unwrap();

        assert_eq!(a.list_tables().await.unwrap().len(), 1);
        let (schema, _) = a.table_schema("t").await.unwrap();
        assert_eq!(schema.columns.len(), 2);
        let select = QueryOp::Select {
            table: "t".into(),
            filters: vec![],
            custom_where: None,
            order_by: vec![],
            limit: Some(10),
            offset: None,
        };
        let out = DbAdapter::execute_op(&a, None, None, &select).await.unwrap();
        assert_eq!(out.result.rows.len(), 1);
        let count_op = QueryOp::Count { table: "t".into(), filters: vec![], custom_where: None };
        DbAdapter::execute_op(&a, None, None, &count_op).await.unwrap();
        DbAdapter::run_sql_params(&a, None, "SELECT v FROM t WHERE id = ?", &[Some("1".into())])
            .await
            .unwrap();
        DbAdapter::set_active_schema(&a, "main").await.unwrap();
        // Save to bytes still works: the checkpoint is best effort.
        assert!(!a.save_bytes().await.unwrap().is_empty());
    }

    /// A missing file is an error on a read only open, never a new empty
    /// database created behind a lock icon.
    #[tokio::test]
    async fn a_missing_file_is_not_created() {
        let path = scratch_path();
        assert!(SqliteAdapter::open_at(&path, &ro()).await.is_err());
        assert!(!path.exists());
    }

    /// Closing a read only connection leaves another program's WAL alone: it
    /// could not merge it, and deleting it would drop committed rows.
    #[tokio::test]
    async fn closing_a_read_only_file_keeps_its_wal_files() {
        let path = scratch_path();
        let writer = seeded(&path).await; // stays open: its WAL is live
        let a = Arc::new(SqliteAdapter::open_at(&path, &ro()).await.unwrap());
        assert_eq!(count(&a).await, "1");
        let wal = PathBuf::from(format!("{}-wal", path.display()));
        assert!(wal.exists(), "the writer's WAL should exist while it is open");
        a.clone().close().await;
        assert!(wal.exists(), "a read only close must not delete the WAL");
        assert_eq!(count(&writer).await, "1");
    }

    /// A temp copy (bytes) cannot use the open flag, so it runs `query_only`.
    #[tokio::test]
    async fn a_temp_copy_runs_query_only() {
        let path = scratch_path();
        let source = seeded(&path).await;
        let bytes = source.save_bytes().await.unwrap();
        let a = SqliteAdapter::open("ro-copy", Some(&bytes), &ro()).await.unwrap();

        assert_eq!(count(&a).await, "1");
        assert!(is_refusal(DbAdapter::run_sql(&a, None, None, "DELETE FROM t").await));
        let cte = "WITH x AS (SELECT 9, 'z') INSERT INTO t SELECT * FROM x";
        assert!(is_refusal(DbAdapter::run_sql(&a, None, None, cte).await));
        assert!(is_refusal(DbAdapter::run_sql(&a, None, None, "PRAGMA query_only = OFF").await));
        let raw = sqlx::query("INSERT INTO t VALUES (9, 'z')").execute(&a.pool).await;
        assert!(raw.is_err(), "query_only must hold on every pooled connection");
        assert_eq!(count(&a).await, "1");
        Arc::new(a).close().await;
    }
}

/// Explain: a real plan comes back as a tree, and the
/// statement it explains is never run.
#[tokio::test]
async fn explain_returns_a_plan_and_never_runs_the_statement() {
    let adapter = test_adapter().await;
    adapter.run_sql("CREATE TABLE t (a INTEGER, b TEXT)", None).await.unwrap();
    adapter.run_sql("CREATE INDEX t_a ON t (a)", None).await.unwrap();
    adapter.run_sql("INSERT INTO t VALUES (1, 'x')", None).await.unwrap();

    let plan = adapter.explain_sql("SELECT * FROM t WHERE a = 1;", false, None).await;
    assert_eq!(plan.error, None);
    assert_eq!(plan.statement, "SELECT * FROM t WHERE a = 1;");
    let root = plan.root.expect("a plan tree");
    assert_eq!(root.label, "SEARCH");
    assert_eq!(root.target, "t_a on t");
    assert_eq!(root.condition, "a=?");

    let plan = adapter.explain_sql("DELETE FROM t WHERE a = 1", false, None).await;
    assert!(plan.root.is_some(), "{:?}", plan.error);
    let left = adapter.run_sql("SELECT count(*) FROM t", None).await.unwrap();
    assert_eq!(left.rows[0][0].as_deref(), Some("1"), "Explain must not run the DELETE");
}

#[tokio::test]
async fn explain_reports_unsupported_statements_and_database_errors() {
    let adapter = test_adapter().await;
    let plan = adapter.explain_sql("CREATE TABLE t (a)", false, None).await;
    assert!(plan.unsupported.is_some() && plan.root.is_none());
    let plan = adapter.explain_sql("SELECT * FROM missing", false, None).await;
    assert!(plan.error.unwrap().contains("no such table"));
    let plan = adapter.explain_sql("SELECT 1", true, None).await;
    assert!(plan.error.is_some(), "SQLite has no analyze");
}

#[tokio::test]
async fn explain_that_was_stopped_before_it_started_never_touches_the_database() {
    let adapter = test_adapter().await;
    crate::db::runs::cancel("t-sqlite-explain", "explain-early").await;
    let run = crate::db::runs::register("t-sqlite-explain", "explain-early");
    let plan = adapter.explain_sql("SELECT 1", false, Some(&run)).await;
    run.finish().await;
    assert!(plan.cancelled, "{plan:?}");
    assert!(plan.root.is_none() && plan.error.is_none());
}

#[tokio::test]
async fn explain_with_a_run_finishes_it_so_the_id_can_be_reused() {
    let adapter = test_adapter().await;
    let run = crate::db::runs::register("t-sqlite-explain", "explain-normal");
    let plan = adapter.explain_sql("SELECT 1", false, Some(&run)).await;
    assert!(!plan.cancelled && plan.root.is_some(), "{plan:?}");
    run.finish().await;
    let outcome = crate::db::runs::cancel("t-sqlite-explain", "explain-normal").await;
    assert_eq!(outcome.state, crate::db::CancelState::NotRunning);
}
