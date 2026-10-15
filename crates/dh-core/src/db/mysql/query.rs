use sqlx::Executor as _;
use std::time::Instant;
use crate::api::{GridFilterCond, OrderByCond, QueryChunk, QueryOp, QueryResult};
use crate::db::read_only::Dialect;
use crate::db::stream::Collected;
use crate::db::{BatchSink, DbError, DbResult, OpOutcome, RunHandle};
use super::MySqlAdapter;
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
        let start = Instant::now();
        let trimmed = sql.trim();
        let is_select = is_select_statement(trimmed);

        let mut conn = RunConn::acquire(&self.pool).await?;
        let ran = async {
            if let Some(db) = self.target(database) {
                (&mut *conn).execute(format!("USE {}", q(db)).as_str())
                    .await
                    .map_err(DbError::SqlEngine)?;
            }
            let armed = match run {
                Some(run) => self.arm_stop(&mut conn, run).await?,
                None => true,
            };
            if !armed {
                return Err(DbError::Cancelled);
            }
            let streamed = stream_statement(&mut conn, trimmed, params, is_select, run, sink).await?;
            // `SLEEP()` and a few other functions answer a kill by
            // returning early instead of failing: still the user's Stop.
            if run.is_some_and(RunHandle::is_cancel_requested) {
                return Err(DbError::Cancelled);
            }
            Ok(result(streamed, is_select, start))
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

    async fn collect(&self, database: Option<&str>, sql: &str, params: &[Option<String>]) -> DbResult<QueryResult> {
        let mut collected = Collected::default();
        let mut sink = |chunk: QueryChunk| {
            collected.push_chunk(chunk);
            Ok(())
        };
        let result = self.run_sql_cancellable(database, sql, params, None, &mut sink).await?;
        drop(sink);
        Ok(QueryResult { rows: collected.rows, ..result })
    }

    pub(super) async fn run_sql(&self, database: Option<&str>, sql: &str) -> DbResult<QueryResult> {
        self.guard.check_sql(Dialect::Mysql, sql)?;
        self.collect(database, sql, &[]).await.map_err(|e| self.guard.refine(e))
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
        self.collect(database, sql, params).await.map_err(|e| self.guard.refine(e))
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
                let mut params = Vec::new();
                let where_sql = where_clause(filters, custom_where.as_ref(), &mut params);
                let sql = format!("SELECT COUNT(*) AS `count` FROM {}{where_sql}", tq(db, table));
                let res = self.collect(database, &sql, &params).await?;
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
                    sql: Some(crate::db::inline_placeholders(&sql, &params, false) + ";"),
                })
            }
            QueryOp::SelectDistinct { table, column, limit } => {
                let mut sql = format!("SELECT DISTINCT {} FROM {}", q(column), tq(db, table));
                if let Some(l) = limit {
                    sql.push_str(&format!(" LIMIT {l}"));
                }
                let result = self.collect(database, &sql, &[]).await?;
                Ok(OpOutcome { result, sql: Some(format!("{sql};")) })
            }
            // Grid writes land in build plan slice 4 (spec 0025 AC-14).
            _ => Err(DbError::InvalidOperation(format!(
                "{} is not available on MySQL connections yet",
                op.write_name()
            ))),
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
        let mut params = Vec::new();
        let sql = build_select(self.target(database), table, filters, custom_where.as_ref(), order_by, *limit, *offset, &mut params);
        let display = crate::db::inline_placeholders(&sql, &params, false) + ";";
        let result = self.run_sql_cancellable(database, &sql, &params, None, on_batch).await?;
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
    params: &mut Vec<Option<String>>,
) -> String {
    let where_sql = where_clause(filters, custom_where, params);
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
        let sql = build_select(Some("shop"), "items", &[], None, &order, Some(50), Some(100), &mut params);
        assert_eq!(sql, "SELECT * FROM `shop`.`items` ORDER BY `id` DESC LIMIT 50 OFFSET 100");
        let sql = build_select(None, "items", &[], None, &[], None, Some(10), &mut params);
        assert_eq!(sql, "SELECT * FROM `items` LIMIT 18446744073709551615 OFFSET 10");
    }
}
