use sqlx::{Connection as _, PgConnection, PgPool, Postgres};
use sqlx::pool::PoolConnection;
use sqlx::postgres::PgConnectOptions;
use std::time::Instant;
use crate::api::QueryResult;
use crate::db::runs::Canceller;
use crate::db::{DbError, DbResult, RunHandle};
use super::PgAdapter;
use super::sql_text::{dollar_placeholders, is_select_statement};
use super::exec::{exec_statement, run_in_schema_tx};

impl PgAdapter {
    /// The editor's Run for a stoppable run (spec 0006). Takes a dedicated
    /// pooled connection for the whole run so there is a backend to cancel,
    /// records that backend's pid, and lets Stop reach it through a separate
    /// short lived connection running `pg_cancel_backend`.
    pub(super) async fn run_sql_cancellable(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        sql: &str,
        run: &RunHandle,
    ) -> DbResult<QueryResult> {
        let pool = self.pool_for(database).await?;
        let start = Instant::now();
        let converted = dollar_placeholders(sql);
        let trimmed = converted.trim();
        let is_select = is_select_statement(trimmed);

        let mut conn = RunConn::acquire(&pool).await?;
        let armed = self.arm_stop(&mut conn, database, run).await?;

        let ran = if !armed {
            // Stop already arrived: never start the statement.
            Err(DbError::Cancelled)
        } else if let Some(schema) = schema {
            // Same transaction local search_path as `run_sql`'s schema path.
            run_in_schema_tx(&mut conn, schema, trimmed, is_select, start, run).await
        } else {
            exec_statement(&mut conn, trimmed, is_select, start, run).await
        };

        // Unregister BEFORE the connection returns to the pool, so a late
        // cancel can never hit a later query that reused this backend.
        run.finish().await;
        conn.release(conn_reusable(&ran));
        ran
    }

    /// Records the backend's pid and arms Stop for `run` on `conn`. `false`
    /// means Stop already arrived, so the caller must not start its statement.
    pub(super) async fn arm_stop(
        &self,
        conn: &mut PgConnection,
        database: Option<&str>,
        run: &RunHandle,
    ) -> DbResult<bool> {
        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *conn)
            .await
            .map_err(DbError::SqlEngine)?;
        let cancel_options = self.connect_options_for(self.resolve_database(database));
        Ok(run.set_canceller(pg_canceller(cancel_options, pid)).await)
    }
}

/// SQLSTATE `query_canceled`: what `pg_cancel_backend` produces. A
/// `statement_timeout` raises it too, which is why it only counts as Stopped
/// when the user asked (see [`pg_run_error`]).
const PG_QUERY_CANCELED: &str = "57014";

/// How long one cancel attempt may take to connect and run
/// `pg_cancel_backend` before it gives up (the run's 3 second confirm cap
/// then frees the tab anyway, e.g. when the server is at its connection
/// limit).
const PG_CANCEL_ATTEMPT_CAP: std::time::Duration = std::time::Duration::from_millis(1500);

/// The registry re-fires a canceller every 200ms; each Postgres attempt costs
/// a whole connection, so attempts are spread at least this far apart.
const PG_CANCEL_MIN_GAP: std::time::Duration = std::time::Duration::from_secs(1);

/// An engine error becomes `Cancelled` only for `query_canceled` AND when the
/// user asked to stop this run. A `statement_timeout` (same SQLSTATE) or any
/// other error stays the error it is (AC-13).
pub(super) fn pg_run_error(e: sqlx::Error, run: &RunHandle) -> DbError {
    let canceled = e
        .as_database_error()
        .and_then(|d| d.code())
        .is_some_and(|c| c == PG_QUERY_CANCELED);
    if canceled && run.is_cancel_requested() {
        DbError::Cancelled
    } else {
        DbError::SqlEngine(e)
    }
}

