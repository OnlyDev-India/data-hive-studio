//! Grid writes on MySQL and MariaDB (spec 0025 AC-14): insert, update,
//! delete, bulk update and drop table, as prepared statements. Updates and
//! deletes match the full original row (no `LIMIT`), as SQLite and Postgres
//! do. Each write reads the table's columns from the catalog first, on the
//! same connection, for the binding rule for binary columns, the
//! `FLOAT`/`DOUBLE` match rule, and the BIT and JSON comparison rule.

use std::collections::BTreeMap;
use std::time::Instant;
use sqlx::Executor as _;
use crate::api::{QueryChunk, QueryOp, QueryResult};
use crate::db::stream::Collected;
use crate::db::{sql_literal, DbError, DbResult, OpOutcome};
use super::MySqlAdapter;
use super::bytes::{bind_value, bit_slot, table_columns, BytesRule, Param, TableColumns, JSON_SLOT};
use super::filters::where_clause;
use super::rows::{bind_all, hex};
use super::sql_text::{q, tq};
use super::stream::stream_statement;

/// One write: the SQL with `?` placeholders and its typed parameters.
#[derive(Debug, PartialEq)]
struct Built {
    sql: String,
    params: Vec<Param>,
}

impl Built {
    /// The statement with its values inlined, for the activity log only.
    /// Bytes show as a `0x` literal, which MySQL reads back as those bytes.
    fn display(&self) -> String {
        let mut out = String::with_capacity(self.sql.len());
        let mut params = self.params.iter();
        for c in self.sql.chars() {
            if c != '?' {
                out.push(c);
                continue;
            }
            match params.next() {
                Some(Param::Text(v)) => out.push_str(&sql_literal(v.as_deref())),
                Some(Param::Bytes(b)) => out.push_str(&hex(b)),
                None => out.push('?'),
            }
        }
        out.push(';');
        out
    }
}

/// A value written to `col` (insert, update, bulk update): its placeholder
/// and parameter. A `BIT` value goes in as the number its text spells; a
/// `JSON` value as plain text, which MySQL parses as JSON.
fn write_slot(cols: &TableColumns, col: &str, value: &Option<String>) -> (&'static str, Param) {
    match value {
        Some(text) if cols.is_bit(col) => {
            let (mark, number) = bit_slot(text);
            (mark, Param::Text(Some(number)))
        }
        _ => ("?", bind_value(value, cols.is_bytes(col))),
    }
}

/// The full row match. NULL compares with `IS NULL`. A `FLOAT` or `DOUBLE`
/// column compares its text form with the displayed text, so an
/// approximate value never makes its row unmatchable. A `BIT` column
/// compares the number its `b'...'` text spells, and a MySQL `JSON` column
/// compares JSON values. Everything else compares with `=`, binary columns
/// by the binding rule.
fn match_where(match_row: &BTreeMap<String, Option<String>>, cols: &TableColumns, params: &mut Vec<Param>) -> String {
    let parts: Vec<String> = match_row
        .iter()
        .map(|(col, val)| {
            let Some(text) = val else {
                return format!("{} IS NULL", q(col));
            };
            if cols.is_approx(col) {
                params.push(Param::Text(val.clone()));
                return format!("CAST({} AS CHAR) = ?", q(col));
            }
            let (mark, param) = if cols.is_json(col) {
                (JSON_SLOT, Param::Text(val.clone()))
            } else if cols.is_bit(col) {
                let (mark, number) = bit_slot(text);
                (mark, Param::Text(Some(number)))
            } else {
                ("?", bind_value(val, cols.is_bytes(col)))
            };
            params.push(param);
            format!("{} = {mark}", q(col))
        })
        .collect();
    if parts.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", parts.join(" AND "))
    }
}

