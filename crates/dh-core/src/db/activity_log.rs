use crate::api::{MongoRunResult, QueryOp, QueryResult};
use super::types::{DbError, DbResult};

/// Rows metric for the activity log: returned rows for reads, affected rows
/// for writes.
pub(super) fn activity_rows(r: &QueryResult) -> i64 {
    if r.is_select {
        r.rows.len() as i64
    } else {
        r.rows_affected as i64
    }
}

/// Like `activity_rows`, but for a Mongo console result — rows OR documents
/// carries the returned count depending on which shape the command produced.
pub(super) fn activity_rows_mongo(r: &MongoRunResult) -> i64 {
    if r.is_select {
        r.rows.len().max(r.documents.len()) as i64
    } else {
        r.rows_affected as i64
    }
}

/// Render one bound parameter as an inline SQL literal for the activity
/// log's full-statement view (`VALUES ('O''Brien', 42)` instead of ($1,$2)).
pub(crate) fn sql_literal(v: Option<&str>) -> String {
    match v {
        None => "NULL".to_string(),
        Some(s) => {
            if s.is_empty() {
                return "''".to_string();
            }
            // Numbers stay bare; everything else becomes an escaped string.
            if s.parse::<i64>().is_ok() || s.parse::<f64>().is_ok() {
                return s.to_string();
            }
            format!("'{}'", s.replace('\'', "''"))
        }
    }
}

/// Substitute bound parameters into rendered SQL for display only — never
/// executed. `dollar` selects $1..$n (Postgres) vs sequential `?` (SQLite).
pub(crate) fn inline_placeholders(sql: &str, params: &[Option<String>], dollar: bool) -> String {
    if params.is_empty() {
        return sql.to_string();
    }
    let mut out = String::with_capacity(sql.len());
    let mut qi = 0usize;
    let mut it = sql.chars().peekable();
    while let Some(c) = it.next() {
        if !dollar && c == '?' && qi < params.len() {
            out.push_str(&sql_literal(params[qi].as_deref()));
            qi += 1;
            continue;
        }
        if dollar && c == '$' {
            let mut num = String::new();
            while let Some(d) = it.peek() {
                if d.is_ascii_digit() {
                    num.push(*d);
                    it.next();
                } else {
                    break;
                }
            }
            if let Ok(n) = num.parse::<usize>() {
                if n >= 1 && n <= params.len() {
                    out.push_str(&sql_literal(params[n - 1].as_deref()));
                    continue;
                }
            }
            if !num.is_empty() {
                out.push('$');
                out.push_str(&num);
            } else {
                out.push('$');
            }
            continue;
        }
        // Don't touch placeholders inside quoted literals.
        if c == '\'' {
            out.push(c);
            for c2 in it.by_ref() {
                out.push(c2);
                if c2 == '\'' {
                    break;
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// A write refused because the connection is read only is a failed entry in
/// the Activity log (spec 0007). Document saves and inserts log nothing when
/// they work, so only the refusal is recorded here, as app initiated.
pub(super) fn log_refusal<T>(conn_id: &str, kind: &str, target: &str, t: std::time::Instant, res: &DbResult<T>) {
    if let Err(e @ DbError::ReadOnly(_)) = res {
        crate::activity::log_err_origin(conn_id, kind, target, t, e, "app");
    }
}

/// Run a structured operation. The connection's adapter turns the details
/// into dialect SQL (the single place query creation happens) and executes
/// it, returning rows for reads and the affected count for writes.
/// Coarse (kind, target) labels for the activity log, derived from the op.
pub(super) fn op_label(op: &QueryOp) -> (&'static str, String) {
    match op {
        QueryOp::Select { table, .. } => ("select", format!("SELECT {table}")),
        QueryOp::Count { table, .. } => ("count", format!("COUNT {table}")),
        QueryOp::SelectDistinct { table, column, .. } => {
            ("distinct", format!("DISTINCT {table}.{column}"))
        }
        QueryOp::Insert { table, values, .. } => (
            "insert",
            format!("INSERT {table} ({} cols)", values.len()),
        ),
        QueryOp::Update { table, set, .. } => (
            "update",
            format!(
                "UPDATE {table} SET {}",
                set.keys().cloned().collect::<Vec<_>>().join(", ")
            ),
        ),
        QueryOp::BulkUpdate { table, column, .. } => (
            "bulk_update",
            format!("UPDATE {table} SET {column} (bulk)"),
        ),
        QueryOp::Delete { table, .. } => ("delete", format!("DELETE {table}")),
        QueryOp::DropTable { table } => ("drop_table", format!("DROP TABLE {table}")),
    }
}