/// Builds the run's canceller: a new connection (never from the pool) that
/// asks the server to cancel backend `pid`'s current query.
fn pg_canceller(options: PgConnectOptions, pid: i32) -> Canceller {
    let last_attempt = std::sync::Mutex::new(None::<Instant>);
    Box::new(move || {
        {
            let mut last = last_attempt.lock().unwrap();
            if last.is_some_and(|at| at.elapsed() < PG_CANCEL_MIN_GAP) {
                return Box::pin(std::future::ready(()));
            }
            *last = Some(Instant::now());
        }
        let options = options.clone();
        Box::pin(async move {
            let sent = tokio::time::timeout(PG_CANCEL_ATTEMPT_CAP, async {
                let mut conn = PgConnection::connect_with(&options).await?;
                sqlx::query("SELECT pg_cancel_backend($1)")
                    .bind(pid)
                    .execute(&mut conn)
                    .await?;
                let _ = conn.close().await;
                Ok::<(), sqlx::Error>(())
            })
            .await;
            match sent {
                Ok(Ok(())) => {}
                Ok(Err(e)) => log::warn!("postgres cancel attempt failed: {e}"),
                Err(_) => log::warn!("postgres cancel attempt timed out"),
            }
        })
    })
}

/// A run's dedicated pool connection. If the run is dropped mid query (the
/// 3 second abandon), the connection is detached from the pool instead of
/// being handed back still busy, so it is never reused dirty.
pub(super) struct RunConn {
    conn: Option<PoolConnection<Postgres>>,
    dirty: bool,
}

impl RunConn {
    pub(super) async fn acquire(pool: &PgPool) -> DbResult<Self> {
        let conn = pool.acquire().await.map_err(DbError::SqlEngine)?;
        Ok(Self { conn: Some(conn), dirty: true })
    }

    /// The run ended normally: hand the connection back to the pool, or (if
    /// `reusable` is false, e.g. a broken socket) detach it.
    pub(super) fn release(&mut self, reusable: bool) {
        self.dirty = !reusable;
    }
}

impl std::ops::Deref for RunConn {
    type Target = PgConnection;
    fn deref(&self) -> &PgConnection {
        self.conn.as_ref().expect("connection present until drop")
    }
}

impl std::ops::DerefMut for RunConn {
    fn deref_mut(&mut self) -> &mut PgConnection {
        self.conn.as_mut().expect("connection present until drop")
    }
}

impl Drop for RunConn {
    fn drop(&mut self) {
        if self.dirty {
            if let Some(conn) = self.conn.take() {
                drop(conn.detach());
            }
        }
    }
}

/// Whether a run's connection is safe to hand back to the pool: the server
/// answered (a result, an SQL error, or our own cancel). Anything else (a
/// broken socket, a protocol error) is detached instead.
pub(super) fn conn_reusable<T>(res: &DbResult<T>) -> bool {
    match res {
        Ok(_) | Err(DbError::Cancelled) => true,
        Err(DbError::SqlEngine(sqlx::Error::Database(_))) => true,
        Err(_) => false,
    }
}

/// Stop a running query (spec 0006): the pure decisions, no server needed.
#[cfg(test)]
mod run_error_tests {
    use super::*;
    use std::borrow::Cow;
    use std::fmt;

    /// A server error with a chosen SQLSTATE, standing in for what Postgres
    /// sends back.
    #[derive(Debug)]
    struct FakePgError {
        code: &'static str,
    }

