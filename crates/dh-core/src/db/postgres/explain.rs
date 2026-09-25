use std::time::Instant;
use serde_json::Value;
use sqlx::{Connection as _, PgConnection};
use crate::api::{PlanDialect, PlanMode, PlanResult};
use crate::db::explain::{check_statement, finish, postgres::{plan_from_json, TOO_DEEP}};
use crate::db::read_only::Dialect;
use crate::db::runs::until_abandoned;
use crate::db::{DbError, DbResult, RunHandle};
use super::PgAdapter;
use super::cancel::{conn_reusable, pg_run_error, RunConn};
use super::sql_text::{dollar_placeholders, q};

impl PgAdapter {
    /// `EXPLAIN (FORMAT JSON)` never runs the statement. Analyze does, so it
    /// goes through the read only check and always ends in a ROLLBACK. With a
    /// `run`, Stop can end either call.
    pub(super) async fn explain_sql(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        sql: &str,
        analyze: bool,
        run: Option<&RunHandle>,
    ) -> PlanResult {
        let mode = if analyze { PlanMode::Analyze } else { PlanMode::Estimate };
        let statement = sql.trim();
        let fail = |message: String| PlanResult::failed(PlanDialect::Postgres, mode, statement, message);
        let sent = match check_statement(Dialect::Postgres, sql) {
            Ok(sent) => sent,
            Err(message) => return PlanResult::unsupported(PlanDialect::Postgres, mode, statement, message),
        };
        // Before a canceller is armed, so a refused statement never becomes
        // a run Stop could reach. A plain estimate reads nothing, so it is
        // allowed on a read only connection whatever the statement is.
        if analyze {
            if let Err(refusal) = self.guard.check_sql(Dialect::Postgres, &sent) {
                return fail(refusal.to_string());
            }
        }
        let options = if analyze { "ANALYZE, FORMAT JSON" } else { "FORMAT JSON" };
        let text = format!("EXPLAIN ({options}) {}", dollar_placeholders(&sent));
        let start = Instant::now();
        let fetched = until_abandoned(run, self.fetch_plan(database, schema, &text, analyze, run)).await;
        let elapsed_ms = start.elapsed().as_millis() as u64;
        let parsed = match fetched {
            Ok(output) => plan_from_json(&output),
            Err(DbError::Cancelled) => {
                return PlanResult::stopped(PlanDialect::Postgres, mode, statement, elapsed_ms)
            }
            Err(e) => Err(failure_text(self.guard.refine(e))),
        };
        match parsed {
            Ok(tops) => {
                let (root, truncated) = finish(tops);
                PlanResult::planned(PlanDialect::Postgres, mode, statement, root, truncated, elapsed_ms)
            }
            Err(message) => fail(message),
        }
    }

    /// Runs the explain text on a connection of its own and returns its one
    /// JSON cell. The connection is the run's, so Stop has a backend to
    /// cancel; it goes back to the pool only when the server answered.
    async fn fetch_plan(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        text: &str,
        analyze: bool,
        run: Option<&RunHandle>,
    ) -> DbResult<Value> {
        let pool = self.pool_for(database).await?;
        let mut conn = RunConn::acquire(&pool).await?;
        let fetched = self.explain_on(&mut conn, database, schema, text, analyze, run).await;
        // Unregister BEFORE the connection returns to the pool, so a late
        // Stop can never hit a later query that reused this backend.
        if let Some(run) = run {
            run.finish().await;
        }
        conn.release(conn_reusable(&fetched));
        fetched
    }

    async fn explain_on(
        &self,
        conn: &mut PgConnection,
        database: Option<&str>,
        schema: Option<&str>,
        text: &str,
        analyze: bool,
        run: Option<&RunHandle>,
    ) -> DbResult<Value> {
        if let Some(run) = run {
            if !self.arm_stop(conn, database, run).await? {
                // Stop already arrived: never start the statement.
                return Err(DbError::Cancelled);
            }
        }
        let engine_error = |e: sqlx::Error| match run {
            Some(run) => pg_run_error(e, run),
            None => DbError::SqlEngine(e),
        };
        // A plain estimate with no target schema needs no transaction, which
        // saves two round trips on a remote database.
        if !analyze && schema.is_none() {
            return sqlx::query_scalar::<_, Value>(text).fetch_one(&mut *conn).await.map_err(engine_error);
        }
        // A target schema resolves names through a transaction local
        // `search_path` (as `run_sql` does). Analyze needs the transaction
        // for the rollback. It is rolled back on every path, so nothing the
        // statement did can stay committed.
        let mut tx = conn.begin().await.map_err(&engine_error)?;
        let fetched = match schema {
            None => sqlx::query_scalar::<_, Value>(text).fetch_one(&mut *tx).await,
            Some(schema) => match sqlx::query(&format!("SET LOCAL search_path = {}", q(schema)))
                .execute(&mut *tx)
                .await
            {
                Ok(_) => sqlx::query_scalar::<_, Value>(text).fetch_one(&mut *tx).await,
                Err(e) => Err(e),
            },
        };
        if let Err(e) = tx.rollback().await {
            // The connection is dropped, which aborts the transaction on the
            // server, but the user must not be told the statement was undone
            // when we could not confirm it.
            return Err(DbError::InvalidOperation(format!(
                "Explain could not confirm its rollback ({e}). The connection was closed, which ends the transaction."
            )));
        }
        fetched.map_err(engine_error)
    }
}

/// The message the Plan tab shows for a failed explain.
fn failure_text(e: DbError) -> String {
    let message = e.to_string();
    // serde_json refuses to read JSON nested past 128 levels.
    if message.contains("recursion limit") { TOO_DEEP.to_string() } else { message }
}
