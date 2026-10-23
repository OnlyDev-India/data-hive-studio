//! Import into MySQL and MariaDB (spec 0025 AC-21, spec 0008): prepared
//! multi row `INSERT` chunks inside one transaction, each chunk under the
//! server's `max_allowed_packet` and the 65,535 placeholder cap, so no
//! server setting such as `local_infile` is needed. Cells follow the same
//! binding rules as grid edits: bytes columns take `0x` hex or UTF-8 bytes,
//! `BIT` columns take the number their `b'...'` text spells.

use serde_json::Value;
use sqlx::mysql::MySqlDatabaseError;
use sqlx::{Executor as _, MySqlConnection};
use crate::api::{ImportReport, ImportRequest, RowFailure};
use crate::db::import::{cell_text, single_create_table, sql_rows, summary_line, Tally, BATCH_ROWS};
use crate::db::{DbError, DbResult};
use super::MySqlAdapter;
use super::bytes::{bind_value, bit_slot, table_columns, Param, TableColumns};
use super::rows::{bind_all, fetch_text_conn};
use super::sql_text::{q, tq};

/// MySQL allows 65,535 placeholders in one prepared statement.
const MAX_PLACEHOLDERS: usize = 65_535;

/// Bytes one bound value costs in the execute packet beyond its own
/// length: its type (2), its length prefix (up to 9) and its NULL bit.
const PARAM_OVERHEAD: usize = 12;

/// Room left in each packet for the statement header and anything the
/// estimate misses.
const PACKET_MARGIN: usize = 4096;

impl MySqlAdapter {
    /// Write an import as one transaction. A failed chunk is rolled back to
    /// its savepoint and split until each bad row is found. A `CREATE TABLE`
    /// commits on its own in MySQL, so it runs before the transaction, and
    /// the new table is dropped again when the import doesn't commit, so a
    /// rollback still leaves nothing behind.
    pub(super) async fn import_rows(&self, database: Option<&str>, req: &ImportRequest) -> DbResult<ImportReport> {
        self.guard.check_write("import")?;
        let data = sql_rows(req)?;
        let create = req.create_sql.as_deref().map(single_create_table).transpose()?;

        let db = self.target(database);
        let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
        if let Some(db) = db {
            (&mut *conn).execute(format!("USE {}", q(db)).as_str()).await.map_err(DbError::SqlEngine)?;
        }
        let mut statements = Vec::new();
        if let Some(sql) = create {
            (&mut *conn).execute(sql).await.map_err(DbError::SqlEngine)?;
            statements.push(sql.to_string());
        }

        let written = self.write_rows(&mut conn, db, req, &data, statements).await;
        let keep = matches!(&written, Ok(r) if r.committed);
        if create.is_some() && !keep {
            let drop = format!("DROP TABLE IF EXISTS {}", tq(db, &req.table));
            if let Err(e) = (&mut *conn).execute(drop.as_str()).await {
                log::warn!("mysql import could not drop the table it created: {e}");
            }
        }
        written
    }

