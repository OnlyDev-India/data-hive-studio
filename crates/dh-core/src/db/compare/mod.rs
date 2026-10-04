//! Table data diff: each side is read ordered by the key, and the two
//! streams are merged in one pass, so any table size works in flat memory.

mod canon;
mod file;
mod merge;
mod page;
mod script;
#[cfg(test)]
mod tests;

use std::io::Write;

use tokio::sync::mpsc;

use super::registry::adapter_of;
use super::{runs, DbAdapter, DbError, DbResult, RunHandle};
use crate::api::{
    CompareChunk, CompareDataRequest, CompareFileKind, CompareFileSummary, CompareStatus, CompareSummary,
    DiffCounts, KeyVal, RowsRead, TableRef,
};

pub use canon::{instant, parse_ts, CanonVal, Dec};
#[cfg(test)]
pub(crate) use canon::same;
pub use file::write_failed;
use merge::Collector;
pub use page::CompareSink;
pub use script::{mongosh_literal, ScriptSyntax};

/// The most differences one page holds.
pub const DIFF_PAGE_SIZE: usize = 50_000;

/// What one side's scan reads.
pub struct ScanSpec<'a> {
    pub database: Option<&'a str>,
    pub schema: Option<&'a str>,
    pub table: &'a str,
    pub key_columns: &'a [String],
    /// Compared columns, key columns excluded.
    pub columns: &'a [String],
    pub filter: Option<&'a str>,
    /// Resume strictly after this key.
    pub after_key: Option<&'a [KeyVal]>,
    /// Fill [`ScanRow::literals`] (a Mongo sync script).
    pub literals: bool,
}

impl<'a> ScanSpec<'a> {
    fn of(side: &'a TableRef, req: &'a CompareDataRequest, literals: bool) -> Self {
        Self {
            database: side.database.as_deref(),
            schema: side.schema.as_deref(),
            table: &side.table,
            key_columns: &req.key_columns,
            columns: &req.columns,
            filter: req.filter.as_deref().map(str::trim).filter(|f| !f.is_empty()),
            after_key: req.after_key.as_deref(),
            literals,
        }
    }
}

/// One scanned row: canonical values for comparing, display text for the
/// grid.
pub struct ScanRow {
    pub key: Vec<CanonVal>,
    pub vals: Vec<CanonVal>,
    pub key_display: Vec<String>,
    pub display: Vec<Option<String>>,
    /// Shell literals, key columns then compared columns, `None` for an
    /// absent field. Mongo fills it when the spec asks; SQL scripts render
    /// from the canonical values instead.
    pub literals: Option<Vec<Option<String>>>,
}

pub(super) enum ScanMsg {
    Rows(Vec<ScanRow>),
    Failed(DbError),
}

/// Where a scan sends its row batches. It holds at most one batch in
/// flight, so a scan waits for the merge instead of reading ahead.
pub struct ScanOut {
    tx: mpsc::Sender<ScanMsg>,
}

impl ScanOut {
    /// `false` when the diff needs no more rows: stop reading and return.
    pub async fn send(&self, rows: Vec<ScanRow>) -> bool {
        self.tx.send(ScanMsg::Rows(rows)).await.is_ok()
    }
}

async fn drive(adapter: &dyn DbAdapter, spec: &ScanSpec<'_>, run: &RunHandle, tx: mpsc::Sender<ScanMsg>) {
    let out = ScanOut { tx };
    if let Err(e) = adapter.compare_scan(spec, run, &out).await {
        let _ = out.tx.send(ScanMsg::Failed(e)).await;
    }
}

/// Both scans and the merge under one registered run. A Stop the database
/// never confirmed still reports how far it got.
async fn run_merge(
    left: &dyn DbAdapter,
    right: &dyn DbAdapter,
    cancel_key: &str,
    req: &CompareDataRequest,
    literals: bool,
    out: &mut dyn Collector,
) -> DbResult<(CompareStatus, DiffCounts, RowsRead)> {
    if req.key_columns.is_empty() {
        return Err(DbError::InvalidOperation("Pick at least one key column.".into()));
    }
    let run = runs::register(cancel_key, &req.run_id);
    let progress = merge::Progress::default();
    let (left_tx, left_rx) = mpsc::channel(1);
    let (right_tx, right_rx) = mpsc::channel(1);
    let (left_spec, right_spec) = (ScanSpec::of(&req.left, req, literals), ScanSpec::of(&req.right, req, literals));

    let work = async {
        let (_, _, merged) = tokio::join!(
            drive(left, &left_spec, &run, left_tx),
            drive(right, &right_spec, &run, right_tx),
            merge::merge(left_rx, right_rx, &req.key_columns, &run, &progress, out),
        );
        merged
    };
    let res = runs::until_abandoned(Some(&run), work).await;
    run.finish().await;
    match res {
        Err(DbError::Cancelled) => {
            let (counts, rows_read) = progress.get();
            Ok((CompareStatus::Stopped, counts, rows_read))
        }
        other => other,
    }
}