/// The SQL for a write op, or `None` when there is nothing to do (an update
/// with no changed column).
fn build(database: Option<&str>, op: &QueryOp, cols: &TableColumns) -> DbResult<Option<Built>> {
    let mut params = Vec::new();
    let sql = match op {
        QueryOp::Insert { table, values, skip_empty } => {
            let kept: Vec<(&String, &Option<String>)> =
                values.iter().filter(|(_, v)| !(*skip_empty && v.is_none())).collect();
            let names: Vec<String> = kept.iter().map(|(c, _)| q(c)).collect();
            let marks: Vec<&str> = kept
                .iter()
                .map(|(c, v)| {
                    let (mark, param) = write_slot(cols, c, v);
                    params.push(param);
                    mark
                })
                .collect();
            // `() VALUES ()` is MySQL's every column at its default.
            format!("INSERT INTO {} ({}) VALUES ({})", tq(database, table), names.join(", "), marks.join(", "))
        }
        QueryOp::Update { table, set, match_row } => {
            if set.is_empty() {
                return Ok(None);
            }
            let sets: Vec<String> = set
                .iter()
                .map(|(col, val)| {
                    let (mark, param) = write_slot(cols, col, val);
                    params.push(param);
                    format!("{} = {mark}", q(col))
                })
                .collect();
            let where_sql = match_where(match_row, cols, &mut params);
            format!("UPDATE {} SET {}{where_sql}", tq(database, table), sets.join(", "))
        }
        QueryOp::Delete { table, match_row } => {
            let where_sql = match_where(match_row, cols, &mut params);
            format!("DELETE FROM {}{where_sql}", tq(database, table))
        }
        QueryOp::BulkUpdate { table, column, value, filters, custom_where } => {
            let (mark, param) = write_slot(cols, column, value);
            params.push(param);
            let mut filter_params = Vec::new();
            let where_sql = where_clause(filters, custom_where.as_ref(), cols, &mut filter_params);
            params.extend(Param::texts(&filter_params));
            format!("UPDATE {} SET {} = {mark}{where_sql}", tq(database, table), q(column))
        }
        QueryOp::DropTable { table } => format!("DROP TABLE IF EXISTS {}", tq(database, table)),
        QueryOp::Select { .. } | QueryOp::Count { .. } | QueryOp::SelectDistinct { .. } => {
            return Err(DbError::InvalidOperation("not a write".into()));
        }
    };
    Ok(Some(Built { sql, params }))
}

fn table_of(op: &QueryOp) -> &str {
    match op {
        QueryOp::Select { table, .. }
        | QueryOp::Count { table, .. }
        | QueryOp::BulkUpdate { table, .. }
        | QueryOp::SelectDistinct { table, .. }
        | QueryOp::Insert { table, .. }
        | QueryOp::Update { table, .. }
        | QueryOp::Delete { table, .. }
        | QueryOp::DropTable { table } => table,
    }
}

fn write_result(rows_affected: u64, start: Instant) -> QueryResult {
    QueryResult {
        columns: vec![],
        rows: vec![],
        rows_affected,
        is_select: false,
        error: None,
        elapsed_ms: start.elapsed().as_millis(),
        cancelled: false,
        cancel_source: None,
    }
}

