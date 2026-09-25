use std::time::Instant;
use sqlx::Row;
use crate::api::{PlanDialect, PlanMode, PlanResult};
use crate::db::explain::{check_statement, finish, sqlite::plan_from_rows};
use crate::db::read_only::Dialect;
use crate::db::{DbError, RunHandle};
use super::interrupt::{arm_interrupt, release_run, run_error};
use super::SqliteAdapter;

impl SqliteAdapter {
    /// `EXPLAIN QUERY PLAN`, which never runs the statement, so it needs no
    /// read only check and there is no analyze mode.
    pub(super) async fn explain_sql(&self, sql: &str, analyze: bool, run: Option<&RunHandle>) -> PlanResult {
        let mode = if analyze { PlanMode::Analyze } else { PlanMode::Estimate };
        let statement = sql.trim();
        let fail = |message: String| PlanResult::failed(PlanDialect::Sqlite, mode, statement, message);
        if analyze {
            return fail("SQLite has no Explain Analyze.".into());
        }
        let sent = match check_statement(Dialect::Sqlite, sql) {
            Ok(sent) => sent,
            Err(message) => return PlanResult::unsupported(PlanDialect::Sqlite, mode, statement, message),
        };
        let start = Instant::now();
        let stopped = || PlanResult::stopped(PlanDialect::Sqlite, mode, statement, start.elapsed().as_millis() as u64);
        let mut conn = match self.pool.acquire().await {
            Ok(conn) => conn,
            Err(e) => return fail(e.to_string()),
        };
        // Planning is near instant, but the run is registered like any other
        // so Stop behaves the same on every engine.
        if let Err(DbError::Cancelled) = arm_interrupt(&mut conn, run).await {
            return stopped();
        }
        let fetched = sqlx::query(&format!("EXPLAIN QUERY PLAN {sent}")).fetch_all(&mut *conn).await;
        release_run(run).await;
        let elapsed_ms = start.elapsed().as_millis() as u64;
        let rows = match fetched {
            Ok(rows) => rows,
            Err(e) => {
                return match run_error(e, run) {
                    DbError::Cancelled => stopped(),
                    other => fail(other.to_string()),
                }
            }
        };
        let mut plan_rows = Vec::with_capacity(rows.len());
        for row in &rows {
            match (row.try_get::<i64, _>(0), row.try_get::<i64, _>(1), row.try_get::<String, _>(3)) {
                (Ok(id), Ok(parent), Ok(detail)) => plan_rows.push((id, parent, detail)),
                _ => return fail("SQLite returned a plan row Explain could not read.".into()),
            }
        }
        let (root, truncated) = finish(plan_from_rows(&plan_rows));
        PlanResult::planned(PlanDialect::Sqlite, mode, statement, root, truncated, elapsed_ms)
    }
}
