use mongodb::action::Action;
use futures_util::TryStreamExt;
use crate::db::read_only::{refused, Dialect};
use crate::db::{DbError, DbResult, RunHandle};
use crate::api::QueryResult;
use super::MongoAdapter;
use super::console_guard::console_refusal;
use super::convert::flatten_documents;
use super::filter::json_cell_string;
use super::cancel::{mongo_err, run_comment};
use super::console_parse::{parse_chain, parse_db_call, parse_filter, parse_json_object, parse_json_object_array, split_top_level, validate_chain};

impl MongoAdapter {
    /// Execute one MongoDB console command. `db` is the console's current
    /// database context (may be switched via `use <db>`); `collection` is used
    /// only for bare JSON query/pipeline input. Returns a grid-projected result
    /// plus the raw JSON documents, so the UI can show both grid and JSON.
    async fn run_mongo_impl(
        &self,
        db: &str,
        collection: Option<&str>,
        script: &str,
        run: Option<&RunHandle>,
    ) -> DbResult<crate::api::MongoRunResult> {
        let start = std::time::Instant::now();
        let s = script.trim();
        let fail = |msg: String| crate::api::MongoRunResult {
            error: Some(msg),
            elapsed_ms: start.elapsed().as_millis(),
            ..Default::default()
        };
        if s.is_empty() {
            return Ok(fail(
                "Empty command. Try a JSON query, db.<collection>.find(...), or show collections"
                    .into(),
            ));
        }
        // `use <db>` — switch the console's database context.
        if let Some(name) = s
            .strip_prefix("use ")
            .map(str::trim)
            .filter(|n| !n.is_empty())
        {
            let name = name.trim_end_matches(';').trim().to_string();
            return Ok(crate::api::MongoRunResult {
                command: format!("use {name}"),
                message: Some(format!("Switched to database {name}")),
                switch_db: Some(name),
                elapsed_ms: start.elapsed().as_millis(),
                ..Default::default()
            });
        }
        if s == "show dbs" || s == "show databases" {
            let names = self.list_databases().await?;
            return Ok(crate::api::MongoRunResult {
                command: s.to_string(),
                is_select: true,
                columns: vec!["database".into()],
                rows: names.into_iter().map(|n| vec![Some(n)]).collect(),
                message: Some("databases".into()),
                elapsed_ms: start.elapsed().as_millis(),
                ..Default::default()
            });
        }
        if s == "show collections" || s == "show tables" {
            let col = self.client.database(db);
            let names = col
                .list_collection_names()
                .await
                .map_err(|e| mongo_err(e, run))?;
            return Ok(crate::api::MongoRunResult {
                command: s.to_string(),
                is_select: true,
                columns: vec!["collection".into()],
                rows: names.into_iter().map(|n| vec![Some(n)]).collect(),
                message: Some("collections".into()),
                elapsed_ms: start.elapsed().as_millis(),
                ..Default::default()
            });
        }
        if s.starts_with("db.") {
            self.arm_kill_op(run).await?;
            return self.run_db_call(db, s, start, run).await;
        }
        // Bare JSON: object → find (needs a collection), array → aggregate.
        if s.starts_with('{') || s.starts_with('[') {
            if let Some(coll) = collection {
                self.arm_kill_op(run).await?;
                return self.run_bare_json(db, coll, s, start, run).await;
            }
            return Ok(fail(
                "A bare query needs a collection — use db.<collection>.find(<query>) instead"
                    .into(),
            ));
        }
        Ok(fail(format!(
            "Unrecognized command. Try a JSON query, db.<collection>.find(...), aggregate(...), count(...), or show collections.\nGot: {}",
            if s.len() > 80 { format!("{}…", &s[..80]) } else { s.to_string() }
        )))
    }