impl MySqlAdapter {
    /// One grid write. A server error (a lock wait timeout, a deadlock, a
    /// strict mode refusal) comes back as `SqlEngine` with the server's code
    /// and message, and the grid keeps the edit staged (AC-16).
    pub(super) async fn execute_write(&self, database: Option<&str>, op: &QueryOp) -> DbResult<OpOutcome> {
        let start = Instant::now();
        let db = self.target(database);
        let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
        if let Some(db) = db {
            (&mut *conn).execute(format!("USE {}", q(db)).as_str()).await.map_err(DbError::SqlEngine)?;
        }
        let cols = match op {
            QueryOp::DropTable { .. } => TableColumns::default(),
            _ => table_columns(&mut conn, table_of(op)).await.unwrap_or_default(),
        };
        let Some(built) = build(db, op, &cols)? else {
            return Ok(OpOutcome { result: write_result(0, start), sql: None });
        };
        let done = bind_all(&built.sql, &built.params)
            .execute(&mut *conn)
            .await
            .map_err(|e| self.guard.refine(DbError::SqlEngine(e)))?;
        let mut result = write_result(done.rows_affected(), start);

        // The new row with its generated id: `last_insert_id`, then a re-read
        // of that row by its key.
        if let (QueryOp::Insert { table, .. }, Some(key)) = (op, cols.auto_increment.as_deref()) {
            let id = done.last_insert_id();
            if id != 0 {
                let sql = format!("SELECT * FROM {} WHERE {} = ?", tq(db, table), q(key));
                let mut collected = Collected::default();
                let mut sink = |chunk: QueryChunk| {
                    collected.push_chunk(chunk);
                    Ok(())
                };
                let params = [Param::Text(Some(id.to_string()))];
                let read =
                    stream_statement(&mut conn, &sql, &params, true, BytesRule::Catalog(&cols.bytes), None, &mut sink)
                        .await;
                drop(sink);
                // The insert landed either way; the re-read is a courtesy.
                match read {
                    Ok(streamed) => {
                        result.columns = streamed.columns;
                        result.rows = collected.rows;
                    }
                    Err(e) => log::warn!("mysql re-read of the inserted row failed: {e}"),
                }
            }
        }
        Ok(OpOutcome { result, sql: Some(built.display()) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn cols() -> TableColumns {
        TableColumns {
            bytes: HashSet::from(["raw".to_string()]),
            approx: HashSet::from(["f".to_string()]),
            bits: HashSet::from(["b".to_string()]),
            json: HashSet::from(["j".to_string()]),
            auto_increment: Some("id".into()),
        }
    }

    fn map(pairs: &[(&str, Option<&str>)]) -> BTreeMap<String, Option<String>> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.map(str::to_string))).collect()
    }

    fn text(v: &str) -> Param {
        Param::Text(Some(v.into()))
    }

    #[test]
    fn an_update_matches_the_full_row_with_the_float_and_bytes_rules() {
        let op = QueryOp::Update {
            table: "t".into(),
            set: map(&[("raw", Some("0xDEAD"))]),
            match_row: map(&[("f", Some("1.1")), ("id", Some("7")), ("note", None), ("raw", Some("0x6869"))]),
        };
        let built = build(Some("shop"), &op, &cols()).unwrap().unwrap();
        assert_eq!(
            built.sql,
            "UPDATE `shop`.`t` SET `raw` = ? WHERE CAST(`f` AS CHAR) = ? AND `id` = ? AND `note` IS NULL AND `raw` = ?"
        );
        assert_eq!(
            built.params,
            vec![Param::Bytes(vec![0xDE, 0xAD]), text("1.1"), text("7"), Param::Bytes(b"hi".to_vec())]
        );
        assert!(!built.sql.contains("LIMIT"));
        assert_eq!(
            built.display(),
            "UPDATE `shop`.`t` SET `raw` = 0xDEAD WHERE CAST(`f` AS CHAR) = 1.1 AND `id` = 7 AND `note` IS NULL AND `raw` = 0x6869;"
        );
    }

    #[test]
    fn an_insert_skips_empty_values_and_can_insert_all_defaults() {
        let op = QueryOp::Insert {
            table: "t".into(),
            values: map(&[("id", None), ("name", Some("a")), ("raw", Some("abc"))]),
            skip_empty: true,
        };
        let built = build(None, &op, &cols()).unwrap().unwrap();
        assert_eq!(built.sql, "INSERT INTO `t` (`name`, `raw`) VALUES (?, ?)");
        assert_eq!(built.params, vec![text("a"), Param::Bytes(b"abc".to_vec())]);

        let empty = QueryOp::Insert { table: "t".into(), values: map(&[("id", None)]), skip_empty: true };
        assert_eq!(build(None, &empty, &cols()).unwrap().unwrap().sql, "INSERT INTO `t` () VALUES ()");
    }

