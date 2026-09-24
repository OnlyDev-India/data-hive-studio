use sqlx::Acquire;
use crate::api::{ImportReport, ImportRequest, RowFailure};
use crate::db::import::{batch_size, cell_text, column_from_message, sql_rows, single_create_table, summary_line, Tally};
use crate::db::{DbError, DbResult};
use super::schema_ops::quote_ident;
use super::SqliteAdapter;

/// SQLite's default cap on bound values in one statement is 32,766.
const MAX_BOUND: usize = 30_000;

impl SqliteAdapter {
    /// Write an import as ONE transaction (spec 0008). Rows go in as multi row
    /// INSERTs, each inside a savepoint. A failed batch is rolled back to its
    /// savepoint and split in halves until each bad row is found, so one pass
    /// lists every failure. At the end the transaction commits or rolls back
    /// as a whole, so a rolled back import changes nothing.
    pub async fn import_rows(&self, req: &ImportRequest) -> DbResult<ImportReport> {
        self.guard.check_write("import")?;
        let data = sql_rows(req)?;
        let create = req.create_sql.as_deref().map(single_create_table).transpose()?;

        let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
        let mut tx = conn.begin().await.map_err(DbError::SqlEngine)?;
        let mut statements = Vec::new();
        // The new table is made on the same transaction as the rows, so a
        // rolled back or checked import leaves no table behind (AC-12).
        if let Some(sql) = create {
            sqlx::query(sql).execute(&mut *tx).await.map_err(DbError::SqlEngine)?;
            statements.push(sql.to_string());
        }
        let mut tally = Tally::new(req);

        let cols = data.columns.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", ");
        let head = format!("INSERT INTO {} ({cols}) VALUES ", quote_ident(&req.table));
        let step = batch_size(data.columns.len(), MAX_BOUND);

        // Ranges still to try. A failed range is split and its halves are
        // pushed back, first half on top so failures come out in file order.
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
            match insert_batch(&mut tx, &head, rows).await {
                Ok(()) => tally.inserted += rows.len() as u64,
                Err(e) if rows.len() == 1 => {
                    let message = db_message(&e);
                    tally.fail(RowFailure {
                        index: start as u32,
                        column: column_from_message(&message),
                        message,
                    });
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

/// One multi row INSERT inside a savepoint. On error the savepoint is rolled
/// back and released so the transaction stays usable.
async fn insert_batch(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    head: &str,
    rows: &[Vec<serde_json::Value>],
) -> Result<(), sqlx::Error> {
    let width = rows.first().map_or(0, |r| r.len());
    let group = format!("({})", vec!["?"; width].join(", "));
    let sql = format!("{head}{}", vec![group.as_str(); rows.len()].join(", "));

    sqlx::query("SAVEPOINT import_batch").execute(&mut **tx).await?;
    let mut q = sqlx::query(&sql);
    for row in rows {
        for cell in row {
            q = q.bind(cell_text(cell));
        }
    }
    match q.execute(&mut **tx).await {
        Ok(_) => {
            sqlx::query("RELEASE import_batch").execute(&mut **tx).await?;
            Ok(())
        }
        Err(e) => {
            sqlx::query("ROLLBACK TO import_batch").execute(&mut **tx).await?;
            sqlx::query("RELEASE import_batch").execute(&mut **tx).await?;
            Err(e)
        }
    }
}

fn db_message(e: &sqlx::Error) -> String {
    e.as_database_error()
        .map(|d| d.message().to_string())
        .unwrap_or_else(|| e.to_string())
}
