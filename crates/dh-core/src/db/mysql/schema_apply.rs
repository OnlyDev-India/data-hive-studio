//! Runs the schema designer's plan (spec 0025 AC-19). MySQL commits each
//! DDL statement as it runs, so the batch is not atomic: statements run in
//! order and the first failure stops it. Every statement is reported as
//! applied, failed (with the server's message) or not run. Nothing is
//! retried or undone.

use std::collections::HashMap;
use sqlx::Executor as _;
use sqlx::mysql::MySqlConnection;
use crate::api::{SchemaApplyReport, SchemaOp, StatementOutcome, StatementStatus};
use crate::db::{DbError, DbResult};
use super::MySqlAdapter;
use super::catalog::col;
use super::rows::fetch_text_conn;
use super::schema_plan::{plan, tables_to_read, CurrentColumn, TableState};
use super::sql_text::q;

async fn table_state(conn: &mut MySqlConnection, db: &str, table: &str) -> DbResult<TableState> {
    let cols = fetch_text_conn(
        conn,
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT, COLLATION_NAME \
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
        &[db, table],
    )
    .await?;
    let pk = fetch_text_conn(
        conn,
        "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'PRIMARY KEY'",
        &[db, table],
    )
    .await?;
    Ok(TableState {
        columns: cols
            .iter()
            .map(|r| {
                (
                    col(r, 0),
                    CurrentColumn {
                        column_type: col(r, 1),
                        nullable: col(r, 2) == "YES",
                        default: r.get(3).cloned().flatten(),
                        extra: col(r, 4),
                        comment: col(r, 5),
                        collation: r.get(6).cloned().flatten(),
                    },
                )
            })
            .collect(),
        has_primary_key: !pk.is_empty(),
    })
}

impl MySqlAdapter {
    /// A connection on `database`, and the statements `ops` plan into there.
    async fn planned(
        &self,
        database: Option<&str>,
        ops: &[SchemaOp],
    ) -> DbResult<(sqlx::pool::PoolConnection<sqlx::MySql>, Vec<String>)> {
        let db = self.require_target(database)?.to_string();
        let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
        let mut states = HashMap::new();
        for table in tables_to_read(ops) {
            let state = table_state(&mut conn, &db, &table).await?;
            states.insert(table, state);
        }
        let statements = plan(self.server.flavor, Some(&db), ops, &states)?;
        // Unqualified names inside a trigger body resolve in this database.
        (&mut *conn).execute(format!("USE {}", q(&db)).as_str()).await.map_err(DbError::SqlEngine)?;
        Ok((conn, statements))
    }

    /// The exact statements Apply would run, for the review dialog. Runs
    /// nothing but the catalog reads.
    pub(super) async fn plan_schema_ops(&self, database: Option<&str>, ops: &[SchemaOp]) -> DbResult<Vec<String>> {
        Ok(self.planned(database, ops).await?.1)
    }

    pub(super) async fn apply_schema_ops_report(
        &self,
        database: Option<&str>,
        ops: &[SchemaOp],
    ) -> DbResult<SchemaApplyReport> {
        if ops.is_empty() {
            return Ok(SchemaApplyReport::default());
        }
        self.guard.check_write("schema changes")?;
        let (mut conn, statements) = self.planned(database, ops).await?;
        let mut report = SchemaApplyReport::default();
        let mut stopped = false;
        for sql in statements {
            let (status, message) = if stopped {
                (StatementStatus::NotRun, None)
            } else {
                match (&mut *conn).execute(sql.as_str()).await {
                    Ok(_) => (StatementStatus::Applied, None),
                    Err(e) => {
                        stopped = true;
                        (StatementStatus::Failed, Some(DbError::SqlEngine(e).to_string()))
                    }
                }
            };
            report.statements.push(StatementOutcome { sql, status, message });
        }
        Ok(report)
    }

    /// The older all or nothing shape the compare tab and the team server's
    /// first callers read: the applied statements, or the failure as an
    /// error that names what already landed.
    pub(super) async fn apply_schema_ops_batch(&self, database: Option<&str>, ops: &[SchemaOp]) -> DbResult<Vec<String>> {
        let report = self.apply_schema_ops_report(database, ops).await?;
        match report.failed() {
            None => Ok(report.applied()),
            Some(failed) => {
                let applied = report.applied().len();
                Err(DbError::InvalidOperation(format!(
                    "{} ({applied} statement{} before it stay applied)",
                    failed.message.clone().unwrap_or_default(),
                    if applied == 1 { "" } else { "s" },
                )))
            }
        }
    }
}
