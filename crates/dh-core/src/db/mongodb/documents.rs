use futures_util::TryStreamExt;
use bson::doc;
use crate::db::{DbError, DbResult, RunHandle};
use super::MongoAdapter;
use super::filter::{is_object_id_hex, json_cell_string};
use super::cancel::{mongo_err, run_comment};
use super::stream::{collect_documents, stream_documents, ColumnSet, CURSOR_BATCH};

impl MongoAdapter {
    /// Fetch a page of documents from a collection with optional filter.
    pub async fn list_documents(
        &self,
        collection: &str,
        filter: Option<bson::Document>,
        skip: u64,
        limit: u64,
    ) -> DbResult<(Vec<serde_json::Value>, u64)> {
        let col = self
            .client
            .database(&self.cur_database())
            .collection::<bson::Document>(collection);
        let total = col
            .count_documents(filter.clone().unwrap_or_default())
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut cursor = col
            .find(filter.unwrap_or_default())
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut docs = Vec::new();
        let mut skipped = 0u64;
        while let Some(doc) = cursor
            .try_next()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?
        {
            if skipped < skip {
                skipped += 1;
                continue;
            }
            if docs.len() >= limit as usize {
                break;
            }
            docs.push(Self::document_to_json(doc));
        }
        Ok((docs, total))
    }

    /// Read one page of documents as a grid-style result (columns = fields
    /// across the page, `_id` first; rows = flattened top-level cells), all in
    /// memory. It does NOT count the collection: `count_documents` scans every
    /// match, and the grid asks for the total with its own `QueryOp::Count`,
    /// so counting here delayed the first row for a number nobody read.
    pub(super) async fn select_page(
        &self,
        database: &str,
        collection: &str,
        filter: Option<bson::Document>,
        order_by: &[crate::api::OrderByCond],
        limit: i64,
        offset: i64,
    ) -> DbResult<(Vec<String>, Vec<Vec<Option<String>>>)> {
        let cursor = self
            .page_cursor(database, collection, filter, order_by, limit, offset)
            .await?;
        collect_documents(cursor, ColumnSet::growing(), None).await
    }

    /// [`select_page`], with rows sent to `sink` in batches as they arrive.
    /// Returns the final column list.
    pub(super) async fn select_page_stream(
        &self,
        database: &str,
        collection: &str,
        filter: Option<bson::Document>,
        order_by: &[crate::api::OrderByCond],
        limit: i64,
        offset: i64,
        sink: crate::db::BatchSink<'_>,
    ) -> DbResult<Vec<String>> {
        let cursor = self
            .page_cursor(database, collection, filter, order_by, limit, offset)
            .await?;
        stream_documents(cursor, &mut ColumnSet::growing(), None, sink, false).await
    }

