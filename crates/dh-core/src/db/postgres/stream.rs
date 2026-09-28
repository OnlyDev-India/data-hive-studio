//! The one PostgreSQL row loop: reads a SELECT off the socket as the server
//! sends it and hands rows to a sink in batches. The editor, the run less
//! path and the collecting callers all go through [`stream_statement`].

use futures_util::TryStreamExt;
use sqlx::{Column as _, PgConnection, Row as _};
use crate::db::stream::Batcher;
use crate::db::{BatchSink, DbError, DbResult, RunHandle};
use super::cancel::pg_run_error;
use super::exec::bind_all;
use super::rows::{describe_columns_conn, row_to_vec};

/// What a finished stream reports. The rows themselves went to the sink.
pub(super) struct Streamed {
    pub(super) columns: Vec<String>,
}

/// Run `sql` (already `$n` numbered) with `params` on `conn` and send its rows
/// to `sink` in batches. There is no server side cursor and no open
/// transaction of its own: rows are read as they arrive, so memory holds one
/// batch plus the driver's buffer.
///
/// Columns come from the first row. A result with no rows describes the
/// statement once after the stream ends, so it still reports real names.
///
/// On an error the batch in hand is sent first, so rows already read stay
/// with the caller. A `query_canceled` the user asked for comes back as
/// [`DbError::Cancelled`]. If the sink fails, the error comes back and the
/// caller detaches the connection, so the server stops at its next write.
pub(super) async fn stream_statement(
    conn: &mut PgConnection,
    sql: &str,
    params: &[Option<String>],
    run: Option<&RunHandle>,
    sink: BatchSink<'_>,
) -> DbResult<Streamed> {
    let mut batcher = Batcher::new(sink);
    let mut columns: Option<Vec<String>> = None;

    let read: DbResult<()> = {
        let mut stream = bind_all(sql, params).fetch(&mut *conn);
        loop {
            let next = match batcher.deadline() {
                Some(at) => match tokio::time::timeout_at(at, stream.try_next()).await {
                    Ok(next) => next,
                    Err(_) => {
                        // The batch is old enough: send it while the server
                        // is still producing the next rows.
                        if let Err(e) = batcher.flush() {
                            break Err(e);
                        }
                        continue;
                    }
                },
                None => stream.try_next().await,
            };
            match next {
                Ok(Some(row)) => {
                    if columns.is_none() {
                        let names: Vec<String> =
                            row.columns().iter().map(|c| c.name().to_string()).collect();
                        batcher.set_columns(names.clone());
                        columns = Some(names);
                    }
                    if let Err(e) = batcher.push(row_to_vec(&row)) {
                        break Err(e);
                    }
                }
                Ok(None) => break Ok(()),
                Err(e) => break Err(stream_error(e, run)),
            }
        }
    };

    if let Err(e) = read {
        // Keep what was read. If the sink is what failed this fails again,
        // and the original error is the one that matters.
        let _ = batcher.flush();
        return Err(e);
    }

    let columns = match columns {
        Some(columns) => columns,
        None => {
            let described = describe_columns_conn(conn, sql).await?;
            batcher.set_columns(described.clone());
            described
        }
    };
    batcher.finish()?;
    Ok(Streamed { columns })
}

pub(super) fn stream_error(e: sqlx::Error, run: Option<&RunHandle>) -> DbError {
    match run {
        Some(run) => pg_run_error(e, run),
        None => DbError::SqlEngine(e),
    }
}
