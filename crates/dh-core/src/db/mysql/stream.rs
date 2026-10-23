//! The one MySQL row loop: reads a statement's result off the socket as the
//! server sends it and hands rows to a sink in batches (spec 0011). The
//! editor, the grid read and the collecting callers all go through
//! [`stream_statement`]; nothing uses `fetch_all` for a result.

use futures_util::TryStreamExt;
use sqlx::{Column as _, Either, Executor as _, MySqlConnection, Row as _, Statement as _};
use crate::db::stream::Batcher;
use crate::db::{BatchSink, DbResult, RunHandle};
use super::cancel::run_error;
use super::bytes::{BytesRule, Param};
use super::rows::{bind_all, row_to_vec, Wire};

/// What a finished stream reports. The rows themselves went to the sink.
pub(super) struct Streamed {
    pub(super) columns: Vec<String>,
    pub(super) rows_affected: u64,
}

/// Run `sql` on `conn` and send its rows to `sink` in batches. Without
/// `params` it goes over the text protocol (the server's own text, and
/// statements that can't be prepared, like `CREATE PROCEDURE`); with them,
/// as a prepared statement. `bytes` is how each cell's bytes versus text
/// is decided (the binary column rule).
///
/// Columns come from the first row. A row returning statement with no rows
/// is described once afterwards, so it still reports real names. On an
/// error the batch in hand is sent first, so rows already read stay with the
/// caller (AC-16).
pub(super) async fn stream_statement(
    conn: &mut MySqlConnection,
    sql: &str,
    params: &[Param],
    describe_if_empty: bool,
    bytes: BytesRule<'_>,
    run: Option<&RunHandle>,
    sink: BatchSink<'_>,
) -> DbResult<Streamed> {
    let mut batcher = Batcher::new(sink);
    let mut columns: Option<Vec<String>> = None;
    let mut mask: Vec<Option<bool>> = Vec::new();
    let mut rows_affected = 0u64;
    let wire = if params.is_empty() { Wire::Text } else { Wire::Binary };

    let read: DbResult<()> = {
        let mut stream = if params.is_empty() {
            (&mut *conn).fetch_many(sql)
        } else {
            (&mut *conn).fetch_many(bind_all(sql, params))
        };
        loop {
            let next = match batcher.deadline() {
                Some(at) => match tokio::time::timeout_at(at, stream.try_next()).await {
                    Ok(next) => next,
                    Err(_) => {
                        if let Err(e) = batcher.flush() {
                            break Err(e);
                        }
                        continue;
                    }
                },
                None => stream.try_next().await,
            };
            match next {
                Ok(Some(Either::Right(row))) => {
                    if columns.is_none() {
                        let names: Vec<String> = row.columns().iter().map(|c| c.name().to_string()).collect();
                        batcher.set_columns(names.clone());
                        mask = bytes.mask(&names);
                        columns = Some(names);
                    }
                    if let Err(e) = batcher.push(row_to_vec(&row, wire, &mask)) {
                        break Err(e);
                    }
                }
                Ok(Some(Either::Left(done))) => rows_affected += done.rows_affected(),
                Ok(None) => break Ok(()),
                Err(e) => break Err(run_error(e, run)),
            }
        }
    };

    if let Err(e) = read {
        let _ = batcher.flush();
        return Err(e);
    }

    let columns = match columns {
        Some(columns) => columns,
        None if describe_if_empty => {
            // Best effort: a statement the server won't prepare (some SHOW
            // forms) just reports no columns.
            let described = match conn.prepare(sql).await {
                Ok(stmt) => stmt.columns().iter().map(|c| c.name().to_string()).collect(),
                Err(_) => Vec::new(),
            };
            batcher.set_columns(described.clone());
            described
        }
        None => Vec::new(),
    };
    batcher.finish()?;
    Ok(Streamed { columns, rows_affected })
}
