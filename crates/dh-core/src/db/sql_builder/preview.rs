use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Instant;
use futures_util::future::BoxFuture;
use futures_util::StreamExt;
use crate::api::{QueryChunk, SqlBuilderPreviewRequest, SqlPreviewChunk, SqlPreviewSummary};
use crate::db::adapter::DbAdapter;
use crate::db::read_only::{statement_count, Dialect};
use crate::db::stream::Collected;
use crate::db::{DbError, DbResult, RunHandle};
use super::{SqlPreviewSink, TIME_LIMIT_ERROR};

/// The column every preview target adds for its count.
const COUNT_COLUMN: &str = "__dh_count";

/// Run every target read only, card order first, at most `concurrency`
/// at a time and always leaving the pool one connection. Chunks go out as
/// targets finish. A failing card stops the queued cards after it (each
/// reads through it). The probe runs alongside.
pub(super) async fn run_preview(
    a: &dyn DbAdapter,
    req: &SqlBuilderPreviewRequest,
    run: Option<&RunHandle>,
    sink: SqlPreviewSink<'_>,
) -> DbResult<SqlPreviewSummary> {
    let database = req.database.as_deref();
    let schema = req.schema.as_deref();
    let time_ms = Some(req.time_ms);
    let width = (req.concurrency.clamp(1, 8)).min(a.pool_size().saturating_sub(1).max(1)) as usize;
    let cancelled = AtomicBool::new(false);
    let first_failed = AtomicUsize::new(usize::MAX);

    // Boxed up front, so the stream's type holds no closure over borrows
    // (which trips the `Send` check of the server's handler future).
    let mut queued: Vec<BoxFuture<'_, Option<SqlPreviewChunk>>> = Vec::with_capacity(req.targets.len());
    for (ord, t) in req.targets.iter().enumerate() {
        let (cancelled, first_failed) = (&cancelled, &first_failed);
        queued.push(Box::pin(async move {
            if cancelled.load(Ordering::SeqCst) || first_failed.load(Ordering::SeqCst) < ord {
                return None;
            }
            let started = Instant::now();
            let res = match single_statement(&t.sql) {
                Ok(()) => collect(a, database, schema, &t.sql, time_ms, run).await,
                Err(e) => Err(e),
            };
            let mut chunk = SqlPreviewChunk {
                clause_id: t.clause_id.clone(),
                elapsed_ms: started.elapsed().as_millis(),
                ..Default::default()
            };
            match res {
                Ok(collected) => {
                    let (count, columns, rows) = strip_count(collected);
                    chunk.count = count;
                    chunk.columns = columns;
                    chunk.rows = rows;
                }
                Err(DbError::Cancelled) => {
                    cancelled.store(true, Ordering::SeqCst);
                    return None;
                }
                Err(e) => {
                    first_failed.fetch_min(ord, Ordering::SeqCst);
                    let (text, timed_out) = error_text(&e);
                    chunk.error = Some(text);
                    chunk.timed_out = timed_out;
                }
            }
            Some(chunk)
        }));
    }
    let results = futures_util::stream::iter(queued).buffer_unordered(width);

    let send = async {
        let mut results = std::pin::pin!(results);
        while let Some(item) = results.next().await {
            if let Some(chunk) = item {
                sink(chunk)?;
            }
        }
        Ok::<(), DbError>(())
    };
    let probe = async {
        let sql = req.probe_sql.as_deref()?;
        let c = collect(a, database, schema, sql, time_ms, run).await.ok()?;
        c.rows.first()?.first()?.as_deref()?.parse::<u64>().ok()
    };
    let (sent, source_rows) = tokio::join!(send, probe);
    sent?;
    Ok(SqlPreviewSummary {
        cancelled: cancelled.load(Ordering::SeqCst) || run.is_some_and(RunHandle::is_cancel_requested),
        source_rows,
    })
}

async fn collect(
    a: &dyn DbAdapter,
    database: Option<&str>,
    schema: Option<&str>,
    sql: &str,
    time_ms: Option<u64>,
    run: Option<&RunHandle>,
) -> DbResult<Collected> {
    let mut collected = Collected::default();
    let mut sink = |chunk: QueryChunk| {
        collected.push_chunk(chunk);
        Ok(())
    };
    let result = a.run_read_only(database, schema, sql, time_ms, run, &mut sink).await?;
    if collected.columns.is_empty() {
        collected.columns = result.columns;
    }
    Ok(collected)
}

