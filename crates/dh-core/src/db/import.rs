//! Engine agnostic pieces of `import_rows` (spec 0008): request checks, cell
//! text, batch sizing and the failure tally. Each adapter owns the actual
//! transaction; the rules that decide the outcome live here so every engine
//! reports the same way.

use serde_json::{Map, Value};

use std::sync::Arc;

use crate::api::{
    ImportData, ImportOnError, ImportProgress, ImportReport, ImportRequest, RowFailure,
    MAX_KEPT_FAILURES,
};
use super::{DbError, DbResult, RunHandle};

/// What the caller can do to a running import: watch it and stop it. It rides
/// in a task local so the per engine writers keep their signatures; the tally
/// every writer already owns reads it between batches.
pub(crate) struct ImportCtl {
    pub run: Option<RunHandle>,
    pub progress: Option<Box<dyn Fn(ImportProgress) + Send + Sync>>,
}

tokio::task_local! {
    pub(crate) static IMPORT_CTL: Arc<ImportCtl>;
}

/// Rows per multi row INSERT, before the bound value limit shrinks it.
pub(crate) const BATCH_ROWS: usize = 1000;

/// A checked SQL import: the column list and the rows, borrowed.
pub(crate) struct SqlRows<'a> {
    pub columns: &'a [String],
    pub rows: &'a [Vec<Value>],
}

/// Refuse a request the SQL adapters cannot run, before anything is written.
pub(crate) fn sql_rows(req: &ImportRequest) -> DbResult<SqlRows<'_>> {
    if req.table.trim().is_empty() {
        return Err(DbError::InvalidOperation("import needs a table name".into()));
    }
    let ImportData::Rows { columns, rows } = &req.data else {
        return Err(DbError::InvalidOperation(
            "this connection imports rows, not documents".into(),
        ));
    };
    if columns.is_empty() {
        return Err(DbError::InvalidOperation("import needs at least one column".into()));
    }
    for (i, c) in columns.iter().enumerate() {
        if columns[..i].contains(c) {
            return Err(DbError::InvalidOperation(format!(
                "column \"{c}\" is mapped more than once"
            )));
        }
    }
    if let Some(bad) = rows.iter().position(|r| r.len() != columns.len()) {
        return Err(DbError::InvalidOperation(format!(
            "row {} has {} values but {} columns were mapped",
            bad + 1,
            rows[bad].len(),
            columns.len()
        )));
    }
    Ok(SqlRows { columns, rows })
}

/// Refuse a request the Mongo adapter cannot run, before anything is written.
pub(crate) fn mongo_docs(req: &ImportRequest) -> DbResult<&[Map<String, Value>]> {
    let name = req.table.trim();
    if name.is_empty() || name.starts_with("system.") || name.contains(['$', '\0']) {
        return Err(DbError::InvalidOperation("import needs a valid collection name".into()));
    }
    if req.create_sql.is_some() {
        return Err(DbError::InvalidOperation(
            "a collection is created by the import itself, it takes no CREATE statement".into(),
        ));
    }
    match &req.data {
        ImportData::Docs { docs } => Ok(docs),
        ImportData::Rows { .. } => Err(DbError::InvalidOperation(
            "this connection imports documents, not rows".into(),
        )),
    }
}

/// The text bound for one cell, or `None` for SQL NULL. A number binds as its
/// text, a boolean as `true`/`false`, an object or array as compact JSON.
pub(crate) fn cell_text(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Number(n) => Some(n.to_string()),
        other => Some(other.to_string()),
    }
}

/// Rows per batch so one INSERT binds at most `max_bound` values.
pub(crate) fn batch_size(columns: usize, max_bound: usize) -> usize {
    (max_bound / columns.max(1)).clamp(1, BATCH_ROWS)
}

/// Collects failures and decides the outcome once the rows are done.
pub(crate) struct Tally {
    on_error: ImportOnError,
    dry_run: bool,
    pub inserted: u64,
    failed: Vec<RowFailure>,
    failed_total: u64,
    truncated: bool,
    total: u64,
    cancelled: bool,
}

impl Tally {
    pub fn new(req: &ImportRequest) -> Self {
        Self {
            on_error: req.on_error,
            dry_run: req.dry_run,
            inserted: 0,
            failed: Vec::new(),
            failed_total: 0,
            truncated: false,
            total: match &req.data {
                ImportData::Rows { rows, .. } => rows.len() as u64,
                ImportData::Docs { docs } => docs.len() as u64,
            },
            cancelled: false,
        }
    }

    pub fn fail(&mut self, failure: RowFailure) {
        self.failed_total += 1;
        if self.failed.len() < MAX_KEPT_FAILURES {
            self.failed.push(failure);
        }
    }

