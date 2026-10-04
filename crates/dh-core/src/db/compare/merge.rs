//! Walks the two key ordered scans side by side and hands each difference
//! to a [`Collector`]: the grid's pages, or a file writer.

use std::cmp::Ordering;
use std::sync::Mutex;

use tokio::sync::mpsc;

use super::canon::{cmp_keys, same, CanonVal};
use super::{ScanMsg, ScanRow};
use crate::api::{CompareStatus, DiffCounts, DiffKind, RowsRead};
use crate::db::{DbError, DbResult, RunHandle};

/// The latest counts, readable after the merge was dropped (an abandoned
/// Stop still reports how far it got).
#[derive(Default)]
pub struct Progress(Mutex<(DiffCounts, RowsRead)>);

impl Progress {
    pub fn get(&self) -> (DiffCounts, RowsRead) {
        *self.0.lock().unwrap()
    }
    pub fn set(&self, counts: DiffCounts, read: RowsRead) {
        *self.0.lock().unwrap() = (counts, read);
    }
}

struct Side<'a> {
    name: &'static str,
    rx: mpsc::Receiver<ScanMsg>,
    buf: std::vec::IntoIter<ScanRow>,
    last: Option<Vec<CanonVal>>,
    read: u64,
    key_columns: &'a [String],
}

impl<'a> Side<'a> {
    fn new(name: &'static str, rx: mpsc::Receiver<ScanMsg>, key_columns: &'a [String]) -> Self {
        Self { name, rx, buf: Vec::new().into_iter(), last: None, read: 0, key_columns }
    }

    async fn next(&mut self) -> DbResult<Option<ScanRow>> {
        loop {
            if let Some(row) = self.buf.next() {
                self.check(&row)?;
                self.read += 1;
                return Ok(Some(row));
            }
            match self.rx.recv().await {
                Some(ScanMsg::Rows(rows)) => self.buf = rows.into_iter(),
                Some(ScanMsg::Failed(DbError::Cancelled)) => return Err(DbError::Cancelled),
                Some(ScanMsg::Failed(e)) => {
                    return Err(DbError::InvalidOperation(format!("{} side: {e}", title(self.name))))
                }
                None => return Ok(None),
            }
        }
    }

    /// Keys must be non NULL and strictly increasing, or the walk would
    /// pair the wrong rows.
    fn check(&mut self, row: &ScanRow) -> DbResult<()> {
        let cols = self.key_columns.join(", ");
        if row.key.iter().any(CanonVal::is_null) {
            return Err(DbError::InvalidOperation(format!(
                "Key column {cols} holds NULL on the {} side (row {}). Pick a key with no NULL values.",
                self.name,
                row.key_display.join(", "),
            )));
        }
        if let Some(last) = &self.last {
            match cmp_keys(last, &row.key) {
                Ordering::Less => {}
                Ordering::Equal => {
                    return Err(DbError::InvalidOperation(format!(
                        "The key ({cols}) is not unique on the {} side: {} appears more than once. Pick a unique key.",
                        self.name,
                        row.key_display.join(", "),
                    )))
                }
                Ordering::Greater => {
                    return Err(DbError::InvalidOperation(format!(
                        "The {} side did not return rows in key order ({cols}), so the diff would be wrong. \
                         A column collation other than binary can cause this. Pick a different key.",
                        self.name,
                    )))
                }
            }
        }
        self.last = Some(row.key.clone());
        Ok(())
    }
}

fn title(side: &str) -> String {
    let mut c = side.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

/// One difference, with the scanned rows it came from: the left row for
/// `LeftOnly`, the right for `RightOnly`, both for `Changed`.
pub struct Diff {
    pub kind: DiffKind,
    pub left: Option<ScanRow>,
    pub right: Option<ScanRow>,
    /// Indexes into the compared columns; `Changed` only.
    pub changed: Vec<usize>,
}

pub enum Flow {
    Go,
    Stop,
}

/// Where the merge sends what it finds.
pub trait Collector: Send {
    /// `Flow::Stop` ends the walk early, as done.
    fn diff(&mut self, d: Diff) -> DbResult<Flow>;
    /// After every step, with the counts so far.
    fn tick(&mut self, counts: DiffCounts, rows_read: RowsRead, progress: &Progress) -> DbResult<()>;
    /// Once, after the walk ended as done or stopped.
    fn finish(&mut self) -> DbResult<()>;
}

/// Merge the two scans. A Stop (from the run, or a side reporting
/// `Cancelled`) ends it as `stopped` with what was found so far.
pub async fn merge(
    left_rx: mpsc::Receiver<ScanMsg>,
    right_rx: mpsc::Receiver<ScanMsg>,
    key_columns: &[String],
    run: &RunHandle,
    progress: &Progress,
    out: &mut dyn Collector,
) -> DbResult<(CompareStatus, DiffCounts, RowsRead)> {
    let mut left = Side::new("left", left_rx, key_columns);
    let mut right = Side::new("right", right_rx, key_columns);
    let mut counts = DiffCounts::default();

    let walked = async {
        let mut l = left.next().await?;
        let mut r = right.next().await?;
        loop {
            if run.is_cancel_requested() {
                return Err(DbError::Cancelled);
            }
            let order = match (&l, &r) {
                (None, None) => return Ok(()),
                (Some(_), None) => Ordering::Less,
                (None, Some(_)) => Ordering::Greater,
                (Some(a), Some(b)) => cmp_keys(&a.key, &b.key),
            };
            let flow = match order {
                Ordering::Less => {
                    // Hand the row over before reading on: a Stop seen by
                    // `next` must not drop a row already counted.
                    counts.left_only += 1;
                    let row = l.take().expect("left row");
                    let flow =
                        out.diff(Diff { kind: DiffKind::LeftOnly, left: Some(row), right: None, changed: vec![] })?;
                    l = left.next().await?;
                    flow
                }
                Ordering::Greater => {
                    counts.right_only += 1;
                    let row = r.take().expect("right row");
                    let flow =
                        out.diff(Diff { kind: DiffKind::RightOnly, left: None, right: Some(row), changed: vec![] })?;
                    r = right.next().await?;
                    flow
                }
                Ordering::Equal => {
                    let (a, b) = (l.take().expect("left row"), r.take().expect("right row"));
                    l = left.next().await?;
                    r = right.next().await?;
                    let changed: Vec<usize> =
                        (0..a.vals.len()).filter(|&i| !same(&a.vals[i], &b.vals[i])).collect();
                    if changed.is_empty() {
                        counts.identical += 1;
                        Flow::Go
                    } else {
                        counts.changed += 1;
                        out.diff(Diff { kind: DiffKind::Changed, left: Some(a), right: Some(b), changed })?
                    }
                }
            };
            if let Flow::Stop = flow {
                return Ok(());
            }
            out.tick(counts, RowsRead { left: left.read, right: right.read }, progress)?;
        }
    };
    let res: DbResult<()> = walked.await;
    let rows_read = RowsRead { left: left.read, right: right.read };
    progress.set(counts, rows_read);

    let status = match res {
        Ok(()) => CompareStatus::Done,
        Err(DbError::Cancelled) => CompareStatus::Stopped,
        Err(e) => return Err(e),
    };
    out.finish()?;
    Ok((status, counts, rows_read))
}