/// The data diff on two adapters the caller already holds, with no activity
/// log: the desktop wrapper below and the team server share it. `cancel_key`
/// is the id Stop names the run under (the left connection, or the server's
/// handle).
pub async fn compare_data_on(
    left: &dyn DbAdapter,
    right: &dyn DbAdapter,
    cancel_key: &str,
    req: &CompareDataRequest,
    sink: CompareSink<'_>,
) -> DbResult<CompareSummary> {
    let mut out = page::PageCollector::new(sink, req.page_size.clamp(1, DIFF_PAGE_SIZE), req.count_all);
    let (status, counts, rows_read) = run_merge(left, right, cancel_key, req, false, &mut out).await?;
    let done = status == CompareStatus::Done;
    Ok(CompareSummary {
        status,
        counts,
        rows_read,
        total_diffs: (done && req.count_all).then(|| counts.differences()),
        next_key: if done && out.more { out.page_last.take() } else { None },
    })
}

/// Every difference, from the start and with no page limit, written to `w`
/// as `kind`. A sync script targets the right side's engine.
pub async fn compare_to_writer_on(
    left: &dyn DbAdapter,
    right: &dyn DbAdapter,
    cancel_key: &str,
    req: &CompareDataRequest,
    kind: CompareFileKind,
    w: &mut (dyn Write + Send),
) -> DbResult<CompareFileSummary> {
    let req = CompareDataRequest { after_key: None, count_all: true, ..req.clone() };
    let syntax = right.script_syntax();
    let literals = kind == CompareFileKind::SyncScript && syntax == ScriptSyntax::Mongosh;
    let mut out = file::FileCollector::new(w, file::row_writer(kind, &req, syntax))?;
    let (status, counts, _) = run_merge(left, right, cancel_key, &req, literals, &mut out).await?;
    Ok(CompareFileSummary { status, rows_written: out.written, counts, path: None })
}

/// The desktop entry point: both sides by connection id, Stop reaches the
/// run under the left connection.
pub async fn compare_data(
    req: &CompareDataRequest,
    mut sink: impl FnMut(CompareChunk) -> DbResult<()> + Send,
) -> DbResult<CompareSummary> {
    let t = std::time::Instant::now();
    let not_open =
        |side: &'static str| move |_| DbError::InvalidOperation(format!("The {side} side's connection is not open."));
    let left = adapter_of(&req.left.conn_id).map_err(not_open("left"))?;
    let right = adapter_of(&req.right.conn_id).map_err(not_open("right"))?;
    let res = compare_data_on(&*left, &*right, &req.left.conn_id, req, &mut sink).await;
    let target = format!("{} ↔ {}", req.left.table, req.right.table);
    match &res {
        Ok(s) => crate::activity::log_ok_origin(
            &req.left.conn_id,
            "compare",
            &target,
            t,
            (s.rows_read.left + s.rows_read.right) as i64,
            "app",
        ),
        Err(e) => crate::activity::log_err_origin(&req.left.conn_id, "compare", &target, t, e, "app"),
    }
    res
}

/// The desktop file export: written beside `path` and renamed into place
/// once complete, so a failed or stopped run leaves no partial file.
pub async fn compare_data_to_file(
    req: &CompareDataRequest,
    kind: CompareFileKind,
    path: &str,
) -> DbResult<CompareFileSummary> {
    let t = std::time::Instant::now();
    let left = adapter_of(&req.left.conn_id)
        .map_err(|_| DbError::InvalidOperation("The left side's connection is not open.".into()))?;
    let right = adapter_of(&req.right.conn_id)
        .map_err(|_| DbError::InvalidOperation("The right side's connection is not open.".into()))?;
    let part = format!("{path}.part");
    let file = std::fs::File::create(&part).map_err(write_failed)?;
    let mut w = std::io::BufWriter::new(file);
    let res = compare_to_writer_on(&*left, &*right, &req.left.conn_id, req, kind, &mut w).await;
    drop(w);
    let res = match res {
        Ok(s) if s.status == CompareStatus::Done => match std::fs::rename(&part, path) {
            Ok(()) => Ok(CompareFileSummary { path: Some(path.to_string()), ..s }),
            Err(e) => {
                let _ = std::fs::remove_file(&part);
                Err(write_failed(e))
            }
        },
        other => {
            let _ = std::fs::remove_file(&part);
            other
        }
    };
    let target = format!("{} ↔ {} → {path}", req.left.table, req.right.table);
    match &res {
        Ok(s) => crate::activity::log_ok_origin(&req.left.conn_id, "compare export", &target, t, s.rows_written as i64, "user"),
        Err(e) => crate::activity::log_err_origin(&req.left.conn_id, "compare export", &target, t, e, "user"),
    }
    res
}
