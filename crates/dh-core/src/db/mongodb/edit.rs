use bson::doc;
use crate::db::read_only::Dialect;
use crate::db::{BatchSink, DbError, DbResult, OpOutcome, QueryChunk, RunHandle};
use crate::api::{QueryOp, QueryResult};
use super::MongoAdapter;
use super::filter::{build_filter, field_bson, filter_desc, filter_from_match_row};

impl MongoAdapter {
    pub(super) async fn execute_op(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        op: &QueryOp,
    ) -> DbResult<OpOutcome> {
        self.guard.check_op(op)?;
        let db = database.map(str::to_string).unwrap_or_else(|| self.cur_database());
        let start = std::time::Instant::now();
        match op {
            QueryOp::Select {
                table,
                filters,
                custom_where,
                order_by,
                limit,
                offset,
            } => {
                let filter = build_filter(filters, custom_where.as_deref())?;
                let desc = filter_desc(&filter);
                let (columns, rows) = self
                    .select_page(
                        &db,
                        table,
                        filter,
                        order_by,
                        limit.unwrap_or(50),
                        offset.unwrap_or(0),
                    )
                    .await?;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns,
                        rows,
                        rows_affected: 0,
                        is_select: true,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                        cancelled: false,
                    },
                    sql: Some(format!("db.{table}.find({desc})")),
                })
            }
            QueryOp::Count {
                table,
                filters,
                custom_where,
            } => {
                let filter = build_filter(filters, custom_where.as_deref())?;
                let desc = filter_desc(&filter);
                let col = self
                    .client
                    .database(&db)
                    .collection::<bson::Document>(table);
                let total = col
                    .count_documents(filter.clone().unwrap_or_default())
                    .await
                    .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: vec!["count".into()],
                        rows: vec![vec![Some(total.to_string())]],
                        rows_affected: 0,
                        is_select: true,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                        cancelled: false,
                    },
                    sql: Some(format!("db.{table}.countDocuments({desc})")),
                })
            }
            QueryOp::SelectDistinct {
                table,
                column,
                limit,
            } => {
                let vals = self
                    .distinct_values(&db, table, column, limit.unwrap_or(100))
                    .await?;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: vec![column.clone()],
                        rows: vals.into_iter().map(|v| vec![v]).collect(),
                        rows_affected: 0,
                        is_select: true,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                        cancelled: false,
                    },
                    sql: Some(format!("db.{table}.distinct(\"{column}\")")),
                })
            }
            QueryOp::BulkUpdate {
                table,
                column,
                value,
                filters,
                custom_where,
            } => {
                let filter = build_filter(filters, custom_where.as_deref())?.unwrap_or_default();
                let desc = filter_desc(&Some(filter.clone()));
                let cols = self.column_types(&db, table).await?;
                let mut set_doc = bson::Document::new();
                set_doc.insert(
                    column,
                    field_bson(value.as_deref(), cols.get(column).map(String::as_str)),
                );
                let col = self
                    .client
                    .database(&db)
                    .collection::<bson::Document>(table);
                let res = col
                    .update_many(filter, doc! { "$set": set_doc })
                    .await
                    .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        rows_affected: res.modified_count,
                        is_select: false,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                        cancelled: false,
                    },
                    sql: Some(format!(
                        "db.{table}.updateMany({desc}, {{$set: {{{column}: ...}}}})"
                    )),
                })
            }
            QueryOp::Update {
                table,
                set,
                match_row,
            } => {
                let filter = filter_from_match_row(match_row);
                let cols = self.column_types(&db, table).await?;
                let mut set_doc = bson::Document::new();
                for (k, v) in set {
                    if k == "_id" {
                        continue;
                    }
                    set_doc.insert(k, field_bson(v.as_deref(), cols.get(k).map(String::as_str)));
                }
                let col = self
                    .client
                    .database(&db)
                    .collection::<bson::Document>(table);
                let res = col
                    .update_many(filter.clone(), doc! { "$set": set_doc })
                    .await
                    .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        rows_affected: res.modified_count,
                        is_select: false,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                        cancelled: false,
                    },
                    sql: Some(format!(
                        "db.{table}.updateMany({}, {{$set: ...}})",
                        filter_desc(&Some(filter))
                    )),
                })
            }
            QueryOp::Delete { table, match_row } => {
                let filter = filter_from_match_row(match_row);
                let col = self
                    .client
                    .database(&db)
                    .collection::<bson::Document>(table);
                let res = col
                    .delete_many(filter.clone())
                    .await
                    .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        rows_affected: res.deleted_count,
                        is_select: false,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                        cancelled: false,
                    },
                    sql: Some(format!(
                        "db.{table}.deleteMany({})",
                        filter_desc(&Some(filter))
                    )),
                })
            }
            QueryOp::Insert {
                table,
                values,
                skip_empty,
            } => {
                let cols = self.column_types(&db, table).await?;
                let mut doc = bson::Document::new();
                for (k, v) in values {
                    let is_empty = v.as_deref().is_none_or(|s| s.is_empty());
                    // An empty `_id` is always omitted, regardless of
                    // `skip_empty` — sending an explicit null/empty `_id`
                    // would either fail (duplicate key on a second insert,
                    // since only one document per collection may have
                    // `_id: null`) or pin it to an empty string; omitting
                    // the key lets MongoDB generate a real ObjectId, same as
                    // `db.coll.insertOne({})` does.
                    let drop_empty = if k == "_id" { is_empty } else { *skip_empty && is_empty };
                    if drop_empty {
                        continue;
                    }
                    doc.insert(k, field_bson(v.as_deref(), cols.get(k).map(String::as_str)));
                }
                let col = self
                    .client
                    .database(&db)
                    .collection::<bson::Document>(table);
                col.insert_one(doc.clone())
                    .await
                    .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        rows_affected: 1,
                        is_select: false,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                        cancelled: false,
                    },
                    sql: Some(format!(
                        "db.{table}.insertOne({})",
                        serde_json::to_string(&doc).unwrap_or_default()
                    )),
                })
            }
            QueryOp::DropTable { table } => {
                let col = self
                    .client
                    .database(&db)
                    .collection::<bson::Document>(table);
                col.drop()
                    .await
                    .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        rows_affected: 0,
                        is_select: false,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                        cancelled: false,
                    },
                    sql: Some(format!("db.{table}.drop()")),
                })
            }
        }
    }

    pub(super) async fn execute_op_stream(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        op: &QueryOp,
        on_batch: BatchSink<'_>,
    ) -> DbResult<OpOutcome> {
        self.guard.check_op(op)?;
        let db = database.map(str::to_string).unwrap_or_else(|| self.cur_database());
        let start = std::time::Instant::now();
        match op {
            QueryOp::Select {
                table,
                filters,
                custom_where,
                order_by,
                limit,
                offset,
            } => {
                let filter = build_filter(filters, custom_where.as_deref())?;
                let (columns, rows) = self
                    .select_page(
                        &db,
                        table,
                        filter.clone(),
                        order_by,
                        limit.unwrap_or(50),
                        offset.unwrap_or(0),
                    )
                    .await?;
                // First chunk carries the column names, later chunks the rows.
                on_batch(QueryChunk {
                    columns: Some(columns.clone()),
                    rows: Vec::new(),
                })?;
                let mut batch: Vec<Vec<Option<String>>> = Vec::new();
                let mut size = 0usize;
                for row in &rows {
                    batch.push(row.clone());
                    size += 1;
                    if size >= 500 {
                        on_batch(QueryChunk {
                            columns: None,
                            rows: std::mem::take(&mut batch),
                        })?;
                        size = 0;
                    }
                }
                if !batch.is_empty() {
                    on_batch(QueryChunk {
                        columns: None,
                        rows: batch,
                    })?;
                }
                Ok(OpOutcome {
                    result: QueryResult {
                        columns,
                        rows: Vec::new(),
                        rows_affected: 0,
                        is_select: true,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                        cancelled: false,
                    },
                    sql: Some(format!("db.{table}.find({})", filter_desc(&filter))),
                })
            }
            QueryOp::SelectDistinct {
                table,
                column,
                limit,
            } => {
                let vals = self
                    .distinct_values(&db, table, column, limit.unwrap_or(100))
                    .await?;
                on_batch(QueryChunk {
                    columns: Some(vec![column.clone()]),
                    rows: Vec::new(),
                })?;
                for v in vals {
                    on_batch(QueryChunk {
                        columns: None,
                        rows: vec![vec![v]],
                    })?;
                }
                Ok(OpOutcome {
                    result: QueryResult {
                        columns: vec![column.clone()],
                        rows: Vec::new(),
                        rows_affected: 0,
                        is_select: true,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                        cancelled: false,
                    },
                    sql: Some(format!("db.{table}.distinct(\"{column}\")")),
                })
            }
            QueryOp::Count { .. } => self.execute_op(database, schema, op).await,
            _ => self.execute_op(database, schema, op).await,
        }
    }

    pub(super) async fn run_sql_stream(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        sql: &str,
        run: Option<&RunHandle>,
        on_batch: BatchSink<'_>,
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
        self.arm_kill_op(run).await?;
        let planned = self.run_select_plan(&db, &plan, run).await;
        // Nothing left for a late Stop to reach once the query is over.
        if let Some(run) = run {
            run.finish().await;
        }
        let (columns, rows) = planned?;
        on_batch(QueryChunk {
            columns: Some(columns.clone()),
            rows: Vec::new(),
        })?;
        let mut batch: Vec<Vec<Option<String>>> = Vec::new();
        for row in rows {
            batch.push(row);
            if batch.len() >= 500 {
                on_batch(QueryChunk {
                    columns: None,
                    rows: std::mem::take(&mut batch),
                })?;
            }
        }
        if !batch.is_empty() {
            on_batch(QueryChunk {
                columns: None,
                rows: batch,
            })?;
        }
        Ok(QueryResult {
            columns,
            rows: Vec::new(),
            rows_affected: 0,
            is_select: true,
            error: None,
            elapsed_ms: start.elapsed().as_millis(),
            cancelled: false,
        })
    }
}
