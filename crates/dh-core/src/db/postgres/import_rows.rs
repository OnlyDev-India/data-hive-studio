use std::collections::HashMap;
use sqlx::postgres::PgDatabaseError;
use sqlx::Acquire;
use crate::api::{ImportReport, ImportRequest, RowFailure};
use crate::db::import::{batch_size, cell_text, single_create_table, sql_rows, summary_line, Tally};
use crate::db::{DbError, DbResult};
use super::sql_text::{q, qualify_regclass, tq};
use super::PgAdapter;

/// PostgreSQL allows 65,535 bound values in one statement.
const MAX_BOUND: usize = 60_000;

impl PgAdapter {
    /// Write an import as ONE transaction (spec 0008). Rows go in as multi row
    /// INSERTs inside savepoints; a failed batch is rolled back to its
    /// savepoint and split until each bad row is found. Every bound value is
    /// cast to its column type (`$n::type`) so text binds coerce. A constraint
    /// deferred to commit that fails aborts the whole import with the database
    /// message and writes nothing.
    pub(super) async fn import_rows(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        req: &ImportRequest,
    ) -> DbResult<ImportReport> {
        self.guard.check_write("import")?;
        let data = sql_rows(req)?;
        let create = req.create_sql.as_deref().map(single_create_table).transpose()?;

        let pool = self.pool_for(database).await?;
        let schema = schema.map(str::to_string).unwrap_or_else(|| self.cur_schema());
        let mut conn = pool.acquire().await.map_err(DbError::SqlEngine)?;
        let mut tx = conn.begin().await.map_err(DbError::SqlEngine)?;

        // Same transaction local search_path as the DDL path, so an unqualified
        // CREATE TABLE lands in the target schema and the pool stays clean.
        let path = format!("SET LOCAL search_path = {}", q(&schema));
        sqlx::query(&path).execute(&mut *tx).await.map_err(DbError::SqlEngine)?;
        let mut statements = Vec::new();
        if let Some(sql) = create {
            sqlx::query(sql).execute(&mut *tx).await.map_err(DbError::SqlEngine)?;
            statements.push(sql.to_string());
        }

        // Read the types on this transaction: the pool cannot see a table
        // that is not committed yet.
        let types = column_types(&mut tx, &schema, &req.table).await?;
        if types.is_empty() {
            return Err(DbError::InvalidOperation(format!(
                "table \"{}\" does not exist in schema \"{schema}\"",
                req.table
            )));
        }
        let casts: Vec<String> = data
            .columns
            .iter()
            .map(|c| types.get(c).map(|t| format!("::{t}")).unwrap_or_default())
            .collect();

        let cols = data.columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
        let head = format!("INSERT INTO {} ({cols}) VALUES ", tq(&schema, &req.table));
        let step = batch_size(data.columns.len(), MAX_BOUND);
        let mut tally = Tally::new(req);

        // Ranges still to try; a failed range is split, first half on top so
        // failures come out in file order.
        let mut todo: Vec<(usize, usize)> = (0..data.rows.len())
            .step_by(step)
            .rev()
            .map(|s| (s, (s + step).min(data.rows.len())))
            .collect();

        while let Some((start, end)) = todo.pop() {
            if tally.should_stop() {
                break;
            }
            let rows = &data.rows[start..end];
            match insert_batch(&mut tx, &head, &casts, rows).await {
                Ok(()) => tally.inserted += rows.len() as u64,
                Err(e) if rows.len() == 1 => {
                    let (column, message) = describe(&e);
                    tally.fail(RowFailure { index: start as u32, column, message });
                }
                Err(_) => {
                    let mid = start + (end - start) / 2;
                    todo.push((mid, end));
                    todo.push((start, mid));
                }
            }
        }

        let commit = tally.should_commit();
        if commit {
            tx.commit().await.map_err(DbError::SqlEngine)?;
        } else {
            tx.rollback().await.map_err(DbError::SqlEngine)?;
        }
        statements.push(summary_line(&req.table, data.columns, data.rows.len()));
        Ok(tally.into_report(commit, true, statements))
    }
}

/// Column name to full type (`numeric(10,2)`, `text[]`, an enum's own name),
/// read on the import's own transaction. `format_type` keeps the length and
/// precision, so a value that does not fit becomes a bad row.
async fn column_types(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    schema: &str,
    table: &str,
) -> DbResult<HashMap<String, String>> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT a.attname::text, format_type(a.atttypid, a.atttypmod) \
         FROM pg_attribute a \
         WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped",
    )
    .bind(qualify_regclass(schema, table))
    .fetch_all(&mut **tx)
    .await
    .map_err(DbError::SqlEngine)?;
    Ok(rows.into_iter().collect())
}

/// One multi row INSERT inside a savepoint. A failed statement aborts the
/// transaction until the savepoint is rolled back, so that always happens
/// before the error is returned.
async fn insert_batch(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    head: &str,
    casts: &[String],
    rows: &[Vec<serde_json::Value>],
) -> Result<(), sqlx::Error> {
    let width = casts.len();
    let mut n = 0;
    let groups: Vec<String> = rows
        .iter()
        .map(|_| {
            let cells: Vec<String> = casts
                .iter()
                .map(|cast| {
                    n += 1;
                    format!("${n}{cast}")
                })
                .collect();
            format!("({})", cells.join(", "))
        })
        .collect();
    debug_assert_eq!(n, width * rows.len());
    let sql = format!("{head}{}", groups.join(", "));

    sqlx::query("SAVEPOINT import_batch").execute(&mut **tx).await?;
    let mut query = sqlx::query(&sql);
    for row in rows {
        for cell in row {
            query = query.bind(cell_text(cell));
        }
    }
    match query.execute(&mut **tx).await {
        Ok(_) => {
            sqlx::query("RELEASE SAVEPOINT import_batch").execute(&mut **tx).await?;
            Ok(())
        }
        Err(e) => {
            sqlx::query("ROLLBACK TO SAVEPOINT import_batch").execute(&mut **tx).await?;
            sqlx::query("RELEASE SAVEPOINT import_batch").execute(&mut **tx).await?;
            Err(e)
        }
    }
}

/// The failing column (when Postgres names one) and the database's message.
fn describe(e: &sqlx::Error) -> (Option<String>, String) {
    match e.as_database_error() {
        Some(d) => {
            let column = d
                .try_downcast_ref::<PgDatabaseError>()
                .and_then(|p| p.column())
                .map(str::to_string);
            (column, d.message().to_string())
        }
        None => (None, e.to_string()),
    }
}
