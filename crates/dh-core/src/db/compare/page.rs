//! The grid's view of a diff: differences in batches, cut at one page.

use std::time::{Duration, Instant};

use super::canon::to_key;
use super::merge::{Collector, Diff, Flow, Progress};
use super::ScanRow;
use crate::api::{CompareChunk, DiffCounts, DiffKind, DiffRow, KeyVal, RowsRead};
use crate::db::stream::{BATCH_MAX_AGE, BATCH_ROWS};
use crate::db::DbResult;

pub type CompareSink<'a> = &'a mut (dyn FnMut(CompareChunk) -> DbResult<()> + Send);

const PROGRESS_EVERY: Duration = Duration::from_millis(250);

/// Batches differences for the sink and keeps track of the page.
pub struct PageCollector<'a> {
    sink: CompareSink<'a>,
    batch: Vec<DiffRow>,
    first_at: Option<Instant>,
    last_progress: Instant,
    page_size: usize,
    count_all: bool,
    emitted: usize,
    /// The last key on a full page.
    pub page_last: Option<Vec<KeyVal>>,
    /// Differences exist past the page.
    pub more: bool,
}

impl<'a> PageCollector<'a> {
    pub fn new(sink: CompareSink<'a>, page_size: usize, count_all: bool) -> Self {
        Self {
            sink,
            batch: Vec::new(),
            first_at: None,
            last_progress: Instant::now(),
            page_size: page_size.max(1),
            count_all,
            emitted: 0,
            page_last: None,
            more: false,
        }
    }

    fn flush(&mut self) -> DbResult<()> {
        self.first_at = None;
        if self.batch.is_empty() {
            return Ok(());
        }
        (self.sink)(CompareChunk::Rows { rows: std::mem::take(&mut self.batch) })
    }
}

impl Collector for PageCollector<'_> {
    fn diff(&mut self, d: Diff) -> DbResult<Flow> {
        if self.emitted >= self.page_size {
            self.more = true;
            return Ok(if self.count_all { Flow::Go } else { Flow::Stop });
        }
        let row = to_row(d);
        self.emitted += 1;
        if self.emitted == self.page_size {
            let last_key = row.key.clone();
            self.page_last = Some(last_key.clone());
            self.batch.push(row);
            self.flush()?;
            (self.sink)(CompareChunk::PageFull { last_key })?;
            return Ok(Flow::Go);
        }
        if self.batch.is_empty() {
            self.first_at = Some(Instant::now());
        }
        self.batch.push(row);
        if self.batch.len() >= BATCH_ROWS {
            self.flush()?;
        }
        Ok(Flow::Go)
    }

    fn tick(&mut self, counts: DiffCounts, rows_read: RowsRead, progress: &Progress) -> DbResult<()> {
        if self.first_at.is_some_and(|at| at.elapsed() >= BATCH_MAX_AGE) {
            self.flush()?;
        }
        if self.last_progress.elapsed() >= PROGRESS_EVERY {
            self.last_progress = Instant::now();
            progress.set(counts, rows_read);
            (self.sink)(CompareChunk::Progress { rows_read, counts })?;
        }
        Ok(())
    }

    fn finish(&mut self) -> DbResult<()> {
        self.flush()
    }
}

pub(super) fn keys(row: &ScanRow) -> Vec<KeyVal> {
    row.key.iter().map(to_key).collect()
}

/// The wire form of a difference, keyed by the left row when there is one.
pub fn to_row(d: Diff) -> DiffRow {
    let (kind, changed) = (d.kind, d.changed);
    match (d.left, d.right) {
        (Some(a), Some(b)) => DiffRow {
            kind,
            key: keys(&a),
            key_display: a.key_display,
            left: Some(a.display),
            right: Some(b.display),
            changed: Some(changed),
        },
        (Some(a), None) => DiffRow {
            kind: DiffKind::LeftOnly,
            key: keys(&a),
            key_display: a.key_display,
            left: Some(a.display),
            right: None,
            changed: None,
        },
        (None, Some(b)) => DiffRow {
            kind: DiffKind::RightOnly,
            key: keys(&b),
            key_display: b.key_display,
            left: None,
            right: Some(b.display),
            changed: None,
        },
        (None, None) => unreachable!("a difference has at least one row"),
    }
}
