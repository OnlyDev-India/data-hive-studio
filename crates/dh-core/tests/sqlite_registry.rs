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
    dh_core::db::run_sql(
        &conn_id,
        None,
        None,
        "CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT)",
        "app",
    )
    .await
    .unwrap();

    let tables = dh_core::db::list_tables(&conn_id).await.unwrap();
    assert!(tables.iter().any(|t| t.name == "widgets"));
}

/// Spec 0006 end to end through the public wrapper the Tauri command calls:
/// Stop resolves the run as `cancelled` (not an error), the tab's own rows
/// stay with the caller, the activity log records "Stopped by user", and the
/// connection runs the next query right away.
#[tokio::test]
async fn stopped_editor_run_resolves_cancelled_and_frees_the_connection() {
    let conn_id = temp_sqlite_conn().await;
    let run_id = "run-registry-stop-1";
    let heavy = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 2000000000) SELECT count(*), sum(x) FROM c";

    let stopper = {
        let conn_id = conn_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            dh_core::db::cancel_run(&conn_id, run_id).await
        })
    };
    let res = dh_core::db::run_sql_stream(&conn_id, None, None, heavy, Some(run_id), |_chunk| Ok(()))
        .await
        .expect("a stopped run resolves Ok, not Err");
    assert!(res.cancelled);
    assert!(res.error.is_none());
    assert_eq!(stopper.await.unwrap().state, dh_core::db::CancelState::Stopped);

    let logged = dh_core::activity::snapshot(200)
        .into_iter()
        .find(|e| e.conn_id == conn_id && e.sql.as_deref().is_some_and(|s| s.contains("RECURSIVE")))
        .expect("the stopped run is logged");
    assert!(!logged.ok);
    assert_eq!(logged.error.as_deref(), Some("Stopped by user"));

    // Right away: the same connection answers the next query.
    let next = dh_core::db::run_sql_stream(&conn_id, None, None, "SELECT 1", None, |_chunk| Ok(()))
        .await
        .unwrap();
    assert!(!next.cancelled);
    assert!(next.error.is_none());
}

/// AC-16: Stop pressed after the query already finished changes nothing.
#[tokio::test]
async fn stop_after_the_run_finished_is_harmless() {
    let conn_id = temp_sqlite_conn().await;
    let run_id = "run-registry-late-1";
    let res = dh_core::db::run_sql_stream(&conn_id, None, None, "SELECT 1", Some(run_id), |_chunk| Ok(()))
        .await
        .unwrap();
    assert!(!res.cancelled);
    let outcome = dh_core::db::cancel_run(&conn_id, run_id).await;
    assert_eq!(outcome.state, dh_core::db::CancelState::NotRunning);
}

/// A statement that takes a noticeable moment but finishes on its own, so a
/// Stop aimed somewhere else has time to (wrongly) hit it.
const MEDIUM_SELECT: &str = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 3000000) SELECT count(*) FROM c";
const HEAVY_SELECT: &str = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 2000000000) SELECT count(*), sum(x) FROM c";

/// Stop finds a run by its own id: two runs on one connection, one stopped,
/// the other must carry on and return its real result.
#[tokio::test]
async fn stopping_one_run_leaves_another_run_on_the_same_connection_alone() {
    let conn_id = temp_sqlite_conn().await;

    let doomed = {
        let conn_id = conn_id.clone();
        tokio::spawn(async move {
            dh_core::db::run_sql_stream(&conn_id, None, None, HEAVY_SELECT, Some("run-pair-a"), |_c| Ok(())).await
        })
    };
    let bystander = {
        let conn_id = conn_id.clone();
        tokio::spawn(async move {
            let mut rows = Vec::new();
            let res = dh_core::db::run_sql_stream(&conn_id, None, None, MEDIUM_SELECT, Some("run-pair-b"), |chunk| {
                rows.extend(chunk.rows);
                Ok(())
            })
            .await;
            (res, rows)
        })
    };

    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    let outcome = dh_core::db::cancel_run(&conn_id, "run-pair-a").await;

    let stopped = doomed.await.unwrap().unwrap();
    let (kept, rows) = bystander.await.unwrap();
    let kept = kept.unwrap();
    assert_eq!(outcome.state, dh_core::db::CancelState::Stopped);
    assert!(stopped.cancelled);
    assert!(!kept.cancelled, "the other run was not asked to stop");
    assert!(kept.error.is_none());
    assert_eq!(rows, vec![vec![Some("3000000".to_string())]]);
}

/// A Stop that turns up after its run finished must not reach whatever query
/// the connection runs next.
#[tokio::test]
async fn a_late_stop_for_a_finished_run_does_not_touch_the_next_query() {
    let conn_id = temp_sqlite_conn().await;
    dh_core::db::run_sql_stream(&conn_id, None, None, "SELECT 1", Some("run-late-old"), |_c| Ok(()))
        .await
        .unwrap();

    let next = {
        let conn_id = conn_id.clone();
        tokio::spawn(async move {
            dh_core::db::run_sql_stream(&conn_id, None, None, MEDIUM_SELECT, Some("run-late-next"), |_c| Ok(())).await
        })
    };
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    let outcome = dh_core::db::cancel_run(&conn_id, "run-late-old").await;

    let res = next.await.unwrap().unwrap();
    assert_eq!(outcome.state, dh_core::db::CancelState::NotRunning);
    assert!(!res.cancelled);
    assert!(res.error.is_none());
}

/// A run that the database never got to start (Stop landed first) resolves as
/// stopped and leaves the connection usable.
#[tokio::test]
async fn a_run_stopped_before_it_starts_resolves_cancelled_and_runs_nothing() {
    let conn_id = temp_sqlite_conn().await;
    dh_core::db::run_sql(&conn_id, None, None, "CREATE TABLE audit (n INTEGER)", "app").await.unwrap();

    let early = dh_core::db::cancel_run(&conn_id, "run-early-1").await;
    let res = dh_core::db::run_sql_stream(&conn_id, None, None, HEAVY_SELECT, Some("run-early-1"), |_c| Ok(()))
        .await
        .expect("a stopped run resolves Ok, not Err");

    assert_eq!(early.state, dh_core::db::CancelState::NotRunning);
    assert!(res.cancelled);
    assert!(res.rows.is_empty());
    let next = dh_core::db::run_sql_stream(&conn_id, None, None, "SELECT count(*) FROM audit", None, |_c| Ok(()))
        .await
        .unwrap();
    assert!(!next.cancelled);
}
