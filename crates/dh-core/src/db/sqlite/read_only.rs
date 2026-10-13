//! The query builder's read only run: one SELECT with `query_only` on and an
//! interrupt timer for the time limit, whatever the connection's own read
//! only flag. Several may share one run, each with its own canceller.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use crate::api::QueryResult;
use crate::db::read_only::Dialect;
use crate::db::sql_builder::TIME_LIMIT_ERROR;
use crate::db::{BatchSink, DbError, DbResult, RunHandle};
use super::interrupt::InterruptHandle;
use super::query::stream_select;
use super::SqliteAdapter;

impl SqliteAdapter {
    pub(super) async fn run_read_only(
        &self,
        sql: &str,
        time_ms: Option<u64>,
        run: Option<&RunHandle>,
        sink: BatchSink<'_>,
    ) -> DbResult<QueryResult> {
        self.guard.check_sql(Dialect::Sqlite, sql)?;
        let start = Instant::now();
        let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
        let handle = InterruptHandle(conn.lock_handle().await.map_err(DbError::SqlEngine)?.as_raw_handle());
        let armed = match run {
            Some(run) => {
                let canceller = Box::new(move || {
                    handle.interrupt();
                    Box::pin(std::future::ready(())) as futures_util::future::BoxFuture<'static, ()>
                });
                match run.add_canceller(canceller).await {
                    Some(id) => Some((run, id)),
                    None => return Err(DbError::Cancelled),
                }
            }
            None => None,
        };

        // A read only connection already has it on; leave it that way after.
        let was_on: i64 = sqlx::query_scalar("PRAGMA query_only")
            .fetch_one(&mut *conn)
            .await
            .map_err(DbError::SqlEngine)?;
        sqlx::query("PRAGMA query_only = ON").execute(&mut *conn).await.map_err(DbError::SqlEngine)?;

        let timed_out = AtomicBool::new(false);
        let streamed = {
            let read = stream_select(&mut conn, sql, &[], run, sink);
            // The timer only interrupts; the read itself ends with the
            // interrupt error, so the connection is never dropped mid read.
            let timer = async {
                if let Some(ms) = time_ms {
                    tokio::time::sleep(Duration::from_millis(ms)).await;
                    timed_out.store(true, Ordering::SeqCst);
                    handle.interrupt();
                }
                std::future::pending::<()>().await
            };
            tokio::select! {
                r = read => r,
                _ = timer => unreachable!("the timer never ends"),
            }
        };

        if let Some((run, id)) = armed {
            run.remove_canceller(id).await;
        }
        let restored = if was_on == 0 {
            sqlx::query("PRAGMA query_only = OFF").execute(&mut *conn).await.is_ok()
        } else {
            true
        };
        if !restored {
            // Never hand a connection stuck in query only back to the pool.
            drop(conn.detach());
        }

        let (columns, _total) = streamed.map_err(|e| match e {
            DbError::Cancelled => e,
            _ if timed_out.load(Ordering::SeqCst) => DbError::InvalidOperation(TIME_LIMIT_ERROR.into()),
            _ => self.guard.refine(e),
        })?;
        Ok(QueryResult {
            columns,
            rows: Vec::new(),
            rows_affected: 0,
            is_select: true,
            error: None,
            elapsed_ms: start.elapsed().as_millis(),
            cancelled: false,
        })
    }
}
