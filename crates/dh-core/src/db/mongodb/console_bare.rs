use mongodb::action::Action;
use crate::db::{BatchSink, DbError, DbResult, RunHandle};
use super::MongoAdapter;
use super::stream::read_console_cursor;
use super::cancel::{mongo_err, run_comment};

impl MongoAdapter {
    /// Execute a bare JSON object (find) or array (aggregate) against the
    /// console's currently-selected collection.
    pub(super) async fn run_bare_json(
        &self,
        db: &str,
        coll: &str,
        s: &str,
        start: std::time::Instant,
        run: Option<&RunHandle>,
        sink: Option<BatchSink<'_>>,
    ) -> DbResult<crate::api::MongoRunResult> {
        let comment = run_comment(run);
        let col = self.client.database(db).collection::<bson::Document>(coll);
        let v: serde_json::Value = serde_json::from_str(&super::mongo_json::quote_bare_keys(s))
            .map_err(|e| DbError::InvalidOperation(format!("invalid JSON: {e}")))?;
        if let serde_json::Value::Object(_) = v {
            let filter = bson::to_document(&v)
                .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
            let mut opts = mongodb::options::FindOptions::builder().build();
            opts.comment = comment.clone();
            opts.limit = Some(50);
            opts.batch_size = Some(super::stream::CURSOR_BATCH);
            let cursor = col
                .find(filter.clone())
                .with_options(opts)
                .await
                .map_err(|e| mongo_err(e, run))?;
            let (columns, rows, documents) = read_console_cursor(cursor, run, sink).await?;
            return Ok(crate::api::MongoRunResult {
                command: format!("db.{coll}.find({s})"),
                columns,
                rows,
                documents,
                is_select: true,
                elapsed_ms: start.elapsed().as_millis(),
                ..Default::default()
            });
        }
        if let serde_json::Value::Array(items) = v {
            let stages: Vec<bson::Document> = items
                .into_iter()
                .map(|x| {
                    bson::to_document(&x).map_err(|e| {
                        DbError::InvalidOperation(format!("invalid pipeline stage: {e}"))
                    })
                })
                .collect::<DbResult<_>>()?;
            let cursor = col
                .aggregate(stages)
                .batch_size(super::stream::CURSOR_BATCH)
                .optional(comment.clone(), |a, c| a.comment(c))
                .await
                .map_err(|e| mongo_err(e, run))?;
            let (columns, rows, documents) = read_console_cursor(cursor, run, sink).await?;
            return Ok(crate::api::MongoRunResult {
                command: format!("db.{coll}.aggregate({s})"),
                columns,
                rows,
                documents,
                is_select: true,
                elapsed_ms: start.elapsed().as_millis(),
                ..Default::default()
            });
        }
        Ok(crate::api::MongoRunResult {
            error: Some(
                "Bare JSON must be an object (a query) or an array (an aggregation pipeline)"
                    .into(),
            ),
            elapsed_ms: start.elapsed().as_millis(),
            ..Default::default()
        })
    }
}
