use sqlx::Value;
use sqlx::ValueRef;
use futures_util::TryStreamExt;
use sqlx::Row;
use sqlx::Column;
use sqlx::Statement;
use sqlx::Executor;
use std::time::Instant;
use sqlx::sqlite::SqliteConnection;
use crate::api::{QueryChunk, QueryOp, QueryResult};
use crate::db::{BatchSink, DbError, DbResult, RunHandle};
use super::{STREAM_BATCH_ROWS, SqliteAdapter};
use super::interrupt::{arm_interrupt, release_run, run_error};

impl SqliteAdapter {
    pub async fn run_sql(&self, sql: &str, run: Option<&RunHandle>) -> DbResult<QueryResult> {
        let start = Instant::now();
        let trimmed = sql.trim();

        // Decide whether this looks like a query. Any statement whose first
        // keyword is not a SELECT/PRAGMA/EXPLAIN is executed via execute().
        let first_word = trimmed
            .split(|c: char| c == ' ' || c == '\n' || c == '\t')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        let is_query = matches!(first_word.as_str(), "select" | "pragma" | "explain" | "with");

        let result = if is_query {
            let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
            arm_interrupt(&mut conn, run).await?;
            let fetched = fetch_all_on(&mut conn, trimmed, run).await;
            release_run(run).await;
            drop(conn);
            let (columns, rows) = fetched?;
            QueryResult {
                columns,
                rows,
                rows_affected: 0,
                is_select: true,
                error: None,
                elapsed_ms: start.elapsed().as_millis(),
                cancelled: false,
            }
        } else {
            let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
            arm_interrupt(&mut conn, run).await?;
            let executed = sqlx::query(trimmed).execute(&mut *conn).await;
            release_run(run).await;
            drop(conn);
            let res = executed.map_err(|e| run_error(e, run))?;
            QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                rows_affected: res.rows_affected(),
                is_select: false,
                error: None,
                elapsed_ms: start.elapsed().as_millis(),
                cancelled: false,
            }
        };
        Ok(result)
    }

    /// Execute a DML/DDL statement with positional `?` parameters. Used for
    /// safe row edits — values are always bound, never interpolated.
    pub async fn execute_params(&self, sql: &str, params: &[Option<String>]) -> DbResult<u64> {
        let mut q = sqlx::query(sql);
        for p in params {
            q = q.bind(p);
        }
        let res = q.execute(&self.pool).await.map_err(DbError::SqlEngine)?;
        Ok(res.rows_affected())
    }

    /// Run a SELECT built from UI filters, binding `?` placeholders so user
    /// input is never interpolated into the SQL string.
    pub async fn run_sql_params(&self, sql: &str, params: &[Option<String>]) -> DbResult<QueryResult> {
        let start = Instant::now();
        let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
        let prepared = conn.prepare(sql).await.map_err(DbError::SqlEngine)?;
        let columns: Vec<String> =
            prepared.columns().iter().map(|c| c.name().to_string()).collect();
        drop(prepared);
        drop(conn);

        let mut q = sqlx::query(sql);
        for p in params {
            q = q.bind(p);
        }
        let fetched = q.fetch_all(&self.pool).await.map_err(DbError::SqlEngine)?;
        let mut rows = Vec::with_capacity(fetched.len());
        for row in fetched {
            let mut cells = Vec::with_capacity(columns.len());
            for i in 0..columns.len() {
                cells.push(cell_to_string(row.try_get_raw(i).map_err(DbError::SqlEngine)?));
            }
            rows.push(cells);
        }
        Ok(QueryResult {
            columns,
            rows,
            rows_affected: 0,
            is_select: true,
            error: None,
            elapsed_ms: start.elapsed().as_millis(),
            cancelled: false,
        })
    }

    /// Stream a SELECT row-by-row through `on_batch` in fixed-size batches so
    /// the UI can render early while the rest of the result is still
    /// transferring. Columns are discovered by preparing the statement first,
    /// so they are known even when the result turns out to be empty. Returns
    /// the column names and the total number of rows streamed.
    pub async fn run_select_stream(
        &self,
        sql: &str,
        params: &[Option<String>],
        run: Option<&RunHandle>,
        on_batch: impl FnMut(QueryChunk) -> DbResult<()>,
    ) -> DbResult<(Vec<String>, usize)> {
        // ONE connection for the whole read: the interrupt Stop sends is
        // aimed at this connection, so prepare and fetch must share it.
        let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
        arm_interrupt(&mut conn, run).await?;
        let streamed = stream_select(&mut conn, sql, params, run, on_batch).await;
        release_run(run).await;
        drop(conn);
        streamed
    }

    /// Streaming variant of [`Self::execute_op`] for reads: row batches are
    /// pushed through `on_batch` as they come back from SQLite, and the
    /// resolved [`QueryResult`] carries every field EXCEPT rows (the caller
    /// assembles those from the chunks). Writes ignore the channel and
    /// behave exactly like [`Self::execute_op`].
    pub async fn execute_op_stream(
        &self,
        op: &QueryOp,
        on_batch: BatchSink<'_>,
    ) -> DbResult<super::OpOutcome> {
        let start = Instant::now();
        let q = self.build_query(op)?;
        match op {
            QueryOp::Select { .. } | QueryOp::Count { .. } | QueryOp::SelectDistinct { .. } => {
                let (columns, _total) =
                    self.run_select_stream(&q.sql, &q.params, None, on_batch).await?;
                Ok(super::OpOutcome {
                    result: QueryResult {
                        columns,
                        rows: Vec::new(),
                        rows_affected: 0,
                        is_select: true,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                        cancelled: false,
                    },
                    sql: Some(super::inline_placeholders(&q.sql, &q.params, false) + ";"),
                })
            }
            _ => self.execute_op(op).await,
        }
    }

    /// Streaming variant of [`Self::run_sql`]: SELECT-shaped statements push
    /// row batches through `on_batch` and resolve without rows; other
    /// statements run normally and never touch the channel.
    pub async fn run_sql_stream(
        &self,
        sql: &str,
        run: Option<&RunHandle>,
        on_batch: BatchSink<'_>,
    ) -> DbResult<QueryResult> {
        let trimmed = sql.trim();
        let first_word = trimmed
            .split(|c: char| c == ' ' || c == '\n' || c == '\t')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        let is_query = matches!(first_word.as_str(), "select" | "pragma" | "explain" | "with");
        if !is_query {
            return self.run_sql(trimmed, run).await;
        }
        let start = Instant::now();
        let (columns, _total) = self.run_select_stream(trimmed, &[], run, on_batch).await?;
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

/// Prepare `sql` and read every row on `conn`. Used by the non-streaming
/// run path; the connection is the caller's so Stop can reach it.
async fn fetch_all_on(
    conn: &mut SqliteConnection,
    sql: &str,
    run: Option<&RunHandle>,
) -> DbResult<(Vec<String>, Vec<Vec<Option<String>>>)> {
    let prepared = conn.prepare(sql).await.map_err(|e| run_error(e, run))?;
    let columns: Vec<String> = prepared.columns().iter().map(|c| c.name().to_string()).collect();
    drop(prepared);
    let fetched = sqlx::query(sql).fetch_all(&mut *conn).await.map_err(|e| run_error(e, run))?;
    let mut rows = Vec::with_capacity(fetched.len());
    for row in fetched {
        let mut cells = Vec::with_capacity(columns.len());
        for i in 0..columns.len() {
            cells.push(cell_to_string(row.try_get_raw(i).map_err(DbError::SqlEngine)?));
        }
        rows.push(cells);
    }
    Ok((columns, rows))
}

/// Prepare once up front to learn the column names (same trick as
/// `run_sql_params`), then stream rows off `conn` in fixed size batches.
async fn stream_select(
    conn: &mut SqliteConnection,
    sql: &str,
    params: &[Option<String>],
    run: Option<&RunHandle>,
    mut on_batch: impl FnMut(QueryChunk) -> DbResult<()>,
) -> DbResult<(Vec<String>, usize)> {
    let prepared = conn.prepare(sql).await.map_err(|e| run_error(e, run))?;
    let columns: Vec<String> = prepared.columns().iter().map(|c| c.name().to_string()).collect();
    drop(prepared);

    on_batch(QueryChunk { columns: Some(columns.clone()), rows: Vec::new(), documents: None })?;

    let mut q = sqlx::query(sql);
    for p in params {
        q = q.bind(p);
    }
    let mut stream = q.fetch(&mut *conn);
    let mut batch: Vec<Vec<Option<String>>> = Vec::with_capacity(STREAM_BATCH_ROWS);
    let mut total = 0usize;
    while let Some(row) = stream.try_next().await.map_err(|e| run_error(e, run))? {
        let mut cells = Vec::with_capacity(columns.len());
        for i in 0..columns.len() {
            cells.push(cell_to_string(row.try_get_raw(i).map_err(DbError::SqlEngine)?));
        }
        batch.push(cells);
        total += 1;
        if batch.len() >= STREAM_BATCH_ROWS {
            on_batch(QueryChunk { columns: None, rows: std::mem::take(&mut batch), documents: None })?;
        }
    }
    if !batch.is_empty() {
        on_batch(QueryChunk { columns: None, rows: batch, documents: None })?;
    }
    Ok((columns, total))
}

fn cell_to_string(v: sqlx::sqlite::SqliteValueRef<'_>) -> Option<String> {
    if v.is_null() {
        return None;
    }
    if let Some(s) = v.to_owned().try_decode::<String>().ok() {
        return Some(s);
    }
    if let Some(i) = v.to_owned().try_decode::<i64>().ok() {
        return Some(i.to_string());
    }
    if let Some(f) = v.to_owned().try_decode::<f64>().ok() {
        return Some(f.to_string());
    }
    v.to_owned()
        .try_decode::<Vec<u8>>()
        .ok()
        .map(|b| format!("{:?}", b))
}
