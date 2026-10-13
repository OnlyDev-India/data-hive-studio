//! The query builder's read only run: one SELECT in a `READ ONLY`
//! transaction that is always rolled back, whatever the connection's own
//! read only flag. Several may share one run, each with its own canceller.

use sqlx::Connection as _;
use std::time::Instant;
use crate::api::QueryResult;
use crate::db::read_only::Dialect;
use crate::db::sql_builder::TIME_LIMIT_ERROR;
use crate::db::{BatchSink, DbError, DbResult, RunHandle};
use super::PgAdapter;
use super::cancel::{conn_reusable, pg_canceller, RunConn};
use super::exec::null_error;
use super::sql_text::{dollar_placeholders, q};
use super::stream::stream_statement;

/// SQLSTATE `query_canceled`, what a `statement_timeout` raises.
const PG_QUERY_CANCELED: &str = "57014";

impl PgAdapter {
    pub(super) async fn run_read_only(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        sql: &str,
        time_ms: Option<u64>,
        run: Option<&RunHandle>,
        sink: BatchSink<'_>,
    ) -> DbResult<QueryResult> {
        self.guard.check_sql(Dialect::Postgres, sql)?;
        let pool = self.pool_for(database).await?;
        let start = Instant::now();
        let converted = dollar_placeholders(sql);
        let trimmed = converted.trim();

        let mut conn = RunConn::acquire(&pool).await?;
        let armed = match run {
            Some(run) => {
                let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
                    .fetch_one(&mut *conn)
                    .await
                    .map_err(DbError::SqlEngine)?;
                let options = self.connect_options_for(self.resolve_database(database));
                match run.add_canceller(pg_canceller(options, pid)).await {
                    Some(id) => Some((run, id)),
                    None => return Err(DbError::Cancelled),
                }
            }
            None => None,
        };

        let ran = async {
            let mut tx = conn.begin().await.map_err(DbError::SqlEngine)?;
            let mut setup = vec!["SET TRANSACTION READ ONLY".to_string()];
            if let Some(ms) = time_ms {
                setup.push(format!("SET LOCAL statement_timeout = {ms}"));
            }
            if let Some(schema) = schema {
                setup.push(format!("SET LOCAL search_path = {}", q(schema)));
            }
            for s in &setup {
                sqlx::query(s).execute(&mut *tx).await.map_err(DbError::SqlEngine)?;
            }
            let streamed = stream_statement(&mut tx, trimmed, &[], run, sink).await?;
            tx.rollback().await.map_err(DbError::SqlEngine)?;
            Ok(QueryResult {
                columns: streamed.columns,
                rows: vec![],
                rows_affected: 0,
                is_select: true,
                error: null_error(),
                elapsed_ms: start.elapsed().as_millis(),
                cancelled: false,
            })
        }
        .await;

        // Before the connection goes back to the pool, so a late Stop can
        // never cancel a later query on this backend.
        if let Some((run, id)) = armed {
            run.remove_canceller(id).await;
        }
        conn.release(conn_reusable(&ran));
        ran.map_err(|e| time_limit(e, time_ms.is_some())).map_err(|e| self.guard.refine(e))
    }
}

/// A `statement_timeout` under a time limit reads as the time limit.
fn time_limit(e: DbError, limited: bool) -> DbError {
    let timed_out = limited
        && matches!(&e, DbError::SqlEngine(err) if err
            .as_database_error()
            .and_then(|d| d.code())
            .is_some_and(|c| c == PG_QUERY_CANCELED));
    if timed_out {
        DbError::InvalidOperation(TIME_LIMIT_ERROR.into())
    } else {
        e
    }
}

/// Against a real server, `#[ignore]`d like the other live tests:
/// `cargo test -p dh-core -- --ignored pg_builder`.
#[cfg(test)]
mod live_tests {
    use super::*;
    use crate::db::postgres::query::read_only_live_tests::params;

    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_builder_read_only_refuses_a_function_that_inserts() {
        let a = PgAdapter::connect(&params(false)).await.unwrap();
        let t = format!("dh_qb_{}", uuid::Uuid::new_v4().simple());
        a.run_sql(None, None, &format!("CREATE TABLE {t} (id int)")).await.unwrap();
        a.run_sql(
            None,
            None,
            &format!("CREATE FUNCTION {t}_put() RETURNS int LANGUAGE sql AS 'INSERT INTO {t} VALUES (1) RETURNING id'"),
        )
        .await
        .unwrap();

        let sql = format!("SELECT * FROM {t} WHERE {t}_put() = 1");
        let res = a.run_read_only(None, None, &sql, Some(5_000), None, &mut |_| Ok(())).await;
        assert!(res.is_err(), "the insert must fail in a read only transaction");
        let left = a.run_sql(None, None, &format!("SELECT count(*) FROM {t}")).await.unwrap();
        assert_eq!(left.rows, vec![vec![Some("0".to_string())]]);

        let slow = a.run_read_only(None, None, "SELECT pg_sleep(2)", Some(100), None, &mut |_| Ok(())).await;
        assert!(matches!(slow, Err(DbError::InvalidOperation(m)) if m == TIME_LIMIT_ERROR));

        a.run_sql(None, None, &format!("DROP FUNCTION {t}_put(); DROP TABLE {t}")).await.unwrap();
    }
}