    async fn write_rows(
        &self,
        conn: &mut MySqlConnection,
        db: Option<&str>,
        req: &ImportRequest,
        data: &crate::db::import::SqlRows<'_>,
        mut statements: Vec<String>,
    ) -> DbResult<ImportReport> {
        // Read once at import start, on this connection, after `USE`.
        let Some(cols) = table_columns(conn, &req.table).await else {
            return Err(DbError::InvalidOperation(format!(
                "table `{}` does not exist in this database",
                req.table
            )));
        };
        let packet = max_allowed_packet(conn).await?;
        let names = data.columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
        let head = format!("INSERT INTO {} ({names}) VALUES ", tq(db, &req.table));
        let rows: Vec<Vec<Cell>> = data.rows.iter().map(|r| cells(&cols, data.columns, r)).collect();
        let mut tally = Tally::new(req);

        // Ranges still to try; a failed range is split, first half on top so
        // failures come out in file order.
        let mut todo = chunks(&rows, head.len(), packet);
        todo.reverse();

        (&mut *conn).execute("START TRANSACTION").await.map_err(DbError::SqlEngine)?;
        let walked: DbResult<()> = async {
            while let Some((start, end)) = todo.pop() {
                if tally.should_stop() {
                    break;
                }
                match insert_chunk(conn, &head, &rows[start..end]).await? {
                    Ok(()) => tally.inserted += (end - start) as u64,
                    Err(e) if end - start == 1 => {
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
            Ok(())
        }
        .await;
        if let Err(e) = walked {
            let _ = (&mut *conn).execute("ROLLBACK").await;
            return Err(e);
        }

        let commit = tally.should_commit();
        let end = if commit { "COMMIT" } else { "ROLLBACK" };
        (&mut *conn).execute(end).await.map_err(DbError::SqlEngine)?;
        statements.push(summary_line(&req.table, data.columns, data.rows.len()));
        Ok(tally.into_report(commit, true, statements))
    }
}

/// One cell ready to bind: its placeholder and parameter.
#[derive(Debug, PartialEq)]
struct Cell {
    mark: &'static str,
    param: Param,
}

impl Cell {
    /// Bytes this cell adds to the execute packet.
    fn cost(&self) -> usize {
        let len = match &self.param {
            Param::Text(Some(t)) => t.len(),
            Param::Text(None) => 0,
            Param::Bytes(b) => b.len(),
        };
        len + PARAM_OVERHEAD
    }
}

/// A row's cells under the edit binding rules: a `BIT` column binds the
/// number its text spells (else the text as typed, so the server's error
/// names the bad row), a bytes column binds `0x` hex or UTF-8 bytes, and
/// everything else binds its text.
fn cells(cols: &TableColumns, names: &[String], row: &[Value]) -> Vec<Cell> {
    names
        .iter()
        .zip(row)
        .map(|(name, v)| {
            let text = cell_text(v);
            match &text {
                Some(t) if cols.is_bit(name) => {
                    let (mark, number) = bit_slot(t);
                    Cell { mark, param: Param::Text(Some(number)) }
                }
                _ => Cell { mark: "?", param: bind_value(&text, cols.is_bytes(name)) },
            }
        })
        .collect()
}

/// Split the rows into chunks so each `INSERT` stays under the packet
/// limit (both its prepared text and its bound values) and the placeholder
/// cap, and holds at most [`BATCH_ROWS`] rows. A row too big on its own
/// gets a chunk of its own; the server's error then names it as a bad row.
fn chunks(rows: &[Vec<Cell>], head_len: usize, packet: usize) -> Vec<(usize, usize)> {
    let budget = packet.saturating_sub(PACKET_MARGIN).max(1);
    let mut out = Vec::new();
    let mut start = 0;
    let (mut values, mut text, mut slots) = (0usize, head_len, 0usize);
    for (i, row) in rows.iter().enumerate() {
        let row_values: usize = row.iter().map(Cell::cost).sum();
        let row_text: usize = row.iter().map(|c| c.mark.len() + 2).sum::<usize>() + 4;
        let full = i > start
            && (i - start >= BATCH_ROWS
                || slots + row.len() > MAX_PLACEHOLDERS
                || values + row_values > budget
                || text + row_text > budget);
        if full {
            out.push((start, i));
            start = i;
            (values, text, slots) = (0, head_len, 0);
        }
        values += row_values;
        text += row_text;
        slots += row.len();
    }
    if start < rows.len() {
        out.push((start, rows.len()));
    }
    out
}

/// `@@max_allowed_packet` for this session.
async fn max_allowed_packet(conn: &mut MySqlConnection) -> DbResult<usize> {
    let rows = fetch_text_conn(conn, "SELECT @@max_allowed_packet", &[]).await?;
    Ok(rows
        .first()
        .and_then(|r| r.first().cloned().flatten())
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(4 * 1024 * 1024))
}

/// One multi row `INSERT` inside a savepoint. The outer error is fatal (the
/// savepoint itself failed, say after a deadlock rolled the whole
/// transaction back), the inner one is a bad chunk to split.
async fn insert_chunk(
    conn: &mut MySqlConnection,
    head: &str,
    rows: &[Vec<Cell>],
) -> DbResult<Result<(), sqlx::Error>> {
    let groups: Vec<String> = rows
        .iter()
        .map(|r| format!("({})", r.iter().map(|c| c.mark).collect::<Vec<_>>().join(", ")))
        .collect();
    let sql = format!("{head}{}", groups.join(", "));
    let params: Vec<Param> = rows.iter().flatten().map(|c| c.param.clone()).collect();

    (&mut *conn).execute("SAVEPOINT import_batch").await.map_err(DbError::SqlEngine)?;
    // Not cached: every chunk shape is a new statement, and a long import
    // must not fill the server's prepared statement limit.
    match bind_all(&sql, &params).persistent(false).execute(&mut *conn).await {
        Ok(_) => {
            (&mut *conn).execute("RELEASE SAVEPOINT import_batch").await.map_err(DbError::SqlEngine)?;
            Ok(Ok(()))
        }
        Err(e) => {
            (&mut *conn).execute("ROLLBACK TO SAVEPOINT import_batch").await.map_err(DbError::SqlEngine)?;
            (&mut *conn).execute("RELEASE SAVEPOINT import_batch").await.map_err(DbError::SqlEngine)?;
            Ok(Err(e))
        }
    }
}

/// The failing column (when the message names one) and the server's
/// message with its error code.
fn describe(e: &sqlx::Error) -> (Option<String>, String) {
    match e.as_database_error().and_then(|d| d.try_downcast_ref::<MySqlDatabaseError>()) {
        Some(d) => (column_in(d.message()), format!("{} ({})", d.message(), d.number())),
        None => (None, e.to_string()),
    }
}

/// The column a MySQL message names: `Column 'x' cannot be null`,
/// `Data too long for column 'x' at row 1`, `Incorrect integer value: 'a'
/// for column 'x' at row 1`.
fn column_in(msg: &str) -> Option<String> {
    let at = msg.to_ascii_lowercase().rfind("column '")? + "column '".len();
    let rest = &msg[at..];
    let name = &rest[..rest.find('\'')?];
    (!name.is_empty()).then(|| name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashSet;

    fn cols() -> TableColumns {
        TableColumns {
            bytes: HashSet::from(["raw".to_string()]),
            bits: HashSet::from(["b".to_string()]),
            ..TableColumns::default()
        }
    }

    fn names(n: &[&str]) -> Vec<String> {
        n.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn cells_follow_the_bytes_and_bit_rules() {
        let row = [json!("0xDEAD"), json!("b'0101'"), json!(7), json!(null), json!("abc")];
        let got = cells(&cols(), &names(&["raw", "B", "n", "note", "b"]), &row);
        assert_eq!(got[0], Cell { mark: "?", param: Param::Bytes(vec![0xDE, 0xAD]) });
        assert_eq!(got[1], Cell { mark: "CAST(? AS UNSIGNED)", param: Param::Text(Some("5".into())) });
        assert_eq!(got[2], Cell { mark: "?", param: Param::Text(Some("7".into())) });
        assert_eq!(got[3], Cell { mark: "?", param: Param::Text(None) });
        // A BIT cell that spells no number goes as typed.
        assert_eq!(got[4], Cell { mark: "?", param: Param::Text(Some("abc".into())) });
        // Text typed into a bytes column binds its UTF-8 bytes.
        let raw = cells(&cols(), &names(&["raw"]), &[json!("hi")]);
        assert_eq!(raw[0].param, Param::Bytes(b"hi".to_vec()));
    }

    fn rows(n: usize, width: usize, text: &str) -> Vec<Vec<Cell>> {
        (0..n)
            .map(|_| (0..width).map(|_| Cell { mark: "?", param: Param::Text(Some(text.into())) }).collect())
            .collect()
    }

    #[test]
    fn chunks_stop_at_the_row_cap() {
        let all = rows(2500, 2, "a");
        assert_eq!(chunks(&all, 30, 64 << 20), vec![(0, 1000), (1000, 2000), (2000, 2500)]);
    }

    #[test]
    fn chunks_stay_under_the_placeholder_cap() {
        let all = rows(200, 400, "");
        let got = chunks(&all, 30, 1 << 30);
        assert!(got.iter().all(|(s, e)| (e - s) * 400 <= MAX_PLACEHOLDERS), "{got:?}");
        assert_eq!(got[0], (0, MAX_PLACEHOLDERS / 400));
    }

    #[test]
    fn chunks_stay_under_the_packet_limit() {
        let big = "x".repeat(10_000);
        let all = rows(100, 1, &big);
        let packet = 64 * 1024;
        let got = chunks(&all, 30, packet);
        for (s, e) in &got {
            let bytes: usize = all[*s..*e].iter().flatten().map(Cell::cost).sum();
            assert!(bytes <= packet - PACKET_MARGIN, "{s}..{e} is {bytes}");
        }
        assert_eq!(got.iter().map(|(s, e)| e - s).sum::<usize>(), 100);
        assert_eq!(got[0], (0, 6));
    }

    #[test]
    fn a_row_bigger_than_the_packet_gets_a_chunk_of_its_own() {
        let mut all = rows(1, 1, "a");
        all.extend(rows(1, 1, &"x".repeat(100_000)));
        all.extend(rows(1, 1, "a"));
        assert_eq!(chunks(&all, 30, 64 * 1024), vec![(0, 1), (1, 2), (2, 3)]);
        assert_eq!(chunks(&[], 30, 1024), vec![]);
    }

    #[test]
    fn the_failing_column_is_read_from_the_message() {
        assert_eq!(column_in("Column 'email' cannot be null").as_deref(), Some("email"));
        assert_eq!(column_in("Data too long for column 'name' at row 1").as_deref(), Some("name"));
        assert_eq!(
            column_in("Incorrect integer value: 'a' for column 'n' at row 1").as_deref(),
            Some("n")
        );
        assert_eq!(column_in("Duplicate entry '1' for key 't.PRIMARY'"), None);
    }
}
