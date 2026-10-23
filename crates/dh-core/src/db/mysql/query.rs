use sqlx::Executor as _;
use std::time::Instant;
use crate::api::{GridFilterCond, OrderByCond, QueryChunk, QueryOp, QueryResult};
use crate::db::read_only::Dialect;
use crate::db::stream::Collected;
use crate::db::{BatchSink, DbError, DbResult, OpOutcome, RunHandle};
use super::MySqlAdapter;
use super::bytes::{table_columns, BytesRule, Param, TableColumns};
use super::cancel::{conn_reusable, RunConn};
use super::filters::where_clause;
use super::sql_text::{is_select_statement, q, tq};
use super::stream::{stream_statement, Streamed};

fn result(streamed: Streamed, is_select: bool, start: Instant) -> QueryResult {
    QueryResult {
        columns: streamed.columns,
        rows: vec![],
        rows_affected: if is_select { 0 } else { streamed.rows_affected },
        is_select,
        error: None,
        elapsed_ms: start.elapsed().as_millis(),
        cancelled: false,
        cancel_source: None,
    }
}

/// SQL and its parameters, built against a table's catalog.
type Build<'a> = &'a (dyn Fn(&TableColumns) -> (String, Vec<Option<String>>) + Sync);

/// What a run executes.
enum Stmt<'a> {
    /// Fixed SQL with no known table: bytes versus text by the fallback.
    Sql(&'a str, &'a [Option<String>]),
    /// SQL the app builds against `table` once its catalog is read, on the
    /// same connection after `USE`, so BIT and JSON filters bind right.
    /// With `cells`, the catalog also decides bytes versus text; a result
    /// with columns of its own (a count) leaves that to the fallback.
    Table { table: &'a str, cells: bool, build: Build<'a> },
}

impl MySqlAdapter {
    /// The editor's Run, and every other single statement run: a dedicated
    /// pooled connection for the whole run so Stop has a connection id to
    /// kill. `database` becomes the session's default database (`USE`), so
    /// unqualified names resolve in it.
    pub(super) async fn run_sql_cancellable(
        &self,
        database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
        run: Option<&RunHandle>,
        sink: BatchSink<'_>,
    ) -> DbResult<QueryResult> {
        let (result, _) = self.run_stmt(database, Stmt::Sql(sql, params), run, sink).await?;
        Ok(result)
    }

    /// A read the app builds against `table`. Also returns the SQL that ran,
    /// with its values inlined, for the activity log.
    async fn run_on_table(
        &self,
        database: Option<&str>,
        table: &str,
        cells: bool,
        build: Build<'_>,
        sink: BatchSink<'_>,
    ) -> DbResult<(QueryResult, String)> {
        self.run_stmt(database, Stmt::Table { table, cells, build }, None, sink).await
    }

    async fn run_stmt(
        &self,
        database: Option<&str>,
        stmt: Stmt<'_>,
        run: Option<&RunHandle>,
        sink: BatchSink<'_>,
    ) -> DbResult<(QueryResult, String)> {
        let start = Instant::now();
        let mut conn = RunConn::acquire(&self.pool).await?;
        let ran = async {
            if let Some(db) = self.target(database) {
                (&mut *conn).execute(format!("USE {}", q(db)).as_str())
                    .await
                    .map_err(DbError::SqlEngine)?;
            }
            // Same connection, right before the read, after `USE`, so
            // `DATABASE()` is the table's database. A failed lookup builds
            // with no catalog: plain `?` filters and the bytes fallback.
            let mut known = None;
            let mut display = String::new();
            let built: (String, Vec<Option<String>>);
            let (sql, params, cells) = match stmt {
                Stmt::Sql(sql, params) => (sql, params, false),
                Stmt::Table { table, cells, build } => {
                    known = table_columns(&mut conn, table).await;
                    built = build(known.as_ref().unwrap_or(&TableColumns::default()));
                    display = crate::db::inline_placeholders(&built.0, &built.1, false) + ";";
                    (built.0.as_str(), built.1.as_slice(), cells)
                }
            };
            let trimmed = sql.trim();
            let is_select = is_select_statement(trimmed);
            let bytes = match &known {
                Some(k) if cells => BytesRule::Catalog(&k.bytes),
                _ => BytesRule::Fallback,
            };
            let armed = match run {
                Some(run) => self.arm_stop(&mut conn, run).await?,
                None => true,
            };
            if !armed {
                return Err(DbError::Cancelled);
            }
            let streamed = stream_statement(&mut conn, trimmed, &Param::texts(params), is_select, bytes, run, sink).await?;
            // `SLEEP()` and a few other functions answer a kill by
            // returning early instead of failing: still the user's Stop.
            if run.is_some_and(RunHandle::is_cancel_requested) {
                return Err(DbError::Cancelled);
            }
            Ok((result(streamed, is_select, start), display))
        }
        .await;

        // Unregister BEFORE the connection returns to the pool, so a late
        // kill can never hit a later query on the same connection.
        if let Some(run) = run {
            run.finish().await;
        }
        conn.release(conn_reusable(&ran));
        ran
    }