    #[test]
    fn a_delete_and_a_bulk_update_bind_their_values() {
        let del = QueryOp::Delete { table: "t".into(), match_row: map(&[("id", Some("1"))]) };
        let built = build(None, &del, &cols()).unwrap().unwrap();
        assert_eq!(built.sql, "DELETE FROM `t` WHERE `id` = ?");

        let bulk = QueryOp::BulkUpdate {
            table: "t".into(),
            column: "raw".into(),
            value: Some("0x00".into()),
            filters: vec![],
            custom_where: Some("`id` > 3".into()),
        };
        let built = build(None, &bulk, &cols()).unwrap().unwrap();
        assert_eq!(built.sql, "UPDATE `t` SET `raw` = ? WHERE (`id` > 3)");
        assert_eq!(built.params, vec![Param::Bytes(vec![0])]);
    }

    #[test]
    fn bit_and_json_cells_match_by_what_the_grid_shows() {
        let doc = r#"{"a": [1, 2]}"#;
        let row = map(&[("b", Some("b'0101'")), ("j", Some(doc)), ("note", Some("one"))]);
        let del = QueryOp::Delete { table: "t".into(), match_row: row.clone() };
        let built = build(None, &del, &cols()).unwrap().unwrap();
        assert_eq!(built.sql, "DELETE FROM `t` WHERE `b` = CAST(? AS UNSIGNED) AND `j` = CAST(? AS JSON) AND `note` = ?");
        assert_eq!(built.params, vec![text("5"), text(doc), text("one")]);

        // A BIT that spells no number compares as typed and finds nothing.
        let odd = QueryOp::Delete { table: "t".into(), match_row: map(&[("b", Some("x")), ("j", None)]) };
        let built = build(None, &odd, &cols()).unwrap().unwrap();
        assert_eq!(built.sql, "DELETE FROM `t` WHERE `b` = ? AND `j` IS NULL");
        assert_eq!(built.params, vec![text("x")]);
    }

    #[test]
    fn bit_writes_store_the_number_and_json_writes_stay_plain() {
        let op = QueryOp::Update {
            table: "t".into(),
            set: map(&[("b", Some("b'0110'")), ("j", Some("{}"))]),
            match_row: map(&[("id", Some("1"))]),
        };
        let built = build(None, &op, &cols()).unwrap().unwrap();
        assert_eq!(built.sql, "UPDATE `t` SET `b` = CAST(? AS UNSIGNED), `j` = ? WHERE `id` = ?");
        assert_eq!(built.params, vec![text("6"), text("{}"), text("1")]);

        let ins = QueryOp::Insert { table: "t".into(), values: map(&[("b", Some("abc")), ("j", Some("[]"))]), skip_empty: false };
        let built = build(None, &ins, &cols()).unwrap().unwrap();
        assert_eq!(built.sql, "INSERT INTO `t` (`b`, `j`) VALUES (?, ?)");
        assert_eq!(built.params, vec![text("abc"), text("[]")]);

        let bulk = QueryOp::BulkUpdate {
            table: "t".into(),
            column: "b".into(),
            value: Some("9".into()),
            filters: vec![crate::api::GridFilterCond {
                column: "b".into(),
                op: crate::api::FilterOp::Eq,
                value: "b'1'".into(),
                values: vec![],
                conjunction: None,
            }],
            custom_where: None,
        };
        let built = build(None, &bulk, &cols()).unwrap().unwrap();
        assert_eq!(built.sql, "UPDATE `t` SET `b` = CAST(? AS UNSIGNED) WHERE `b` = CAST(? AS UNSIGNED)");
        assert_eq!(built.params, vec![text("9"), text("1")]);
    }

    #[test]
    fn an_update_with_nothing_set_does_nothing() {
        let op = QueryOp::Update { table: "t".into(), set: BTreeMap::new(), match_row: map(&[("id", Some("1"))]) };
        assert_eq!(build(None, &op, &cols()).unwrap(), None);
    }
}