    async fn page_cursor(
        &self,
        database: &str,
        collection: &str,
        filter: Option<bson::Document>,
        order_by: &[crate::api::OrderByCond],
        limit: i64,
        offset: i64,
    ) -> DbResult<mongodb::Cursor<bson::Document>> {
        let col = self
            .client
            .database(database)
            .collection::<bson::Document>(collection);
        let mut opts = mongodb::options::FindOptions::builder().build();
        opts.batch_size = Some(CURSOR_BATCH);
        if !order_by.is_empty() {
            // Mongo sort documents apply keys in insertion order, so the
            // requested columns must come first (in priority order) — `_id`
            // is only a trailing tiebreaker for deterministic pagination
            // when every requested key ties, not the primary key.
            let mut sort = bson::Document::new();
            for o in order_by {
                let dir = if o.dir == "DESC" { -1 } else { 1 };
                sort.insert(o.column.clone(), dir);
            }
            if !sort.contains_key("_id") {
                sort.insert("_id", 1);
            }
            opts.sort = Some(sort);
        }
        opts.skip = Some(offset.max(0) as u64);
        let limit_u = limit.max(0) as u64;
        if limit_u > 0 {
            opts.limit = Some(limit_u as i64);
        }
        col.find(filter.unwrap_or_default())
            .with_options(opts)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))
    }

    /// Execute a translated SQL `SELECT` (Phase 4: SQL-on-Mongo) as a Mongo
    /// `find()`, sending rows to `sink` in batches as the cursor yields them,
    /// and return the final column list. Explicit column lists
    /// (`SELECT a, b FROM ...`) drive the Mongo projection and fix the output
    /// columns; `SELECT *` grows its columns as new fields appear.
    pub(super) async fn run_select_plan(
        &self,
        database: &str,
        plan: &super::mongo_sql::SelectPlan,
        run: Option<&RunHandle>,
        sink: crate::db::BatchSink<'_>,
    ) -> DbResult<Vec<String>> {
        let (cursor, mut columns) = self.plan_cursor(database, plan, run).await?;
        stream_documents(cursor, &mut columns, run, sink, false).await
    }

    /// [`run_select_plan`], collecting every row in memory.
    pub(super) async fn collect_select_plan(
        &self,
        database: &str,
        plan: &super::mongo_sql::SelectPlan,
    ) -> DbResult<(Vec<String>, Vec<Vec<Option<String>>>)> {
        let (cursor, columns) = self.plan_cursor(database, plan, None).await?;
        collect_documents(cursor, columns, None).await
    }

    async fn plan_cursor(
        &self,
        database: &str,
        plan: &super::mongo_sql::SelectPlan,
        run: Option<&RunHandle>,
    ) -> DbResult<(mongodb::Cursor<bson::Document>, ColumnSet)> {
        let col = self
            .client
            .database(database)
            .collection::<bson::Document>(&plan.table);
        let mut opts = mongodb::options::FindOptions::builder().build();
        opts.comment = run_comment(run);
        opts.batch_size = Some(CURSOR_BATCH);
        if let Some(cols) = &plan.columns {
            let mut proj = bson::Document::new();
            for c in cols {
                proj.insert(c.as_str(), 1);
            }
            if !cols.iter().any(|c| c == "_id") {
                proj.insert("_id", 0);
            }
            opts.projection = Some(proj);
        }
        if let Some(sort) = &plan.sort {
            opts.sort = Some(sort.clone());
        }
        if let Some(limit) = plan.limit {
            if limit > 0 {
                opts.limit = Some(limit);
            }
        }
        if let Some(offset) = plan.offset {
            opts.skip = Some(offset.max(0) as u64);
        }
        let cursor = col
            .find(plan.filter.clone().unwrap_or_default())
            .with_options(opts)
            .await
            .map_err(|e| mongo_err(e, run))?;
        let columns = match &plan.columns {
            Some(cols) => ColumnSet::fixed(cols.clone()),
            None => ColumnSet::growing(),
        };
        Ok((cursor, columns))
    }

    /// Distinct cell values for one field (bounded), for enum-style editors.
    pub(super) async fn distinct_values(
        &self,
        database: &str,
        collection: &str,
        column: &str,
        limit: i64,
    ) -> DbResult<Vec<Option<String>>> {
        let col = self
            .client
            .database(database)
            .collection::<bson::Document>(collection);
        let vals = col
            .distinct(column, doc! {})
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut out: Vec<Option<String>> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for b in vals {
            let cell = json_cell_string(&Self::bson_to_json(b));
            if let Some(s) = cell {
                if seen.insert(s.clone()) {
                    out.push(Some(s));
                    if out.len() as i64 >= limit {
                        break;
                    }
                }
            }
        }
        Ok(out)
    }

    /// Field name → inferred BSON type, for typed cell coercion on writes.
    pub(super) async fn column_types(
        &self,
        database: &str,
        collection: &str,
    ) -> DbResult<std::collections::HashMap<String, String>> {
        let cols = self.inferred_schema(database, collection).await?;
        Ok(cols.into_iter().map(|c| (c.name, c.data_type)).collect())
    }

    pub(super) async fn list_documents_impl(
        &self,
        collection: &str,
        filter: Option<serde_json::Value>,
        skip: u64,
        limit: u64,
    ) -> DbResult<(Vec<serde_json::Value>, u64)> {
        let bson_filter = filter.and_then(|v| bson::to_document(&v).ok());
        self.list_documents(collection, bson_filter, skip, limit)
            .await
    }

    pub(super) async fn list_documents_ext(
        &self,
        collection: &str,
        filter: Option<serde_json::Value>,
        skip: u64,
        limit: u64,
    ) -> DbResult<(Vec<String>, u64)> {
        let bson_filter = filter.and_then(|v| bson::to_document(&v).ok());
        let col = self
            .client
            .database(&self.cur_database())
            .collection::<bson::Document>(collection);
        let total = col
            .count_documents(bson_filter.clone().unwrap_or_default())
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut cursor = col
            .find(bson_filter.unwrap_or_default())
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut docs = Vec::new();
        let mut skipped = 0u64;
        while let Some(doc) = cursor
            .try_next()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?
        {
            if skipped < skip {
                skipped += 1;
                continue;
            }
            if docs.len() >= limit as usize {
                break;
            }
            docs.push(super::mongo_json::render(&doc));
        }
        Ok((docs, total))
    }

    pub(super) async fn save_document(
        &self,
        collection: &str,
        id: &str,
        document_text: &str,
    ) -> DbResult<bool> {
        self.guard.check_write("document save")?;
        if !is_object_id_hex(id) {
            return Err(DbError::InvalidOperation(
                "cannot save document without an ObjectId _id".into(),
            ));
        }
        let oid = bson::oid::ObjectId::parse_str(id)
            .map_err(|e| DbError::InvalidOperation(format!("mongo _id: {e}")))?;
        let doc = super::mongo_json::parse(document_text)
            .map_err(|e| DbError::InvalidOperation(e.to_string()))?;
        let col = self
            .client
            .database(&self.cur_database())
            .collection::<bson::Document>(collection);
        let res = col
            .replace_one(doc! { "_id": oid }, doc)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        Ok(res.modified_count > 0 || res.matched_count > 0)
    }

    pub(super) async fn insert_document(&self, collection: &str, document_text: &str) -> DbResult<()> {
        self.guard.check_write("document insert")?;
        let doc = super::mongo_json::parse(document_text)
            .map_err(|e| DbError::InvalidOperation(e.to_string()))?;
        let col = self
            .client
            .database(&self.cur_database())
            .collection::<bson::Document>(collection);
        col.insert_one(doc)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        Ok(())
    }
}