    async fn collect(&self, database: Option<&str>, stmt: Stmt<'_>) -> DbResult<(QueryResult, String)> {
        let mut collected = Collected::default();
        let mut sink = |chunk: QueryChunk| {
            collected.push_chunk(chunk);
            Ok(())
        };
        let (result, display) = self.run_stmt(database, stmt, None, &mut sink).await?;
        drop(sink);
        Ok((QueryResult { rows: collected.rows, ..result }, display))
    }

    async fn collect_sql(&self, database: Option<&str>, sql: &str, params: &[Option<String>]) -> DbResult<QueryResult> {
        Ok(self.collect(database, Stmt::Sql(sql, params)).await?.0)
    }

    pub(super) async fn run_sql(&self, database: Option<&str>, sql: &str) -> DbResult<QueryResult> {
        self.guard.check_sql(Dialect::Mysql, sql)?;
        self.collect_sql(database, sql, &[]).await.map_err(|e| self.guard.refine(e))
    }

    pub(super) async fn run_sql_stream(
        &self,
        database: Option<&str>,
        sql: &str,
        run: Option<&RunHandle>,
        on_batch: BatchSink<'_>,
    ) -> DbResult<QueryResult> {
        // Before a canceller is armed, so a refused statement never becomes
        // a run Stop could reach.
        self.guard.check_sql(Dialect::Mysql, sql)?;
        self.run_sql_cancellable(database, sql, &[], run, on_batch)
            .await
            .map_err(|e| self.guard.refine(e))
    }

