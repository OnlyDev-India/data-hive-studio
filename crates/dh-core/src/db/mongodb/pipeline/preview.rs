use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use bson::{Bson, Document};
use futures_util::{StreamExt, TryStreamExt};
use mongodb::action::Action;
use crate::api::{PipelinePreviewRequest, PreviewChunk, PreviewSummary};
use crate::db::{DbError, DbResult, PreviewSink, RunHandle};
use super::super::cancel::{mongo_err, run_comment};
use super::super::stream::ColumnSet;
use super::super::MongoAdapter;
use super::targets::targets;

impl MongoAdapter {
    /// Preview the cards `req` names, at most `req.concurrency` queries at a
    /// time, each card's result going to `sink` as it lands. A card that
    /// fails stops the queued cards that read through it; a card behind one
    /// that does not compose is never run. Stop kills every query of the refresh
    /// at once, since they all carry the run id as their comment.
    pub(in crate::db::mongodb) async fn pipeline_preview(
        &self,
        req: &PipelinePreviewRequest,
        run: Option<&RunHandle>,
        sink: PreviewSink<'_>,
    ) -> DbResult<PreviewSummary> {
        self.arm_kill_op(run).await?;
        let db = self.client.database(&req.database);
        let col = db.collection::<Document>(&req.collection);
        let comment = run_comment(run);
        let cancelled = AtomicBool::new(false);
        let time = Duration::from_millis(req.time_ms);

        let all = targets(req);
        let failed: Vec<AtomicBool> = all.iter().map(|_| AtomicBool::new(false)).collect();
        // A card behind one that cannot compose stays waiting, unsent.
        let runnable = all.into_iter().filter(|t| !matches!(&t.pipeline, Err(e) if e.is_empty()));
        let results = futures_util::stream::iter(runnable.map(|t| {
            let (db, col, comment, failed, cancelled) = (&db, &col, comment.clone(), &failed, &cancelled);
            async move {
                let behind = t.deps.iter().any(|&d| failed[d].load(Ordering::SeqCst));
                if behind || cancelled.load(Ordering::SeqCst) {
                    return None;
                }
                let started = Instant::now();
                let col = match &t.collection {
                    Some(c) => db.collection::<Document>(c),
                    None => col.clone(),
                };
                let res = match t.pipeline {
                    Ok(p) => run_target(&col, p, time, comment, run).await,
                    Err(e) => Err(DbError::InvalidOperation(e)),
                };
                let mut chunk = PreviewChunk {
                    stage_id: t.stage_id,
                    branch_key: t.branch_key,
                    elapsed_ms: started.elapsed().as_millis(),
                    ..Default::default()
                };
                match res {
                    Ok((count, columns, rows, documents)) => {
                        chunk.count = count;
                        chunk.columns = columns;
                        chunk.rows = rows;
                        chunk.documents = documents;
                    }
                    Err(DbError::Cancelled) => {
                        cancelled.store(true, Ordering::SeqCst);
                        return None;
                    }
                    Err(e) => {
                        failed[t.ord].store(true, Ordering::SeqCst);
                        let (text, timed_out) = error_text(e);
                        chunk.error = Some(text);
                        chunk.timed_out = timed_out;
                    }
                }
                Some(chunk)
            }
        }))
        .buffer_unordered(req.concurrency.clamp(1, 8) as usize);

        let send = async {
            let mut results = std::pin::pin!(results);
            while let Some(item) = results.next().await {
                if let Some(chunk) = item {
                    sink(chunk)?;
                }
            }
            Ok::<(), DbError>(())
        };
        let estimate = async { col.estimated_document_count().await.ok() };
        let (sent, source_estimate) = tokio::join!(send, estimate);
        sent?;
        Ok(PreviewSummary {
            cancelled: cancelled.load(Ordering::SeqCst) || run.is_some_and(RunHandle::is_cancel_requested),
            source_estimate,
        })
    }
}

type Preview = (u64, Vec<String>, Vec<Vec<Option<String>>>, Vec<serde_json::Value>);

/// Run one card's pipeline and read its `$facet` tail: the first documents
/// and the count of everything the card put out.
async fn run_target(
    col: &mongodb::Collection<Document>,
    pipeline: Vec<Document>,
    time: Duration,
    comment: Option<Bson>,
    run: Option<&RunHandle>,
) -> DbResult<Preview> {
    let mut cursor = col
        .aggregate(pipeline)
        .max_time(time)
        .optional(comment, |a, c| a.comment(c))
        .await
        .map_err(|e| mongo_err(e, run))?;
    let tail = cursor.try_next().await.map_err(|e| mongo_err(e, run))?.unwrap_or_default();
    let count = tail
        .get_array("count")
        .ok()
        .and_then(|a| a.first())
        .and_then(Bson::as_document)
        .and_then(|d| match d.get("n") {
            Some(Bson::Int32(n)) => Some(*n as u64),
            Some(Bson::Int64(n)) => Some(*n as u64),
            _ => None,
        })
        .unwrap_or(0);
    let documents: Vec<serde_json::Value> = tail
        .get_array("docs")
        .map(|a| a.iter().filter_map(Bson::as_document).cloned().map(MongoAdapter::document_to_json).collect())
        .unwrap_or_default();
    let mut columns = ColumnSet::growing();
    for d in &documents {
        columns.observe(d);
    }
    let rows = documents.iter().map(|d| columns.row(d)).collect();
    Ok((count, columns.names().to_vec(), rows, documents))
}

/// The server's words without the driver's wrapping, and a time limit hit
/// said plainly (with `true`).
fn error_text(e: DbError) -> (String, bool) {
    let text = e.to_string();
    if text.contains("MaxTimeMSExpired") || text.contains("exceeded time limit") {
        return ("The preview passed its time limit".into(), true);
    }
    (text.strip_prefix("mongo: ").unwrap_or(&text).to_string(), false)
}

/// The activity log line for one refresh.
pub fn preview_activity_text(req: &PipelinePreviewRequest) -> String {
    let n = targets(req).len();
    let stages = if n == 1 { "stage" } else { "stages" };
    format!("preview db.{}.aggregate ({n} {stages}, first {} docs)", req.collection, req.cap)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::{PipelineSpec, StageSpec};

    #[test]
    fn the_activity_line_names_the_collection_targets_and_cap() {
        let stage = |id: &str, op: &str, body: &str| StageSpec {
            id: id.into(),
            op: op.into(),
            body: body.into(),
            enabled: true,
            title: None,
            note: None,
            branches: vec![],
        };
        let req = PipelinePreviewRequest {
            database: "d".into(),
            collection: "c".into(),
            spec: PipelineSpec { stages: vec![stage("a", "$match", "{}"), stage("b", "$out", r#""x""#)] },
            from: None,
            cap: 1000,
            time_ms: 10_000,
            show: 20,
            concurrency: 4,
            run_id: None,
        };
        assert_eq!(preview_activity_text(&req), "preview db.c.aggregate (1 stage, first 1000 docs)");
    }
}
