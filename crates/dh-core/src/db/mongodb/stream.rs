//! The one MongoDB cursor loop. SQL on Mongo, the grid's page load and every
//! caller that wants all rows read documents through [`stream_documents`], so
//! there is one row loop, and rows reach the sink in batches as the server
//! sends them.

use std::collections::HashMap;
use futures_util::{Stream, TryStreamExt};
use crate::api::QueryChunk;
use crate::db::stream::{Batcher, Collected};
use crate::db::{BatchSink, DbResult, RunHandle};
use super::cancel::mongo_err;
use super::filter::json_cell_string;
use super::MongoAdapter;

/// Documents come back this many per server reply, so the first reply already
/// carries a full batch.
pub(super) const CURSOR_BATCH: u32 = 500;

/// The columns of a Mongo result. An explicit list is fixed. Otherwise the
/// list starts with the first document's fields (`_id` first when present)
/// and a field first seen in a later document is appended at the end, so
/// columns already sent never move.
pub(super) struct ColumnSet {
    names: Vec<String>,
    index: HashMap<String, usize>,
    growing: bool,
}

impl ColumnSet {
    pub(super) fn fixed(columns: Vec<String>) -> Self {
        let index = columns.iter().cloned().enumerate().map(|(i, c)| (c, i)).collect();
        Self { names: columns, index, growing: false }
    }

    pub(super) fn growing() -> Self {
        Self { names: Vec::new(), index: HashMap::new(), growing: true }
    }

    pub(super) fn names(&self) -> &[String] {
        &self.names
    }

    fn add(&mut self, name: &str) {
        if !self.index.contains_key(name) {
            self.index.insert(name.to_string(), self.names.len());
            self.names.push(name.to_string());
        }
    }

    /// Take in the fields of `doc` not seen yet. `true` when the list grew.
    pub(super) fn observe(&mut self, doc: &serde_json::Value) -> bool {
        if !self.growing {
            return false;
        }
        let serde_json::Value::Object(map) = doc else {
            return false;
        };
        let before = self.names.len();
        if before == 0 && map.contains_key("_id") {
            self.add("_id");
        }
        for key in map.keys() {
            self.add(key);
        }
        self.names.len() != before
    }

    /// The document as a row aligned to the columns known right now.
    pub(super) fn row(&self, doc: &serde_json::Value) -> Vec<Option<String>> {
        match doc {
            serde_json::Value::Object(map) => self
                .names
                .iter()
                .map(|c| map.get(c).and_then(json_cell_string))
                .collect(),
            other => self.names.iter().map(|_| json_cell_string(other)).collect(),
        }
    }
}

/// Read `cursor` to its end, sending rows to `sink` in batches. Returns the
/// final column list. On an error the batch in hand is sent first, so rows
/// already read stay with the caller; an interrupt the user asked for comes
/// back as `Cancelled`.
pub(super) async fn stream_documents<S>(
    mut cursor: S,
    columns: &mut ColumnSet,
    run: Option<&RunHandle>,
    sink: BatchSink<'_>,
    with_documents: bool,
) -> DbResult<Vec<String>>
where
    S: Stream<Item = Result<bson::Document, mongodb::error::Error>> + Unpin,
{
    let mut batcher = Batcher::new(sink);
    if with_documents {
        batcher = batcher.with_documents();
    }
    if !columns.names().is_empty() {
        batcher.set_columns(columns.names().to_vec());
    }
    let read: DbResult<()> = loop {
        let next = match batcher.deadline() {
            Some(at) => match tokio::time::timeout_at(at, cursor.try_next()).await {
                Ok(next) => next,
                Err(_) => {
                    // The batch is old enough: send it while the server is
                    // still working on the next reply.
                    if let Err(e) = batcher.flush() {
                        break Err(e);
                    }
                    continue;
                }
            },
            None => cursor.try_next().await,
        };
        match next {
            Ok(Some(doc)) => {
                let doc = MongoAdapter::document_to_json(doc);
                if columns.observe(&doc) {
                    batcher.set_columns(columns.names().to_vec());
                }
                let row = columns.row(&doc);
                let pushed = if with_documents {
                    batcher.push_with_document(row, doc)
                } else {
                    batcher.push(row)
                };
                if let Err(e) = pushed {
                    break Err(e);
                }
            }
            Ok(None) => break Ok(()),
            Err(e) => break Err(mongo_err(e, run)),
        }
    };
    if let Err(e) = read {
        let _ = batcher.flush();
        return Err(e);
    }
    if columns.names().is_empty() {
        // Nothing to derive columns from: every document has an `_id`, so it
        // is the one safe guess, and a columnless grid reads as broken.
        columns.add("_id");
        batcher.set_columns(columns.names().to_vec());
    }
    batcher.finish()?;
    Ok(columns.names().to_vec())
}