    pub(super) async fn run_sql_params(
        &self,
        database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<QueryResult> {
        self.guard.check_sql(Dialect::Mysql, sql)?;
        self.collect_sql(database, sql, params).await.map_err(|e| self.guard.refine(e))
    }

    pub(super) async fn execute_params(
        &self,
        database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<u64> {
        self.guard.check_sql(Dialect::Mysql, sql)?;
        let mut sink = |_: QueryChunk| Ok(());
        let res = self
            .run_sql_cancellable(database, sql, params, None, &mut sink)
            .await
            .map_err(|e| self.guard.refine(e))?;
        Ok(res.rows_affected)
    }

    pub(super) async fn execute_op(
        &self,
        database: Option<&str>,
        op: &QueryOp,
    ) -> DbResult<OpOutcome> {
        self.guard.check_op(op)?;
        let db = self.target(database);
        match op {
            QueryOp::Select { .. } => {
                let mut collected = Collected::default();
                let mut sink = |chunk: QueryChunk| {
                    collected.push_chunk(chunk);
                    Ok(())
                };
                let outcome = self.select_stream(database, op, &mut sink).await?;
                drop(sink);
                Ok(OpOutcome { result: QueryResult { rows: collected.rows, ..outcome.result }, sql: outcome.sql })
            }
            QueryOp::Count { table, filters, custom_where } => {
                let build = |cols: &TableColumns| {
                    let mut params = Vec::new();
                    let where_sql = where_clause(filters, custom_where.as_ref(), cols, &mut params);
                    (format!("SELECT COUNT(*) AS `count` FROM {}{where_sql}", tq(db, table)), params)
                };
                let (res, display) = self.collect(database, Stmt::Table { table, cells: false, build: &build }).await?;
                let count = res
                    .rows
                    .first()
                    .and_then(|r| r.first().cloned().flatten())
                    .unwrap_or_else(|| "0".into());
                let n = count.parse::<u64>().unwrap_or(0);
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: vec!["count".into()],
                        rows: vec![vec![Some(count)]],
                        rows_affected: n,
                        ..res
                    },
                    sql: Some(display),
                })
            }
            QueryOp::SelectDistinct { table, column, limit } => {
                let build = |_: &TableColumns| {
                    let mut sql = format!("SELECT DISTINCT {} FROM {}", q(column), tq(db, table));
                    if let Some(l) = limit {
                        sql.push_str(&format!(" LIMIT {l}"));
                    }
                    (sql, Vec::new())
                };
                let (result, display) = self.collect(database, Stmt::Table { table, cells: true, build: &build }).await?;
                Ok(OpOutcome { result, sql: Some(display) })
            }
            _ => self.execute_write(database, op).await,
        }
    }

    pub(super) async fn execute_op_stream(
        &self,
        database: Option<&str>,
        op: &QueryOp,
        on_batch: BatchSink<'_>,
    ) -> DbResult<OpOutcome> {
        if !matches!(op, QueryOp::Select { .. }) {
            return self.execute_op(database, op).await;
        }
        self.guard.check_op(op)?;
        self.select_stream(database, op, on_batch).await
    }

    /// The grid's page read, streamed.
    async fn select_stream(&self, database: Option<&str>, op: &QueryOp, on_batch: BatchSink<'_>) -> DbResult<OpOutcome> {
        let QueryOp::Select { table, filters, custom_where, order_by, limit, offset } = op else {
            return Err(DbError::InvalidOperation("not a select".into()));
        };
        let db = self.target(database);
        let build = |cols: &TableColumns| {
            let mut params = Vec::new();
            let sql = build_select(db, table, filters, custom_where.as_ref(), order_by, *limit, *offset, cols, &mut params);
            (sql, params)
        };
        let (result, display) = self.run_on_table(database, table, true, &build, on_batch).await?;
        Ok(OpOutcome { result, sql: Some(display) })
    }
}

/// The grid's page read for a [`QueryOp::Select`].
#[allow(clippy::too_many_arguments)]
pub(super) fn build_select(
    database: Option<&str>,
    table: &str,
    filters: &[GridFilterCond],
    custom_where: Option<&String>,
    order_by: &[OrderByCond],
    limit: Option<i64>,
    offset: Option<i64>,
    cols: &TableColumns,
    params: &mut Vec<Option<String>>,
) -> String {
    let where_sql = where_clause(filters, custom_where, cols, params);
    let order = if order_by.is_empty() {
        String::new()
    } else {
        let keys: Vec<String> = order_by
            .iter()
            .map(|o| format!("{} {}", q(&o.column), if o.dir == "DESC" { "DESC" } else { "ASC" }))
            .collect();
        format!(" ORDER BY {}", keys.join(", "))
    };
    // MySQL has no OFFSET without LIMIT: the documented "all rows" limit.
    let lim = match (limit, offset) {
        (Some(l), _) => format!(" LIMIT {l}"),
        (None, Some(_)) => " LIMIT 18446744073709551615".to_string(),
        (None, None) => String::new(),
    };
    let off = offset.map(|o| format!(" OFFSET {o}")).unwrap_or_default();
    format!("SELECT * FROM {}{where_sql}{order}{lim}{off}", tq(database, table))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_page_read_quotes_with_backticks_and_qualifies_the_database() {
        let mut params = Vec::new();
        let order = vec![OrderByCond { column: "id".into(), dir: "DESC".into() }];
        let cols = TableColumns::default();
        let sql = build_select(Some("shop"), "items", &[], None, &order, Some(50), Some(100), &cols, &mut params);
        assert_eq!(sql, "SELECT * FROM `shop`.`items` ORDER BY `id` DESC LIMIT 50 OFFSET 100");
        let sql = build_select(None, "items", &[], None, &[], None, Some(10), &cols, &mut params);
        assert_eq!(sql, "SELECT * FROM `items` LIMIT 18446744073709551615 OFFSET 10");
    }
}