    /// Called before each batch. Reports progress, then says whether to stop:
    /// Cancel was pressed (spec 0006's registry), or a Roll back or Check run
    /// already knows its outcome because the failure list is full (Skip keeps
    /// going to count).
    pub fn should_stop(&mut self) -> bool {
        let done = self.inserted + self.failed_total;
        let cancelled = IMPORT_CTL
            .try_with(|c| {
                if let Some(report) = &c.progress {
                    report(ImportProgress { done, total: self.total });
                }
                c.run.as_ref().is_some_and(|r| r.is_cancel_requested())
            })
            .unwrap_or(false);
        if cancelled {
            self.cancelled = true;
            return true;
        }
        let decided = self.dry_run || self.on_error == ImportOnError::Rollback;
        if decided && self.failed.len() >= MAX_KEPT_FAILURES {
            self.truncated = true;
            return true;
        }
        false
    }

    /// Whether the transaction should commit.
    pub fn should_commit(&self) -> bool {
        !self.dry_run
            && !self.cancelled
            && (self.on_error == ImportOnError::Skip || self.failed_total == 0)
    }

    pub fn into_report(
        mut self,
        committed: bool,
        atomic: bool,
        statements: Vec<String>,
    ) -> ImportReport {
        self.failed.sort_by_key(|f| f.index);
        ImportReport {
            inserted: self.inserted,
            failed: self.failed,
            failed_total: self.failed_total,
            failed_truncated: self.truncated || self.failed_total > MAX_KEPT_FAILURES as u64,
            committed,
            atomic,
            cancelled: self.cancelled,
            dry_run: self.dry_run,
            statements,
        }
    }
}

/// The column a constraint message names, e.g. `NOT NULL constraint failed:
/// users.email` gives `email`.
pub(crate) fn column_from_message(msg: &str) -> Option<String> {
    let rest = msg.split("constraint failed:").nth(1)?;
    let first = rest.split(',').next()?.split(" (").next()?.trim();
    let col = first.rsplit('.').next()?.trim();
    (!col.is_empty()).then(|| col.to_string())
}

/// The one `CREATE TABLE` statement an import may run first (spec 0008). The
/// app builds this text and Rust never trusts it: anything that is not a single
/// `CREATE TABLE` is refused before it runs. Returns the statement without a
/// trailing semicolon.
pub(crate) fn single_create_table(sql: &str) -> DbResult<&str> {
    let refuse = || DbError::InvalidOperation("import can only run one CREATE TABLE statement".into());
    let body = sql.trim();
    let mut words = body.split_whitespace();
    let is_create = words.next().is_some_and(|w| w.eq_ignore_ascii_case("create"))
        && words.next().is_some_and(|w| w.eq_ignore_ascii_case("table"));
    if !is_create {
        return Err(refuse());
    }
    // Find a `;` outside quotes and comments. Only a trailing one is allowed.
    let bytes = body.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            q @ (b'\'' | b'"' | b'`') => {
                i += 1;
                while i < bytes.len() && bytes[i] != q {
                    i += 1;
                }
            }
            b'-' if bytes.get(i + 1) == Some(&b'-') => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                match body[i + 2..].find("*/") {
                    Some(end) => i += end + 3,
                    None => return Err(refuse()),
                }
            }
            b';' => {
                return if body[i + 1..].trim().is_empty() { Ok(body[..i].trim_end()) } else { Err(refuse()) };
            }
            _ => {}
        }
        i += 1;
    }
    Ok(body)
}

/// One line for the activity log and the report's `statements`.
pub(crate) fn summary_line(table: &str, columns: &[String], rows: usize) -> String {
    format!("INSERT INTO {table} ({}) VALUES … -- {rows} row(s)", columns.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cells_bind_as_text() {
        assert_eq!(cell_text(&json!(null)), None);
        assert_eq!(cell_text(&json!("a")), Some("a".into()));
        assert_eq!(cell_text(&json!(12.5)), Some("12.5".into()));
        assert_eq!(cell_text(&json!(true)), Some("true".into()));
        assert_eq!(cell_text(&json!({"a": [1]})), Some("{\"a\":[1]}".into()));
    }

    #[test]
    fn batch_stays_under_the_bound_limit() {
        assert_eq!(batch_size(3, 30_000), 1000);
        assert_eq!(batch_size(100, 30_000), 300);
        assert_eq!(batch_size(50_000, 30_000), 1);
    }

    #[test]
    fn names_the_failing_column() {
        assert_eq!(
            column_from_message("NOT NULL constraint failed: users.email (code: 1299)"),
            Some("email".into())
        );
        assert_eq!(column_from_message("boom"), None);
    }

    #[test]
    fn create_guard_allows_one_create_table() {
        assert_eq!(single_create_table(" create  TABLE t (a int); ").unwrap(), "create  TABLE t (a int)");
        assert!(single_create_table("CREATE TABLE \"a;b\" (x text DEFAULT ';')").is_ok());
        assert!(single_create_table("CREATE TABLE t (a int) -- ; note").is_ok());
    }

    #[test]
    fn create_guard_refuses_everything_else() {
        for bad in [
            "DROP TABLE t",
            "CREATE INDEX i ON t (a)",
            "CREATE TABLE t (a int); DROP TABLE u",
            "CREATE TABLE t (a int); -- x\nDELETE FROM u",
            "CREATE TABLE t (a int) /* open",
            "",
        ] {
            assert!(single_create_table(bad).is_err(), "{bad}");
        }
    }
}
