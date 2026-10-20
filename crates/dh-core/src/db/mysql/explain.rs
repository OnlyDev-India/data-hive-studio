//! Explain on MySQL and MariaDB (spec 0025 AC-25). An estimate is
//! `EXPLAIN FORMAT=JSON` on both flavors and never runs the statement.
//! Analyze runs it: MySQL `EXPLAIN ANALYZE` (8.0.18 and newer) or MariaDB
//! `ANALYZE FORMAT=JSON`, always inside a transaction that is rolled back,
//! also on error and Stop.

use std::time::Instant;
use sqlx::{Executor as _, MySqlConnection, Row as _};
use crate::api::{PlanDialect, PlanMode, PlanResult};
use crate::db::explain::{check_statement, finish, mysql::{plan_from_json, plan_from_tree}};
use crate::db::read_only::Dialect;
use crate::db::runs::until_abandoned;
use crate::db::{DbError, DbResult, RunHandle};
use super::MySqlAdapter;
use super::cancel::{conn_reusable, run_error, RunConn};
use super::connect::Flavor;
use super::sql_text::q;

/// The first MySQL release with `EXPLAIN ANALYZE`.
const MYSQL_ANALYZE_FLOOR: (u16, u16, u16) = (8, 0, 18);

/// `ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION`: the session's `READ ONLY`
/// refuses even an estimate of a write.
const READ_ONLY_SESSION: u16 = 1792;

/// What an explain call sends, and how its answer reads.
#[derive(Debug, PartialEq)]
enum Ask {
    Json(String),
    Tree(String),
}

impl MySqlAdapter {
    pub(super) async fn explain_sql(
        &self,
        database: Option<&str>,
        sql: &str,
        analyze: bool,
        run: Option<&RunHandle>,
    ) -> PlanResult {
        let mode = if analyze { PlanMode::Analyze } else { PlanMode::Estimate };
        let dialect = match self.server.flavor {
            Flavor::Mysql => PlanDialect::Mysql,
            Flavor::Mariadb => PlanDialect::Mariadb,
        };
        let statement = sql.trim();
        let fail = |message: String| PlanResult::failed(dialect, mode, statement, message);
        let sent = match check_statement(Dialect::Mysql, sql) {
            Ok(sent) => sent,
            Err(message) => return PlanResult::unsupported(dialect, mode, statement, message),
        };
        let ask = match ask_for(self.server.flavor, self.server.version, &sent, analyze) {
            Ok(ask) => ask,
            Err(message) => return PlanResult::unsupported(dialect, mode, statement, message),
        };
        // Before a canceller is armed, so a refused statement never becomes
        // a run Stop could reach. An estimate reads nothing, so it is allowed
        // on a read only connection whatever the statement is.
        if analyze {
            if let Err(refusal) = self.guard.check_sql(Dialect::Mysql, &sent) {
                return fail(refusal.to_string());
            }
        }
        let start = Instant::now();
        let fetched = until_abandoned(run, self.fetch_plan(database, &ask, analyze, run)).await;
        let elapsed_ms = start.elapsed().as_millis() as u64;
        let parsed = match fetched {
            Ok(output) => match ask {
                Ask::Json(_) => plan_from_json(&output),
                Ask::Tree(_) => Ok(plan_from_tree(&output)),
            },
            Err(DbError::Cancelled) => return PlanResult::stopped(dialect, mode, statement, elapsed_ms),
            Err(e) if is_read_only_session(&e) => Err(
                "This is a read only connection, and the server won't explain a statement that changes data on it, \
                 not even as an estimate."
                    .to_string(),
            ),
            Err(e) => Err(self.guard.refine(e).to_string()),
        };
        match parsed {
            Ok(tops) => {
                let (root, truncated) = finish(tops);
                PlanResult::planned(dialect, mode, statement, root, truncated, elapsed_ms)
            }
            Err(message) => fail(message),
        }
    }

    /// Runs the explain on a connection of its own and returns its one text
    /// cell. The connection is the run's, so Stop has a thread to kill; it
    /// goes back to the pool only when the server answered.
    async fn fetch_plan(
        &self,
        database: Option<&str>,
        ask: &Ask,
        analyze: bool,
        run: Option<&RunHandle>,
    ) -> DbResult<String> {
        let mut conn = RunConn::acquire(&self.pool).await?;
        let fetched = self.explain_on(&mut conn, database, ask, analyze, run).await;
        // Unregister BEFORE the connection returns to the pool, so a late
        // kill can never hit a later query on the same connection.
        if let Some(run) = run {
            run.finish().await;
        }
        conn.release(conn_reusable(&fetched));
        fetched
    }

