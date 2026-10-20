//! The read only run (query builder previews, spec 0025 AC-17): one SELECT
//! in a `READ ONLY` transaction that is always rolled back, whatever the
//! connection's own flag. Several may share one run, each with its own
//! canceller.

use sqlx::mysql::MySqlDatabaseError;
use sqlx::Executor as _;
use std::time::Instant;
use crate::api::QueryResult;
use crate::db::read_only::Dialect;
use crate::db::sql_builder::TIME_LIMIT_ERROR;
use crate::db::{BatchSink, DbError, DbResult, RunHandle};
use super::MySqlAdapter;
use super::cancel::{connection_id, conn_reusable, kill_query, RunConn};
use super::connect::Flavor;
use super::sql_text::q;
use super::bytes::BytesRule;
use super::stream::stream_statement;

/// MySQL `ER_QUERY_TIMEOUT` (3024) and MariaDB `ER_STATEMENT_TIMEOUT` (1969).
const TIMEOUT_ERRORS: [u16; 2] = [3024, 1969];

impl MySqlAdapter {
    pub(super) async fn run_read_only(
        &self,
        database: Option<&str>,
        sql: &str,
        time_ms: Option<u64>,
        run: Option<&RunHandle>,
        sink: BatchSink<'_>,
    ) -> DbResult<QueryResult> {
        self.guard.check_sql(Dialect::Mysql, sql)?;
        let start = Instant::now();
        let trimmed = sql.trim();
        let mut conn = RunConn::acquire(&self.pool).await?;
        let armed = match run {
            Some(run) => {
                let id = connection_id(&mut conn).await?;
                match run.add_canceller(kill_query(self.one_off_options(), id)).await {
                    Some(cid) => Some((run, cid)),
                    None => return Err(DbError::Cancelled),
                }
            }
            None => None,
        };

        let ran = async {
            if let Some(db) = self.target(database) {
                (&mut *conn).execute(format!("USE {}", q(db)).as_str()).await.map_err(DbError::SqlEngine)?;
            }
            let statement = match (time_ms, self.server.flavor) {
                (Some(ms), Flavor::Mysql) => {
                    (&mut *conn).execute(format!("SET SESSION MAX_EXECUTION_TIME = {ms}").as_str())
                        .await
                        .map_err(DbError::SqlEngine)?;
                    trimmed.to_string()
                }
                (Some(ms), Flavor::Mariadb) => {
                    format!("SET STATEMENT max_statement_time = {} FOR {trimmed}", ms as f64 / 1000.0)
                }
                (None, _) => trimmed.to_string(),
            };
            (&mut *conn).execute("START TRANSACTION READ ONLY").await.map_err(DbError::SqlEngine)?;
            let streamed = stream_statement(&mut conn, &statement, &[], true, BytesRule::Fallback, run, sink).await;
            let rolled = (&mut *conn).execute("ROLLBACK").await;
            if time_ms.is_some() && self.server.flavor == Flavor::Mysql {
                let _ = (&mut *conn).execute("SET SESSION MAX_EXECUTION_TIME = 0").await;
            }
            let streamed = streamed?;
            rolled.map_err(DbError::SqlEngine)?;
            Ok(QueryResult {
                columns: streamed.columns,
                rows: vec![],
                rows_affected: 0,
                is_select: true,
                error: None,
                elapsed_ms: start.elapsed().as_millis(),
                cancelled: false,
                cancel_source: None,
            })
        }
        .await;

        if let Some((run, cid)) = armed {
            run.remove_canceller(cid).await;
        }
        conn.release(conn_reusable(&ran));
        ran.map_err(|e| time_limit(e, time_ms.is_some())).map_err(|e| self.guard.refine(e))
    }
}

/// A server statement timeout under a time limit reads as the time limit.
fn time_limit(e: DbError, limited: bool) -> DbError {
    let timed_out = limited
        && matches!(&e, DbError::SqlEngine(err) if err
            .as_database_error()
            .and_then(|d| d.try_downcast_ref::<MySqlDatabaseError>())
            .is_some_and(|d| TIMEOUT_ERRORS.contains(&d.number())));
    if timed_out {
        DbError::InvalidOperation(TIME_LIMIT_ERROR.into())
    } else {
        e
    }
}