    /// Execute a `db.<collection>.<method>(...)` command.
    async fn run_db_call(
        &self,
        db: &str,
        s: &str,
        start: std::time::Instant,
        run: Option<&RunHandle>,
    ) -> DbResult<crate::api::MongoRunResult> {
        let comment = run_comment(run);
        let Some(call) = parse_db_call(s) else {
            return Ok(crate::api::MongoRunResult {
                error: Some(format!(
                    "Could not parse `{s}` as db.<collection>.<method>(...)"
                )),
                elapsed_ms: start.elapsed().as_millis(),
                ..Default::default()
            });
        };
        let f = |msg: String| crate::api::MongoRunResult {
            error: Some(msg),
            elapsed_ms: start.elapsed().as_millis(),
            ..Default::default()
        };
        if let Err(e) = validate_chain(&call.chain) {
            return Ok(f(e.to_string()));
        }
        let col = self
            .client
            .database(db)
            .collection::<bson::Document>(&call.coll);
        let command = || format!("db.{}.{}({})", call.coll, call.method, call.args);
        match call.method.as_str() {
            "find" | "findOne" => {
                let chain = parse_chain(&call.chain);
                let filter = parse_filter(&call.args)?;
                let is_one = call.method == "findOne";
                let mut opts = mongodb::options::FindOptions::builder().build();
                opts.comment = comment.clone();
                if let Some(sort) = &chain.sort {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(
                        &super::mongo_json::quote_bare_keys(sort),
                    ) {
                        if let Ok(d) = bson::to_document(&v) {
                            opts.sort = Some(d);
                        }
                    }
                }
                if is_one {
                    opts.limit = Some(1);
                } else if let Some(n) = chain.limit {
                    if n > 0 {
                        opts.limit = Some(n);
                    }
                } else {
                    // No explicit limit — cap so a bare find() can't stream
                    // the whole collection into the console.
                    opts.limit = Some(200);
                }
                let mut cursor = col
                    .find(filter.clone().unwrap_or_default())
            .with_options(opts)
                    .await
                    .map_err(|e| mongo_err(e, run))?;
                let mut docs: Vec<serde_json::Value> = Vec::new();
                while let Some(d) = cursor.try_next().await.map_err(|e| mongo_err(e, run))? {
                    docs.push(Self::document_to_json(d));
                }
                let (columns, rows) = flatten_documents(&docs);
                Ok(crate::api::MongoRunResult {
                    command: command(),
                    columns,
                    rows,
                    documents: docs.clone(),
                    is_select: true,
                    message: if is_one && docs.is_empty() {
                        Some("No matching document".into())
                    } else {
                        None
                    },
                    elapsed_ms: start.elapsed().as_millis(),
                    ..Default::default()
                })
            }
            "count" | "countDocuments" => {
                let filter = parse_filter(&call.args)?;
                let n = col
                    .count_documents(filter.clone().unwrap_or_default())
                    .optional(comment.clone(), |a, c| a.comment(c))
                    .await
                    .map_err(|e| mongo_err(e, run))?;
                Ok(crate::api::MongoRunResult {
                    command: command(),
                    columns: vec!["count".into()],
                    rows: vec![vec![Some(n.to_string())]],
                    is_select: true,
                    documents: vec![serde_json::json!({ "count": n })],
                    elapsed_ms: start.elapsed().as_millis(),
                    ..Default::default()
                })
            }
            "distinct" => {
                let parts = split_top_level(&call.args);
                let field = parts
                    .first()
                    .map(|p| p.trim().trim_matches(['"', '\'']).to_string())
                    .filter(|p| !p.is_empty());
                let Some(field) = field else {
                    return Ok(f("db.<collection>.distinct requires a field name".into()));
                };
                let filter = if parts.len() > 1 {
                    parse_filter(&parts[1])?
                } else {
                    None
                };
                let vals = col
                    .distinct(&field, filter.clone().unwrap_or_default())
                    .optional(comment.clone(), |a, c| a.comment(c))
                    .await
                    .map_err(|e| mongo_err(e, run))?;
                let docs: Vec<serde_json::Value> =
                    vals.into_iter().map(Self::bson_to_json).collect();
                let rows = docs
                    .iter()
                    .map(|d| vec![json_cell_string(d)])
                    .collect::<Vec<Vec<Option<String>>>>();
                Ok(crate::api::MongoRunResult {
                    command: command(),
                    columns: vec![field.clone()],
                    rows,
                    documents: docs,
                    is_select: true,
                    elapsed_ms: start.elapsed().as_millis(),
                    ..Default::default()
                })
            }
            "aggregate" => {
                let parsed: serde_json::Value =
                    serde_json::from_str(&super::mongo_json::quote_bare_keys(&call.args))
                        .map_err(|e| DbError::InvalidOperation(format!("invalid pipeline JSON: {e}")))?;
                if !parsed.is_array() {
                    return Ok(f("aggregate pipeline must be a JSON array".into()));
                }
                let stages: Vec<bson::Document> = parsed
                    .as_array()
                    .unwrap_or(&Vec::new())
                    .iter()
                    .map(|v| {
                        bson::to_document(v).map_err(|e| {
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
                while let Some(d) = cursor.try_next().await.map_err(|e| mongo_err(e, run))? {
                    docs.push(Self::document_to_json(d));
                }
                let (columns, rows) = flatten_documents(&docs);
                Ok(crate::api::MongoRunResult {
                    command: command(),
                    columns,
                    rows,
                    documents: docs,
                    is_select: true,
                    elapsed_ms: start.elapsed().as_millis(),
                    ..Default::default()
                })
            }
            "insertOne" => {
                let doc = parse_json_object(&call.args, "insertOne document")?;
                let res = col
                    .insert_one(doc)
                    .optional(comment.clone(), |a, c| a.comment(c))
                    .await
                    .map_err(|e| mongo_err(e, run))?;
                let id = json_cell_string(&Self::bson_to_json(res.inserted_id))
                    .unwrap_or_default();
                Ok(crate::api::MongoRunResult {
                    command: command(),
                    rows_affected: 1,
                    message: Some(format!("Inserted 1 document (_id: {id})")),
                    elapsed_ms: start.elapsed().as_millis(),
                    ..Default::default()
                })
            }
            "insertMany" => {
                let docs = parse_json_object_array(&call.args, "insertMany documents")?;
                if docs.is_empty() {
                    return Ok(f("insertMany requires a non-empty array of documents".into()));
                }
                let res = col
                    .insert_many(docs)
                    .optional(comment.clone(), |a, c| a.comment(c))
                    .await
                    .map_err(|e| mongo_err(e, run))?;
                let n = res.inserted_ids.len();
                Ok(crate::api::MongoRunResult {
                    command: command(),
                    rows_affected: n as u64,
                    message: Some(format!("Inserted {n} document{}", if n == 1 { "" } else { "s" })),
                    elapsed_ms: start.elapsed().as_millis(),
                    ..Default::default()
                })
            }
            "updateOne" | "updateMany" => {
                let parts = split_top_level(&call.args);
                let filter = match parts.first() {
                    Some(q) => parse_filter(q)?.unwrap_or_default(),
                    None => bson::Document::new(),
                };
                let Some(update_arg) = parts.get(1) else {
                    return Ok(f(format!(
                        "db.<collection>.{} requires an update document as the second argument, e.g. {{\"$set\": {{...}}}}",
                        call.method
                    )));
                };
                let update = parse_json_object(update_arg, "update document")?;
                let res = if call.method == "updateMany" {
                    col.update_many(filter, update).optional(comment.clone(), |a, c| a.comment(c)).await
                } else {
                    col.update_one(filter, update).optional(comment.clone(), |a, c| a.comment(c)).await
                }
                .map_err(|e| mongo_err(e, run))?;
                Ok(crate::api::MongoRunResult {
                    command: command(),
                    rows_affected: res.modified_count,
                    message: Some(format!(
                        "Matched {}, modified {}",
                        res.matched_count, res.modified_count
                    )),
                    elapsed_ms: start.elapsed().as_millis(),
                    ..Default::default()
                })
            }
            "deleteOne" | "deleteMany" => {
                let filter = parse_filter(&call.args)?.unwrap_or_default();
                let res = if call.method == "deleteMany" {
                    col.delete_many(filter).optional(comment.clone(), |a, c| a.comment(c)).await
                } else {
                    col.delete_one(filter).optional(comment.clone(), |a, c| a.comment(c)).await
                }
                .map_err(|e| mongo_err(e, run))?;
                Ok(crate::api::MongoRunResult {
                    command: command(),
                    rows_affected: res.deleted_count,
                    message: Some(format!(
                        "Deleted {} document{}",
                        res.deleted_count,
                        if res.deleted_count == 1 { "" } else { "s" }
                    )),
                    elapsed_ms: start.elapsed().as_millis(),
                    ..Default::default()
                })
            }
            other => Ok(f(format!(
                "Unsupported method `{other}` on collections. Supported: find, findOne, count, countDocuments, distinct, aggregate, insertOne, insertMany, updateOne, updateMany, deleteOne, deleteMany."
            ))),
        }
    }

    pub(super) async fn run_mongo(
        &self,
        db: &str,
        collection: Option<&str>,
        script: &str,
        run: Option<&RunHandle>,
    ) -> DbResult<crate::api::MongoRunResult> {
        // Before anything runs or a canceller is armed.
        if self.guard.is_on() {
            if let Some(reason) = console_refusal(script) {
                return Err(refused(reason));
            }
        }
        let res = self.run_mongo_impl(db, collection, script, run).await;
        // Nothing left for a late Stop to reach once the run is over.
        if let Some(run) = run {
            run.finish().await;
        }
        res
    }

    /// SQL-on-Mongo (Phase 4): a `SELECT ... FROM ... [WHERE ...] [ORDER BY
    /// ...] [LIMIT ...] [OFFSET ...]` subset (no JOINs, no schema needed) is
    /// translated to a `find()` and run for real. Anything else (writes,
    /// DDL, JOINs) is out of the supported subset — use the grid or the
    /// MongoDB console instead.
    pub(super) async fn run_sql(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        sql: &str,
    ) -> DbResult<QueryResult> {
        self.guard.check_sql(Dialect::Postgres, sql)?;
        let db = database.map(str::to_string).unwrap_or_else(|| self.cur_database());
        let start = std::time::Instant::now();
        if !super::mongo_sql::is_select(sql) {
            return Err(DbError::InvalidOperation(
                "MongoDB SQL support currently covers SELECT only (WHERE/ORDER BY/LIMIT/OFFSET, no JOINs); use the grid or the MongoDB console for writes".into(),
            ));
        }
        let plan = super::mongo_sql::translate_select(sql)
            .map_err(|e| DbError::InvalidOperation(e.to_string()))?;
        let (columns, rows) = self.run_select_plan(&db, &plan, None).await?;
        Ok(QueryResult {
            columns,
            rows,
            rows_affected: 0,
            is_select: true,
            error: None,
            elapsed_ms: start.elapsed().as_millis(),
            cancelled: false,
        })
    }

    pub(super) async fn execute_params(
        &self,
        _database: Option<&str>,
        _sql: &str,
        _params: &[Option<String>],
    ) -> DbResult<u64> {
        self.guard.check_sql(Dialect::Postgres, _sql)?;
        Err(DbError::InvalidOperation(
            "MongoDB SQL support is read-only (SELECT) for now; use the grid or the MongoDB console to write".into(),
        ))
    }

    pub(super) async fn run_sql_params(
        &self,
        database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<QueryResult> {
        // Our SQL subset has no placeholder syntax of its own — inline the
        // bound `?` params as literals first (same helper the SQL adapters
        // use for the activity log), then translate as plain SQL text.
        let inlined = super::inline_placeholders(sql, params, false);
        self.run_sql(database, None, &inlined).await
    }
}