    impl fmt::Display for FakePgError {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "fake postgres error {}", self.code)
        }
    }

    impl std::error::Error for FakePgError {}

    impl sqlx::error::DatabaseError for FakePgError {
        fn message(&self) -> &str {
            "fake postgres error"
        }
        fn code(&self) -> Option<Cow<'_, str>> {
            Some(Cow::Borrowed(self.code))
        }
        fn as_error(&self) -> &(dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn as_error_mut(&mut self) -> &mut (dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn into_error(self: Box<Self>) -> Box<dyn std::error::Error + Send + Sync + 'static> {
            self
        }
        fn kind(&self) -> sqlx::error::ErrorKind {
            sqlx::error::ErrorKind::Other
        }
    }

    fn server_error(code: &'static str) -> sqlx::Error {
        sqlx::Error::Database(Box::new(FakePgError { code }))
    }

    fn run(id: &str) -> RunHandle {
        super::super::runs::register("t-pg-unit", id)
    }

    async fn stop_requested_run(id: &str) -> RunHandle {
        // Stop for this id arrives first, so the run starts flagged.
        super::super::runs::cancel("t-pg-unit", id).await;
        run(id)
    }

    #[tokio::test]
    async fn query_canceled_after_stop_is_stopped() {
        let run = stop_requested_run("pg-unit-asked").await;

        let mapped = pg_run_error(server_error("57014"), &run);

        assert!(matches!(mapped, DbError::Cancelled), "got {mapped:?}");
        run.finish().await;
    }

    /// AC-13: a `statement_timeout` raises the same SQLSTATE, and must stay
    /// the error it is when nobody pressed Stop.
    #[tokio::test]
    async fn query_canceled_nobody_asked_for_stays_an_error() {
        let run = run("pg-unit-timeout");

        let mapped = pg_run_error(server_error("57014"), &run);

        assert!(matches!(mapped, DbError::SqlEngine(_)), "got {mapped:?}");
        run.finish().await;
    }

    #[tokio::test]
    async fn other_server_errors_stay_errors_even_after_stop() {
        let run = stop_requested_run("pg-unit-other").await;

        // 23505 unique_violation, 42P01 undefined_table.
        for code in ["23505", "42P01"] {
            let mapped = pg_run_error(server_error(code), &run);
            assert!(matches!(mapped, DbError::SqlEngine(_)), "{code}: {mapped:?}");
        }
        run.finish().await;
    }

    #[tokio::test]
    async fn a_non_server_error_stays_an_error_even_after_stop() {
        let run = stop_requested_run("pg-unit-io").await;

        let mapped = pg_run_error(sqlx::Error::PoolTimedOut, &run);

        assert!(matches!(mapped, DbError::SqlEngine(_)), "got {mapped:?}");
        run.finish().await;
    }

    #[test]
    fn a_connection_the_server_answered_on_goes_back_to_the_pool() {
        assert!(conn_reusable(&Ok::<_, DbError>(1)));
        assert!(conn_reusable::<()>(&Err(DbError::Cancelled)));
        assert!(conn_reusable::<()>(&Err(DbError::SqlEngine(server_error("42601")))));
    }

    /// A broken socket or a timeout may leave the connection mid query, so it
    /// is detached instead of reused dirty.
    #[test]
    fn a_connection_that_broke_is_not_reused() {
        assert!(!conn_reusable::<()>(&Err(DbError::SqlEngine(sqlx::Error::PoolTimedOut))));
        assert!(!conn_reusable::<()>(&Err(DbError::SqlEngine(sqlx::Error::Io(
            std::io::Error::other("connection reset")
        )))));
        assert!(!conn_reusable::<()>(&Err(DbError::InvalidOperation("x".into()))));
    }

    #[test]
    fn select_and_with_read_rows_and_everything_else_does_not() {
        assert!(is_select_statement("select 1"));
        assert!(is_select_statement("SELECT\n1"));
        assert!(is_select_statement("with c as (select 1) select * from c"));
        assert!(is_select_statement("select\t1"));

        assert!(!is_select_statement("update t set a = 1"));
        assert!(!is_select_statement("insert into t values (1)"));
        assert!(!is_select_statement("delete from t"));
        assert!(!is_select_statement("create table t (a int)"));
        assert!(!is_select_statement(""));
    }
}

/// Stop a running query (spec 0006) against a real server. All `#[ignore]`d:
/// run with `cargo test -p dh-core -- --ignored pg_stop` against the throwaway
/// instance the server tests use (`DH_TEST_DATABASE_URL`, default
/// `postgres://postgres@127.0.0.1:5544/dh_server_test`).
#[cfg(test)]
mod stop_tests {
    use super::*;
    use crate::db::postgres::params::PgParams;
    use crate::api::QueryChunk;
    use crate::db::runs;
    use std::time::Duration;

    const LIVE: &str = "requires a live Postgres test database, see server::store::test_pg_url";

    fn params(pool_max: u32) -> PgParams {
        let url = std::env::var("DH_TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgres://postgres@127.0.0.1:5544/dh_server_test".to_string());
        let rest = url.strip_prefix("postgres://").expect("a postgres:// url");
        let (auth, tail) = rest.split_once('@').expect("user@host in the url");
        let (user, password) = auth.split_once(':').unwrap_or((auth, ""));
        let (hostport, database) = tail.split_once('/').expect("/database in the url");
        let (host, port) = hostport.split_once(':').unwrap_or((hostport, "5432"));
        serde_json::from_value(serde_json::json!({
            "host": host, "port": port.parse::<u16>().unwrap(), "user": user,
            "password": password, "database": database, "ssl_mode": "disable",
            "pool_max": pool_max,
        }))
        .unwrap()
    }

