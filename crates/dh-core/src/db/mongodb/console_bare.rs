use mongodb::action::Action;
use futures_util::TryStreamExt;
use crate::db::{DbError, DbResult, RunHandle};
use super::MongoAdapter;
use super::convert::flatten_documents;
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
            let mut cursor = col
                .find(filter.clone())
                .with_options(opts)
                .await
                .map_err(|e| mongo_err(e, run))?;
            let mut docs: Vec<serde_json::Value> = Vec::new();
            while let Some(d) = cursor
                .try_next()
                .await
                .map_err(|e| mongo_err(e, run))?
            {
                docs.push(Self::document_to_json(d));
            }
            let (columns, rows) = flatten_documents(&docs);
            return Ok(crate::api::MongoRunResult {
                command: format!("db.{coll}.find({s})"),
                columns,
                rows,
                documents: docs,
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
            let mut cursor = col
                .aggregate(stages)
                    .optional(comment.clone(), |a, c| a.comment(c))
                .await
                .map_err(|e| mongo_err(e, run))?;
            let mut docs: Vec<serde_json::Value> = Vec::new();
            while let Some(d) = cursor
                .try_next()
                .await
                .map_err(|e| mongo_err(e, run))?
            {
                docs.push(Self::document_to_json(d));
            }
            let (columns, rows) = flatten_documents(&docs);
            return Ok(crate::api::MongoRunResult {
                command: format!("db.{coll}.aggregate({s})"),
                columns,
                rows,
                documents: docs,
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
