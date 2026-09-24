use std::collections::HashMap;

use bson::{doc, Document};
use mongodb::error::ErrorKind;

use crate::api::{ImportCapabilities, ImportReport, ImportRequest, RowFailure};
use crate::db::import::{mongo_docs, Tally, BATCH_ROWS};
use crate::db::{DbError, DbResult};
use super::import_docs::to_document;
use super::MongoAdapter;

/// One failed document inside a batch: its position in the batch and why.
struct WriteProblem {
    at: usize,
    message: String,
}

impl MongoAdapter {
    /// Whether a rollback can undo an import here: a replica set or a sharded
    /// cluster (`hello` names a set, or answers `isdbgrid`). A standalone
    /// server has no transactions.
    pub(super) async fn import_capabilities(&self) -> DbResult<ImportCapabilities> {
        let hello = self
            .client
            .database("admin")
            .run_command(doc! { "hello": 1 })
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let atomic = hello.contains_key("setName") || hello.get_str("msg") == Ok("isdbgrid");
        Ok(ImportCapabilities { atomic })
    }

    /// Write an import of documents (spec 0008). Roll back and Check runs use
    /// one transaction when the server supports it: a write error aborts the
    /// transaction, so the report lists the failures of the first failing
    /// batch. Skip runs, and Roll back on a standalone server, insert each
    /// batch unordered without a transaction, so every bad document is listed
    /// and what landed stays landed (`atomic` is false).
    pub(super) async fn import_rows(
        &self,
        database: Option<&str>,
        req: &ImportRequest,
    ) -> DbResult<ImportReport> {
        self.guard.check_write("import")?;
        let docs = mongo_docs(req)?;
        let db = database.map(str::to_string).unwrap_or_else(|| self.cur_database());

        let supported = self.import_capabilities().await?.atomic;
        if req.dry_run && !supported {
            return Err(DbError::InvalidOperation(
                "Check needs a replica set or sharded cluster. This server has no transactions, \
                 so a check would really write."
                    .into(),
            ));
        }
        let use_txn = supported && (req.dry_run || req.on_error == crate::api::ImportOnError::Rollback);

        // The types the collection already uses, for converting CSV strings.
        let types: HashMap<String, String> = self.column_types(&db, &req.table).await?;
        let mut tally = Tally::new(req);
        let mut ready: Vec<(usize, Document)> = Vec::with_capacity(docs.len());
        for (i, map) in docs.iter().enumerate() {
            match to_document(map, &types) {
                Ok(d) => ready.push((i, d)),
                Err(p) => tally.fail(RowFailure {
                    index: i as u32,
                    column: Some(p.column),
                    message: p.message,
                }),
            }
        }

        let col = self.client.database(&db).collection::<Document>(&req.table);
        let mut session = None;
        if use_txn {
            let mut s = self.client.start_session().await.map_err(mongo_err)?;
            s.start_transaction().await.map_err(mongo_err)?;
            session = Some(s);
        }

        for chunk in ready.chunks(BATCH_ROWS) {
            if tally.should_stop() {
                break;
            }
            let insert = col.insert_many(chunk.iter().map(|(_, d)| d)).ordered(false);
            let result = match session.as_mut() {
                Some(s) => insert.session(s).await,
                None => insert.await,
            };
            match result {
                Ok(_) => tally.inserted += chunk.len() as u64,
                Err(e) => {
                    let Some(problems) = write_problems(&e) else {
                        if let Some(mut s) = session {
                            let _ = s.abort_transaction().await;
                        }
                        let landed = if use_txn || tally.inserted == 0 {
                            String::new()
                        } else {
                            format!(" {} document(s) were already written.", tally.inserted)
                        };
                        return Err(DbError::InvalidOperation(format!("mongo: {e}.{landed}")));
                    };
                    if !use_txn {
                        tally.inserted += (chunk.len() - problems.len().min(chunk.len())) as u64;
                    }
                    for p in problems {
                        let column = p.message.contains("index: _id_").then(|| "_id".to_string());
                        tally.fail(RowFailure { index: chunk[p.at].0 as u32, column, message: p.message });
                    }
                    // A transaction is dead after a write error, and Roll back
                    // on a standalone server has nothing to gain by going on.
                    if use_txn || req.on_error == crate::api::ImportOnError::Rollback {
                        break;
                    }
                }
            }
        }

        let commit = use_txn && tally.should_commit();
        if let Some(mut s) = session {
            if commit {
                s.commit_transaction().await.map_err(mongo_err)?;
            } else {
                let _ = s.abort_transaction().await;
            }
        }
        let committed = if use_txn { commit } else { tally.inserted > 0 };
        let statements = vec![format!(
            "db.{}.insertMany(…) -- {} document(s)",
            req.table,
            docs.len()
        )];
        Ok(tally.into_report(committed, use_txn, statements))
    }
}

fn mongo_err(e: mongodb::error::Error) -> DbError {
    DbError::InvalidOperation(format!("mongo: {e}"))
}

/// The per document write errors of a failed insert, or `None` when the
/// failure is something else (a lost connection, a write concern error).
fn write_problems(e: &mongodb::error::Error) -> Option<Vec<WriteProblem>> {
    let ErrorKind::InsertMany(many) = e.kind.as_ref() else { return None };
    let errors = many.write_errors.as_ref().filter(|w| !w.is_empty())?;
    Some(
        errors
            .iter()
            .map(|w| WriteProblem { at: w.index, message: w.message.clone() })
            .collect(),
    )
}
