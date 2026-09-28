use crate::db::{DbError, DbResult};
use crate::api::SchemaOp;
use super::MongoAdapter;

impl MongoAdapter {
    /// Explicitly create a collection ("New table" for a Mongo connection).
    /// Collections also spring into existence implicitly on first insert,
    /// but a dedicated create gives the UI an immediate, empty collection to
    /// open — the same experience CREATE TABLE gives the SQL adapters.
    pub(super) async fn create_collection(&self, database: Option<&str>, name: &str) -> DbResult<()> {
        self.guard.check_write("create collection")?;
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::InvalidOperation(
                "collection name cannot be empty".into(),
            ));
        }
        let db = database.map(str::to_string).unwrap_or_else(|| self.cur_database());
        self.client
            .database(&db)
            .create_collection(name)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))
    }

    /// Duplicate a collection under a new name (sidebar right-click). Indexes
    /// (everything but the implicit `_id_`, which Mongo creates on its own)
    /// are always copied; documents are copied only when `copy_data` is
    /// true, via a server-side `$out` aggregation so the whole collection
    /// never round-trips through this process regardless of its size.
    pub(super) async fn duplicate_table(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        source: &str,
        target: &str,
        copy_data: bool,
    ) -> DbResult<Vec<String>> {
        self.guard.check_write("duplicate collection")?;
        let db = database.map(str::to_string).unwrap_or_else(|| self.cur_database());
        let target = target.trim();
        if target.is_empty() {
            return Err(DbError::InvalidOperation(
                "collection name cannot be empty".into(),
            ));
        }
        let mut ran = Vec::new();

        self.client
            .database(&db)
            .create_collection(target)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        ran.push(format!("db.createCollection(\"{target}\")"));

        for ix in self.list_indexes(&db, source).await? {
            if ix.name == "_id_" {
                continue;
            }
            self.create_index(
                &db,
                target,
                &ix.name,
                &ix.columns,
                ix.unique,
                ix.column_dirs.as_deref(),
                ix.sparse,
                ix.ttl_seconds,
                ix.partial_filter.as_deref(),
            )
            .await?;
            ran.push(format!("db.{target}.createIndex(… \"{}\")", ix.name));
        }

        if copy_data {
            let col = self
                .client
                .database(&db)
                .collection::<bson::Document>(source);
            col.aggregate(vec![bson::doc! { "$out": target }])
                .await
                .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
            ran.push(format!("db.{source}.aggregate([{{ $out: \"{target}\" }}])"));
        }
        Ok(ran)
    }

    /// MongoDB is schemaless, so most `SchemaOp` DDL has no equivalent — the
    /// index-only subset (Phase 5) is the exception, since indexes are a real
    /// per-collection concept in Mongo. Ops run one at a time (no
    /// transaction — Mongo index DDL isn't part of the multi-doc transaction
    /// surface here); the first failure stops the batch.
    pub(super) async fn apply_schema_ops_batch(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        ops: &[SchemaOp],
    ) -> DbResult<Vec<String>> {
        if !ops.is_empty() {
            self.guard.check_write("schema changes")?;
        }
        let db = database.map(str::to_string).unwrap_or_else(|| self.cur_database());
        let mut stmts = Vec::with_capacity(ops.len());
        for op in ops {
            match op {
                SchemaOp::RenameTable { table, new_name } => {
                    // renameCollection is an admin command, not a per-database
                    // one — it takes fully-qualified `<db>.<collection>` names.
                    self.client
                        .database("admin")
                        .run_command(bson::doc! {
                            "renameCollection": format!("{db}.{table}"),
                            "to": format!("{db}.{new_name}"),
                        })
                        .await
                        .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
                    stmts.push(format!(
                        "db.adminCommand({{ renameCollection: \"{db}.{table}\", to: \"{db}.{new_name}\" }})"
                    ));
                }
                SchemaOp::CreateIndex {
                    table,
                    name,
                    columns,
                    unique,
                    column_dirs,
                    sparse,
                    ttl_seconds,
                    partial_filter,
                } => {
                    self.create_index(
                        &db,
                        table,
                        name,
                        columns,
                        *unique,
                        column_dirs.as_deref(),
                        *sparse,
                        *ttl_seconds,
                        partial_filter.as_deref(),
                    )
                    .await?;
                    let keys = columns
                        .iter()
                        .enumerate()
                        .map(|(i, c)| {
                            let dir = column_dirs
                                .as_deref()
                                .and_then(|d| d.get(i))
                                .copied()
                                .unwrap_or(1);
                            format!("{c}: {}", if dir < 0 { -1 } else { 1 })
                        })
                        .collect::<Vec<_>>()
                        .join(", ");
                    let mut opts = vec![format!("name: \"{name}\"")];
                    opts.push(format!("unique: {unique}"));
                    if let Some(s) = sparse {
                        opts.push(format!("sparse: {s}"));
                    }
                    if let Some(secs) = ttl_seconds {
                        opts.push(format!("expireAfterSeconds: {secs}"));
                    }
                    if let Some(pf) = partial_filter.as_deref().filter(|s| !s.trim().is_empty()) {
                        opts.push(format!("partialFilterExpression: {pf}"));
                    }
                    stmts.push(format!(
                        "db.{table}.createIndex({{ {keys} }}, {{ {} }})",
                        opts.join(", ")
                    ));
                }
                SchemaOp::DropIndex { table, index } => {
                    let Some(table) = table else {
                        return Err(DbError::InvalidOperation(
                            "dropping a MongoDB index requires its collection name".into(),
                        ));
                    };
                    self.drop_index(&db, table, index).await?;
                    stmts.push(format!("db.{table}.dropIndex(\"{index}\")"));
                }
                _ => {
                    return Err(DbError::InvalidOperation(
                        "MongoDB is schemaless; only index create/drop is supported".into(),
                    ))
                }
            }
        }
        Ok(stmts)
    }
}