/// Read `cursor` to its end into memory, for callers that want every row.
/// Every row is padded to the final column count.
pub(super) async fn collect_documents<S>(
    cursor: S,
    columns: ColumnSet,
    run: Option<&RunHandle>,
) -> DbResult<(Vec<String>, Vec<Vec<Option<String>>>)>
where
    S: Stream<Item = Result<bson::Document, mongodb::error::Error>> + Unpin,
{
    let (columns, rows, _) = collect_with_documents(cursor, columns, run, false).await?;
    Ok((columns, rows))
}

async fn collect_with_documents<S>(
    cursor: S,
    mut columns: ColumnSet,
    run: Option<&RunHandle>,
    with_documents: bool,
) -> DbResult<(Vec<String>, Vec<Vec<Option<String>>>, Vec<serde_json::Value>)>
where
    S: Stream<Item = Result<bson::Document, mongodb::error::Error>> + Unpin,
{
    let mut collected = Collected::default();
    let mut sink = |chunk: QueryChunk| {
        collected.push_chunk(chunk);
        Ok(())
    };
    let names = stream_documents(cursor, &mut columns, run, &mut sink, with_documents).await?;
    let mut rows = collected.rows;
    for row in &mut rows {
        row.resize(names.len(), None);
    }
    Ok((names, rows, collected.documents))
}

/// What a console read hands back: the final columns, and the rows and
/// documents only when nothing was streamed.
pub(super) type ConsoleRead = (Vec<String>, Vec<Vec<Option<String>>>, Vec<serde_json::Value>);

/// The console's cursor read (find, aggregate, bare JSON). With a `sink` the
/// rows and their documents stream out in chunks and come back empty;
/// without one they are collected.
pub(super) async fn read_console_cursor<S>(
    cursor: S,
    run: Option<&RunHandle>,
    sink: Option<BatchSink<'_>>,
) -> DbResult<ConsoleRead>
where
    S: Stream<Item = Result<bson::Document, mongodb::error::Error>> + Unpin,
{
    match sink {
        Some(sink) => {
            let columns = stream_documents(cursor, &mut ColumnSet::growing(), run, sink, true).await?;
            Ok((columns, Vec::new(), Vec::new()))
        }
        None => collect_with_documents(cursor, ColumnSet::growing(), run, true).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn growing_columns_start_with_id_and_append_late_fields() {
        let mut set = ColumnSet::growing();
        assert!(set.observe(&json!({"a": 1, "_id": "x"})));
        assert_eq!(set.names(), ["_id", "a"]);
        assert!(!set.observe(&json!({"_id": "y", "a": 2})));
        assert!(set.observe(&json!({"a": 3, "late": 4})));
        assert_eq!(set.names(), ["_id", "a", "late"]);
        assert_eq!(set.row(&json!({"_id": "z", "late": 5})), vec![Some("z".into()), None, Some("5".into())]);
    }

    #[test]
    fn fixed_columns_never_grow() {
        let mut set = ColumnSet::fixed(vec!["a".into()]);
        assert!(!set.observe(&json!({"a": 1, "b": 2})));
        assert_eq!(set.names(), ["a"]);
        assert_eq!(set.row(&json!({"a": 1, "b": 2})), vec![Some("1".into())]);
    }

    fn docs(n: usize, late_at: usize) -> Vec<Result<bson::Document, mongodb::error::Error>> {
        (0..n)
            .map(|i| {
                let mut d = bson::doc! { "_id": i as i32, "a": i as i32 };
                if i >= late_at {
                    d.insert("late", 1);
                }
                Ok(d)
            })
            .collect()
    }

    #[tokio::test]
    async fn a_late_field_becomes_the_last_column_and_earlier_rows_pad() {
        let cursor = futures_util::stream::iter(docs(1200, 600));
        let (columns, rows) = collect_documents(cursor, ColumnSet::growing(), None).await.unwrap();
        assert_eq!(columns, ["_id", "a", "late"]);
        assert_eq!(rows.len(), 1200);
        assert!(rows.iter().all(|r| r.len() == 3));
        assert_eq!(rows[0][2], None);
        assert_eq!(rows[600][2], Some("1".into()));
    }

    #[tokio::test]
    async fn the_chunk_that_adds_a_column_carries_the_full_list() {
        let mut chunks: Vec<QueryChunk> = Vec::new();
        let mut sink = |c: QueryChunk| {
            chunks.push(c);
            Ok(())
        };
        let mut set = ColumnSet::growing();
        let cursor = futures_util::stream::iter(docs(1200, 600));
        stream_documents(cursor, &mut set, None, &mut sink, false).await.unwrap();
        assert_eq!(chunks[0].columns, Some(vec!["_id".to_string(), "a".to_string()]));
        // Rows 500..1000 hold the first document with `late` (600).
        assert_eq!(
            chunks[1].columns,
            Some(vec!["_id".to_string(), "a".to_string(), "late".to_string()])
        );
        assert_eq!(chunks[2].columns, None);
    }

    #[tokio::test]
    async fn an_empty_result_reports_id() {
        let cursor = futures_util::stream::iter(docs(0, 0));
        let (columns, rows) = collect_documents(cursor, ColumnSet::growing(), None).await.unwrap();
        assert_eq!(columns, ["_id"]);
        assert!(rows.is_empty());
    }
}
