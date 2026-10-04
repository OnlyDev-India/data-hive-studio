use bson::Document;
use mongodb::action::Action;
use crate::api::{MongoRunResult, PipelineRunRequest};
use crate::db::read_only::refused;
use crate::db::{BatchSink, DbError, DbResult, RunHandle};
use super::super::cancel::{mongo_err, run_comment};
use super::super::stream::{read_console_cursor, CURSOR_BATCH};
use super::super::MongoAdapter;
use super::compose::{compose_pipeline, enabled_stages};
use super::write_stage;

impl MongoAdapter {
    /// Run the whole pipeline with no cap, streaming its documents to `sink`
    /// the way the console streams an aggregate. A card that does not compose
    /// fails the run before anything is sent; a read only connection refuses
    /// a pipeline holding `$out` or `$merge` anywhere.
    pub(in crate::db::mongodb) async fn pipeline_run(
        &self,
        req: &PipelineRunRequest,
        run: Option<&RunHandle>,
        sink: BatchSink<'_>,
    ) -> DbResult<MongoRunResult> {
        let start = std::time::Instant::now();
        let (stages, errors) = enabled_stages(&req.spec);
        if let Some(e) = errors.first() {
            return Err(DbError::InvalidOperation(e.message.clone()));
        }
        let stages: Vec<Document> = stages.into_iter().map(|(_, d)| d).collect();
        if self.guard.is_on() {
            if let Some(op) = write_stage(&stages) {
                return Err(refused(format!("a {op} stage is not allowed")));
            }
        }
        self.arm_kill_op(run).await?;
        let cursor = self
            .client
            .database(&req.database)
            .collection::<Document>(&req.collection)
            .aggregate(stages)
            .allow_disk_use(req.allow_disk_use)
            .batch_size(CURSOR_BATCH)
            .optional(run_comment(run), |a, c| a.comment(c))
            .await
            .map_err(|e| mongo_err(e, run))?;
        let (columns, rows, documents) = read_console_cursor(cursor, run, Some(sink)).await?;
        Ok(MongoRunResult {
            command: compose_pipeline(&req.collection, &req.spec).shell,
            columns,
            rows,
            documents,
            is_select: true,
            elapsed_ms: start.elapsed().as_millis(),
            ..Default::default()
        })
    }
}