    fn tag() -> String {
        format!("dh-stop-{}", uuid::Uuid::new_v4().simple())
    }

    fn sink() -> impl FnMut(QueryChunk) -> DbResult<()> + Send {
        |_chunk: QueryChunk| Ok(())
    }

    /// Cancel `run_id` after `after_ms`, on its own task.
    fn stop_later(conn: &str, run_id: &str, after_ms: u64) -> tokio::task::JoinHandle<runs::CancelOutcome> {
        let (conn, run_id) = (conn.to_string(), run_id.to_string());
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(after_ms)).await;
            runs::cancel(&conn, &run_id).await
        })
    }

    /// AC-1, AC-2, AC-4: Stop ends the query on the SERVER, and the very next
    /// query runs.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_stop_cancels_the_query_on_the_server() {
        let _ = LIVE;
        let a = PgAdapter::connect(&params(4)).await.unwrap();
        let t = tag();
        let run_id = format!("run-{t}");
        let run = runs::register("t-pg", &run_id);
        let stopper = stop_later("t-pg", &run_id, 400);

        let started = Instant::now();
        let mut on_batch = sink();
        let res = a
            .run_sql_stream(None, None, &format!("SELECT pg_sleep(60) /* {t} */"), Some(&run), &mut on_batch)
            .await;
        run.finish().await;
        assert!(matches!(res, Err(DbError::Cancelled)), "got {res:?}");
        assert!(started.elapsed() < Duration::from_secs(3), "cancel should land fast");
        assert_eq!(stopper.await.unwrap().state, runs::CancelState::Stopped);

        // Gone from pg_stat_activity, not merely ignored by the app.
        let still: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pg_stat_activity WHERE state = 'active' AND query LIKE $1 AND pid <> pg_backend_pid()",
        )
        .bind(format!("%{t}%"))
        .fetch_one(&a.pool)
        .await
        .unwrap();
        assert_eq!(still, 0);

        // The connection is back: the next query runs right away.
        let r = a.run_sql(None, None, "SELECT 1").await.unwrap();
        assert_eq!(r.rows, vec![vec![Some("1".to_string())]]);
    }

    /// AC-8: a stopped write leaves no partial change, with and without a
    /// target schema (the two run paths).
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_stop_rolls_back_a_stopped_write() {
        let a = PgAdapter::connect(&params(4)).await.unwrap();
        let table = format!("dh_stop_{}", uuid::Uuid::new_v4().simple());
        a.run_sql(None, None, &format!("CREATE TABLE public.{table} (a int)")).await.unwrap();
        a.run_sql(None, None, &format!("INSERT INTO public.{table} VALUES (7)")).await.unwrap();

        for (i, schema) in [None, Some("public")].into_iter().enumerate() {
            let run_id = format!("run-{table}-{i}");
            let run = runs::register("t-pg", &run_id);
            let stopper = stop_later("t-pg", &run_id, 400);
            let mut on_batch = sink();
            let res = a
                .run_sql_stream(
                    None,
                    schema,
                    &format!("UPDATE public.{table} SET a = (SELECT 9 FROM pg_sleep(60))"),
                    Some(&run),
                    &mut on_batch,
                )
                .await;
            run.finish().await;
            assert!(matches!(res, Err(DbError::Cancelled)), "schema {schema:?}: got {res:?}");
            stopper.await.unwrap();
            let r = a.run_sql(None, None, &format!("SELECT a FROM public.{table}")).await.unwrap();
            assert_eq!(r.rows, vec![vec![Some("7".to_string())]], "schema {schema:?}");
        }
        a.run_sql(None, None, &format!("DROP TABLE public.{table}")).await.unwrap();
    }

    /// AC-13: `statement_timeout` raises the same SQLSTATE as a cancel, and
    /// must still read as an error when nobody pressed Stop.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_stop_leaves_a_statement_timeout_as_an_error() {
        // One connection, so the session setting reaches the run's query.
        let a = PgAdapter::connect(&params(1)).await.unwrap();
        a.run_sql(None, None, "SET statement_timeout = 300").await.unwrap();
        let run = runs::register("t-pg", "run-pg-timeout");
        let mut on_batch = sink();
        let res = a.run_sql_stream(None, None, "SELECT pg_sleep(5)", Some(&run), &mut on_batch).await;
        run.finish().await;
        a.run_sql(None, None, "SET statement_timeout = 0").await.unwrap();
        match res {
            Err(DbError::SqlEngine(e)) => assert!(e.to_string().contains("statement timeout"), "{e}"),
            other => panic!("expected an ordinary error, got {other:?}"),
        }
    }

    /// A Stop that arrives before the command does: the statement never runs.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_stop_before_start_never_runs() {
        let a = PgAdapter::connect(&params(4)).await.unwrap();
        runs::cancel("t-pg", "run-pg-early").await;
        let run = runs::register("t-pg", "run-pg-early");
        let mut on_batch = sink();
        let started = Instant::now();
        let res = a.run_sql_stream(None, None, "SELECT pg_sleep(30)", Some(&run), &mut on_batch).await;
        run.finish().await;
        assert!(matches!(res, Err(DbError::Cancelled)), "got {res:?}");
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    /// The abandon rule: a run dropped mid query gives its connection up
    /// instead of returning it busy. With a pool of ONE, a connection handed
    /// back dirty would stall the next query behind the 30 second sleep.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_abandoned_run_detaches_its_connection() {
        let a = PgAdapter::connect(&params(1)).await.unwrap();
        {
            let mut conn = RunConn::acquire(&a.pool).await.unwrap();
            let busy = sqlx::query("SELECT pg_sleep(30)").execute(&mut *conn);
            // Dropped mid query, exactly like the 3 second abandon does.
            assert!(tokio::time::timeout(Duration::from_millis(300), busy).await.is_err());
        }
        let next = tokio::time::timeout(Duration::from_secs(5), a.run_sql(None, None, "SELECT 1"))
            .await
            .expect("the pool must hand out a fresh connection, not the busy one")
            .unwrap();
        assert_eq!(next.rows, vec![vec![Some("1".to_string())]]);
    }
    /// Explain Analyze runs the write for real and always rolls it back, also
    /// when it is stopped mid way, and no session is left in a transaction.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_explain_analyze_rolls_back_a_write_and_a_stopped_one() {
        let a = PgAdapter::connect(&params(4)).await.unwrap();
        let table = format!("dh_explain_{}", uuid::Uuid::new_v4().simple());
        a.run_sql(None, None, &format!("CREATE TABLE public.{table} (a int)")).await.unwrap();
        a.run_sql(None, None, &format!("INSERT INTO public.{table} VALUES (7)")).await.unwrap();

        let plan = a
            .explain_sql(None, None, &format!("UPDATE public.{table} SET a = 9"), true, None)
            .await;
        assert!(plan.error.is_none() && plan.root.is_some(), "{plan:?}");
        assert_eq!(plan.root.as_ref().unwrap().actual_rows, Some(1.0));

        let run = runs::register("t-pg", "run-explain-stop");
        let stopper = stop_later("t-pg", "run-explain-stop", 400);
        let started = Instant::now();
        let plan = a
            .explain_sql(
                None,
                None,
                &format!("UPDATE public.{table} SET a = (SELECT 9 FROM pg_sleep(60))"),
                true,
                Some(&run),
            )
            .await;
        run.finish().await;
        stopper.await.unwrap();
        assert!(plan.cancelled, "{plan:?}");
        assert!(started.elapsed() < Duration::from_secs(3));

        let r = a.run_sql(None, None, &format!("SELECT a FROM public.{table}")).await.unwrap();
        assert_eq!(r.rows, vec![vec![Some("7".to_string())]]);
        let idle: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction' AND pid <> pg_backend_pid()",
        )
        .fetch_one(&a.pool)
        .await
        .unwrap();
        assert_eq!(idle, 0);
        a.run_sql(None, None, &format!("DROP TABLE public.{table}")).await.unwrap();
    }
}
