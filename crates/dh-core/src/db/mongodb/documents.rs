use futures_util::TryStreamExt;
use bson::doc;
use crate::db::{DbError, DbResult, RunHandle};
use super::MongoAdapter;
use super::convert::flatten_documents;
use super::filter::{is_object_id_hex, json_cell_string};
use super::cancel::{mongo_err, run_comment};

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

    /// Read one page of documents as a grid-style result (columns = union of
    /// field names across the page, rows = flattened top-level cells). Returns
    /// the column list and the row cells. It does NOT count the collection:
    /// `count_documents` scans every match, and the grid asks for the total
    /// with its own `QueryOp::Count`, so counting here delayed the first row
    /// for a number nobody read.
    pub(super) async fn select_page(
        &self,
        database: &str,
        collection: &str,
        filter: Option<bson::Document>,
        order_by: &[crate::api::OrderByCond],
        limit: i64,
        offset: i64,
    ) -> DbResult<(Vec<String>, Vec<Vec<Option<String>>>)> {
        let col = self
            .client
            .database(database)
            .collection::<bson::Document>(collection);
        let mut opts = mongodb::options::FindOptions::builder().build();
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
        let skip_u = offset.max(0) as u64;
        opts.skip = Some(skip_u);
        let limit_u = limit.max(0) as u64;
        if limit_u > 0 {
            opts.limit = Some(limit_u as i64);
        }
        let mut cursor = col
            .find(filter.clone().unwrap_or_default())
            .with_options(opts)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;

        let mut docs: Vec<serde_json::Value> = Vec::new();
        while let Some(doc) = cursor
            .try_next()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?
        {
            docs.push(Self::document_to_json(doc));
        }

        // Column order: _id first, then first-seen field order across the page.
        let mut columns: Vec<String> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for doc in &docs {
            if let serde_json::Value::Object(map) = doc {
                for key in map.keys() {
                    if seen.insert(key.clone()) {
                        columns.push(key.clone());
                    }
                }
            }
        }
        // Put _id first so the grid's PK (from the pane schema) sorts naturally.
        if let Some(i) = columns.iter().position(|c| c == "_id") {
            let id = columns.remove(i);
            columns.insert(0, id);
        } else if columns.is_empty() {
            // No documents on this page (empty collection, or a filter that
            // matched nothing) — there's nothing to derive columns from, but
            // showing a completely columnless grid reads as broken rather
            // than "empty". Every document has an _id, so it's the one
            // column that's always a safe guess; mirrors the same fallback
            // `inferred_schema` already uses for the schema panel.
            columns.push("_id".to_string());
        }

        let mut rows: Vec<Vec<Option<String>>> = Vec::with_capacity(docs.len());
        for doc in &docs {
            rows.push(match doc {
                serde_json::Value::Object(map) => columns
                    .iter()
                    .map(|c| map.get(c).and_then(json_cell_string))
                    .collect(),
                other => columns.iter().map(|_| json_cell_string(other)).collect(),
            });
        }
        Ok((columns, rows))
    }

    /// Execute a translated SQL `SELECT` (Phase 4: SQL-on-Mongo) as a Mongo
    /// `find()` and project it into a grid-style column/row result. Explicit
    /// column lists (`SELECT a, b FROM ...`) drive the Mongo projection and
    /// fix the output column order; `SELECT *` falls back to the union-of-
    /// fields projection used elsewhere in this adapter.
    pub(super) async fn run_select_plan(
        &self,
        database: &str,
        plan: &super::mongo_sql::SelectPlan,
        run: Option<&RunHandle>,
    ) -> DbResult<(Vec<String>, Vec<Vec<Option<String>>>)> {
        let col = self
            .client
            .database(database)
            .collection::<bson::Document>(&plan.table);
        let mut opts = mongodb::options::FindOptions::builder().build();
        opts.comment = run_comment(run);
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
        let mut cursor = col
            .find(plan.filter.clone().unwrap_or_default())
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
        if let Some(cols) = &plan.columns {
            let rows = docs
                .iter()
                .map(|d| match d {
                    serde_json::Value::Object(map) => cols
                        .iter()
                        .map(|c| map.get(c).and_then(json_cell_string))
                        .collect(),
                    other => cols.iter().map(|_| json_cell_string(other)).collect(),
                })
                .collect();
            Ok((cols.clone(), rows))
        } else {
            Ok(flatten_documents(&docs))
        }
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