    async fn explain_on(
        &self,
        conn: &mut MySqlConnection,
        database: Option<&str>,
        ask: &Ask,
        analyze: bool,
        run: Option<&RunHandle>,
    ) -> DbResult<String> {
        if let Some(db) = self.target(database) {
            (&mut *conn).execute(format!("USE {}", q(db)).as_str()).await.map_err(DbError::SqlEngine)?;
        }
        if let Some(run) = run {
            if !self.arm_stop(conn, run).await? {
                // Stop already arrived: never start the statement.
                return Err(DbError::Cancelled);
            }
        }
        let text = match ask {
            Ask::Json(t) | Ask::Tree(t) => t.as_str(),
        };
        if !analyze {
            return one_cell(conn, text).await.map_err(|e| run_error(e, run));
        }
        // Analyze runs the statement, so it runs in a transaction that is
        // rolled back on every path: nothing it did can stay committed.
        (&mut *conn).execute("START TRANSACTION").await.map_err(DbError::SqlEngine)?;
        let fetched = one_cell(conn, text).await;
        if let Err(e) = (&mut *conn).execute("ROLLBACK").await {
            // The connection is detached, which aborts the transaction on
            // the server, but the user must not be told the statement was
            // undone when we could not confirm it.
            return Err(DbError::InvalidOperation(format!(
                "Explain could not confirm its rollback ({e}). The connection was closed, which ends the transaction."
            )));
        }
        fetched.map_err(|e| run_error(e, run))
    }
}

fn is_read_only_session(e: &DbError) -> bool {
    matches!(e, DbError::SqlEngine(err) if err
        .as_database_error()
        .and_then(|d| d.try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>())
        .is_some_and(|d| d.number() == READ_ONLY_SESSION))
}

/// The explain text to send. MySQL older than 8.0.18 has no `EXPLAIN
/// ANALYZE`, which comes back as the message the Plan tab shows.
fn ask_for(flavor: Flavor, version: (u16, u16, u16), sent: &str, analyze: bool) -> Result<Ask, String> {
    match (analyze, flavor) {
        (false, _) => Ok(Ask::Json(format!("EXPLAIN FORMAT=JSON {sent}"))),
        (true, Flavor::Mariadb) => Ok(Ask::Json(format!("ANALYZE FORMAT=JSON {sent}"))),
        (true, Flavor::Mysql) if version < MYSQL_ANALYZE_FLOOR => {
            let (a, b, c) = version;
            Err(format!(
                "Explain Analyze needs MySQL 8.0.18 or newer, and this server is MySQL {a}.{b}.{c}. Explain (estimate) still works."
            ))
        }
        (true, Flavor::Mysql) => Ok(Ask::Tree(format!("EXPLAIN ANALYZE {sent}"))),
    }
}

/// The first cell of the answer, over the text protocol (the explain
/// statements can't all be prepared). Every row is read, so the connection
/// is clean afterwards.
async fn one_cell(conn: &mut MySqlConnection, text: &str) -> Result<String, sqlx::Error> {
    let rows = (&mut *conn).fetch_all(text).await?;
    let cell = rows
        .first()
        .and_then(|r| r.try_get_unchecked::<&[u8], _>(0).ok())
        .map(|b| String::from_utf8_lossy(b).into_owned());
    Ok(cell.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_flavor_and_mode_sends_its_own_explain() {
        let (my, maria) = (Flavor::Mysql, Flavor::Mariadb);
        assert_eq!(ask_for(my, (8, 4, 3), "SELECT 1", false), Ok(Ask::Json("EXPLAIN FORMAT=JSON SELECT 1".into())));
        assert_eq!(ask_for(maria, (11, 4, 4), "SELECT 1", false), Ok(Ask::Json("EXPLAIN FORMAT=JSON SELECT 1".into())));
        assert_eq!(ask_for(maria, (10, 6, 0), "DELETE FROM t", true), Ok(Ask::Json("ANALYZE FORMAT=JSON DELETE FROM t".into())));
        assert_eq!(ask_for(my, (8, 0, 18), "SELECT 1", true), Ok(Ask::Tree("EXPLAIN ANALYZE SELECT 1".into())));
    }

    #[test]
    fn old_mysql_names_its_version_for_analyze() {
        let msg = ask_for(Flavor::Mysql, (8, 0, 17), "SELECT 1", true).unwrap_err();
        assert!(msg.contains("8.0.18") && msg.contains("MySQL 8.0.17"), "{msg}");
        assert!(ask_for(Flavor::Mysql, (8, 0, 17), "SELECT 1", false).is_ok());
    }
}