/// A target is one statement; the dialect only changes quoting, and both
/// split the same on a top level `;`.
fn single_statement(sql: &str) -> DbResult<()> {
    match statement_count(Dialect::Postgres, sql) {
        Ok(1) => Ok(()),
        Ok(_) => Err(DbError::InvalidOperation("A card's query must be one statement".into())),
        Err(e) => Err(DbError::InvalidOperation(e.into())),
    }
}

/// The count from the first row's `__dh_count` (0 with no rows), and the
/// rows without that column.
fn strip_count(c: Collected) -> (u64, Vec<String>, Vec<Vec<Option<String>>>) {
    let Some(at) = c.columns.iter().rposition(|n| n == COUNT_COLUMN) else {
        return (c.rows.len() as u64, c.columns, c.rows);
    };
    let count = c
        .rows
        .first()
        .and_then(|r| r.get(at).cloned().flatten())
        .and_then(|n| n.parse::<u64>().ok())
        .unwrap_or(0);
    let mut columns = c.columns;
    columns.remove(at);
    let rows = c
        .rows
        .into_iter()
        .map(|mut r| {
            if at < r.len() {
                r.remove(at);
            }
            r
        })
        .collect();
    (count, columns, rows)
}

/// The database's own words, and a time limit said plainly (with `true`).
fn error_text(e: &DbError) -> (String, bool) {
    match e {
        DbError::InvalidOperation(m) if m == TIME_LIMIT_ERROR => (m.clone(), true),
        DbError::SqlEngine(sqlx::Error::Database(d)) => (d.message().to_string(), false),
        other => (other.to_string(), false),
    }
}

/// The activity log line for one refresh.
pub fn preview_activity_text(req: &SqlBuilderPreviewRequest) -> String {
    let n = req.targets.len();
    let cards = if n == 1 { "card" } else { "cards" };
    format!("preview query builder {} ({n} {cards}, first {} rows)", req.table, req.cap)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(n: usize) -> SqlBuilderPreviewRequest {
        SqlBuilderPreviewRequest {
            database: None,
            schema: None,
            targets: (0..n)
                .map(|i| crate::api::SqlPreviewTarget { clause_id: format!("c{i}"), sql: "SELECT 1".into() })
                .collect(),
            probe_sql: None,
            table: "orders".into(),
            cap: 1000,
            time_ms: 10_000,
            concurrency: 4,
            run_id: None,
        }
    }

    #[test]
    fn the_activity_line_names_the_table_cards_and_cap() {
        assert_eq!(preview_activity_text(&req(3)), "preview query builder orders (3 cards, first 1000 rows)");
        assert_eq!(preview_activity_text(&req(1)), "preview query builder orders (1 card, first 1000 rows)");
    }

    #[test]
    fn the_count_column_is_read_and_stripped() {
        let c = Collected {
            columns: vec!["id".into(), COUNT_COLUMN.into()],
            rows: vec![vec![Some("1".into()), Some("37".into())], vec![Some("2".into()), Some("37".into())]],
            documents: vec![],
        };
        let (count, columns, rows) = strip_count(c);
        assert_eq!(count, 37);
        assert_eq!(columns, vec!["id".to_string()]);
        assert_eq!(rows, vec![vec![Some("1".to_string())], vec![Some("2".to_string())]]);
    }

    #[test]
    fn no_rows_counts_zero() {
        let c = Collected { columns: vec![COUNT_COLUMN.into()], rows: vec![], documents: vec![] };
        assert_eq!(strip_count(c).0, 0);
    }

    #[test]
    fn a_target_must_be_one_statement() {
        assert!(single_statement("SELECT 1").is_ok());
        assert!(single_statement("SELECT 1;").is_ok());
        assert!(single_statement("SELECT 1; DELETE FROM t").is_err());
        assert!(single_statement("SELECT ';'").is_ok());
    }
}
