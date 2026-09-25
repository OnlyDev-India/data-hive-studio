//! The shared streaming helpers: one batcher every engine's row loop feeds,
//! and a collector for callers that want every row (`run_sql`, exports).

use std::time::{Duration, Instant};
use crate::api::QueryChunk;
use super::{BatchSink, DbResult};

/// A batch goes out at this many rows...
pub(crate) const BATCH_ROWS: usize = 500;
/// ...or this long after its first row, whichever comes first, so a slow
/// trickle of rows still shows up without waiting for a full batch.
pub(crate) const BATCH_MAX_AGE: Duration = Duration::from_millis(100);

/// Groups rows into chunks for the sink. The column list rides on the first
/// chunk that goes out and again whenever it changed since the last one.
pub(crate) struct Batcher<'a> {
    sink: BatchSink<'a>,
    rows: Vec<Vec<Option<String>>>,
    /// The documents behind `rows`, kept only when asked for.
    documents: Option<Vec<serde_json::Value>>,
    first_row_at: Option<Instant>,
    /// Columns not yet sent to the sink.
    pending_columns: Option<Vec<String>>,
}

impl<'a> Batcher<'a> {
    pub(crate) fn new(sink: BatchSink<'a>) -> Self {
        Self {
            sink,
            rows: Vec::with_capacity(BATCH_ROWS),
            documents: None,
            first_row_at: None,
            pending_columns: None,
        }
    }

    /// Send the document behind every row too (the MongoDB console).
    pub(crate) fn with_documents(mut self) -> Self {
        self.documents = Some(Vec::new());
        self
    }

    /// Set the full current column list. It goes out with the next chunk.
    pub(crate) fn set_columns(&mut self, columns: Vec<String>) {
        self.pending_columns = Some(columns);
    }

    /// Add one row and the document it came from.
    pub(crate) fn push_with_document(
        &mut self,
        row: Vec<Option<String>>,
        document: serde_json::Value,
    ) -> DbResult<()> {
        if let Some(documents) = &mut self.documents {
            documents.push(document);
        }
        self.push(row)
    }

    /// Add one row, flushing when the batch is full.
    pub(crate) fn push(&mut self, row: Vec<Option<String>>) -> DbResult<()> {
        if self.rows.is_empty() {
            self.first_row_at = Some(Instant::now());
        }
        self.rows.push(row);
        if self.rows.len() >= BATCH_ROWS {
            self.flush()?;
        }
        Ok(())
    }

    /// When the batch in hand must go out, if it holds rows. The row loop
    /// waits no longer than this for the next row.
    pub(crate) fn deadline(&self) -> Option<tokio::time::Instant> {
        self.first_row_at
            .map(|at| tokio::time::Instant::from_std(at + BATCH_MAX_AGE))
    }

    /// Send what is held (rows, and any column list not yet sent).
    pub(crate) fn flush(&mut self) -> DbResult<()> {
        if self.rows.is_empty() && self.pending_columns.is_none() {
            return Ok(());
        }
        let rows = std::mem::take(&mut self.rows);
        let documents = self.documents.as_mut().map(std::mem::take);
        self.first_row_at = None;
        (self.sink)(QueryChunk { columns: self.pending_columns.take(), rows, documents })
    }

    /// The run ended: send the tail. A result with no rows still reports its
    /// columns when they are known.
    pub(crate) fn finish(&mut self) -> DbResult<()> {
        self.flush()
    }
}

/// Collects chunks into one result, for callers that want every row.
#[derive(Default)]
pub(crate) struct Collected {
    pub(crate) columns: Vec<String>,
    pub(crate) rows: Vec<Vec<Option<String>>>,
    pub(crate) documents: Vec<serde_json::Value>,
}

impl Collected {
    pub(crate) fn push_chunk(&mut self, chunk: QueryChunk) {
        if let Some(columns) = chunk.columns {
            self.columns = columns;
        }
        self.rows.extend(chunk.rows);
        self.documents.extend(chunk.documents.unwrap_or_default());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(n: usize) -> Vec<Option<String>> {
        vec![Some(n.to_string())]
    }

    #[test]
    fn flushes_at_a_full_batch_and_carries_columns_once() {
        let mut chunks: Vec<QueryChunk> = Vec::new();
        let mut sink = |c: QueryChunk| {
            chunks.push(c);
            Ok(())
        };
        let mut b = Batcher::new(&mut sink);
        b.set_columns(vec!["n".into()]);
        for i in 0..(BATCH_ROWS + 3) {
            b.push(row(i)).unwrap();
        }
        b.finish().unwrap();
        drop(b);

        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].columns, Some(vec!["n".to_string()]));
        assert_eq!(chunks[0].rows.len(), BATCH_ROWS);
        assert_eq!(chunks[1].columns, None);
        assert_eq!(chunks[1].rows.len(), 3);
    }

    #[test]
    fn a_result_with_no_rows_still_reports_its_columns() {
        let mut chunks: Vec<QueryChunk> = Vec::new();
        let mut sink = |c: QueryChunk| {
            chunks.push(c);
            Ok(())
        };
        let mut b = Batcher::new(&mut sink);
        b.set_columns(vec!["a".into(), "b".into()]);
        b.finish().unwrap();
        drop(b);

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].columns, Some(vec!["a".to_string(), "b".to_string()]));
        assert!(chunks[0].rows.is_empty());
    }

    #[test]
    fn a_grown_column_list_rides_on_the_next_chunk() {
        let mut chunks: Vec<QueryChunk> = Vec::new();
        let mut sink = |c: QueryChunk| {
            chunks.push(c);
            Ok(())
        };
        let mut b = Batcher::new(&mut sink);
        b.set_columns(vec!["a".into()]);
        b.push(row(1)).unwrap();
        b.flush().unwrap();
        b.set_columns(vec!["a".into(), "late".into()]);
        b.push(row(2)).unwrap();
        b.flush().unwrap();
        drop(b);

        assert_eq!(chunks[1].columns, Some(vec!["a".to_string(), "late".to_string()]));
    }

    #[test]
    fn the_deadline_only_exists_while_rows_are_held() {
        let mut sink = |_: QueryChunk| Ok(());
        let mut b = Batcher::new(&mut sink);
        assert!(b.deadline().is_none());
        b.push(row(1)).unwrap();
        assert!(b.deadline().is_some());
        b.flush().unwrap();
        assert!(b.deadline().is_none());
    }

    #[test]
    fn a_failing_sink_fails_the_push_that_flushes() {
        let mut sink = |_: QueryChunk| Err(crate::db::DbError::InvalidOperation("window gone".into()));
        let mut b = Batcher::new(&mut sink);
        for i in 0..(BATCH_ROWS - 1) {
            b.push(row(i)).unwrap();
        }
        assert!(b.push(row(0)).is_err());
    }
}
