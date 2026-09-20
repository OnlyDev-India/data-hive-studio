use futures_util::TryStreamExt;
use crate::db::{DbError, DbResult};
use crate::api::IndexInfo;
use super::MongoAdapter;
use super::convert::bson_dir;

impl MongoAdapter {
    /// List a collection's indexes (Phase 5: index manager). `_id_` is
    /// Mongo's implicit primary-key index — reported with origin `"pk"` so
    /// the UI treats it as read-only, matching the SQL adapters' PK-index
    /// convention; every other index is `"c"` (explicit, editable/droppable).
    pub(super) async fn list_indexes(&self, database: &str, collection: &str) -> DbResult<Vec<IndexInfo>> {
        let col = self
            .client
            .database(database)
            .collection::<bson::Document>(collection);
        let mut cursor = col
            .list_indexes()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut out = Vec::new();
        while let Some(model) = cursor
            .try_next()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?
        {
            let name = model
                .options
                .as_ref()
                .and_then(|o| o.name.clone())
                .unwrap_or_default();
            let unique = model
                .options
                .as_ref()
                .and_then(|o| o.unique)
                .unwrap_or(false);
            let columns: Vec<String> = model.keys.iter().map(|(k, _)| k.clone()).collect();
            let column_dirs: Vec<i8> = model.keys.iter().map(|(_, v)| bson_dir(v)).collect();
            let sparse = model.options.as_ref().and_then(|o| o.sparse);
            let ttl_seconds = model
                .options
                .as_ref()
                .and_then(|o| o.expire_after)
                .map(|d| d.as_secs());
            let partial_filter = model
                .options
                .as_ref()
                .and_then(|o| o.partial_filter_expression.as_ref())
                .map(super::mongo_json::render);
            let origin = if name == "_id_" { "pk" } else { "c" };
            out.push(IndexInfo {
                name,
                unique,
                columns,
                origin: origin.into(),
                column_dirs: Some(column_dirs),
                sparse,
                ttl_seconds,
                partial_filter,
            });
        }
        Ok(out)
    }

    /// Create an index (Phase 5, extended per MONGODB_SUPPORT.md's index
    /// manager pass). `column_dirs` gives each field's sort direction
    /// (missing/short → ascending); `sparse`/`ttl_seconds`/`partial_filter`
    /// are optional MongoDB-specific index options with no SQL equivalent.
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn create_index(
        &self,
        database: &str,
        collection: &str,
        name: &str,
        columns: &[String],
        unique: bool,
        column_dirs: Option<&[i8]>,
        sparse: Option<bool>,
        ttl_seconds: Option<u64>,
        partial_filter: Option<&str>,
    ) -> DbResult<()> {
        self.guard.check_write("index change")?;
        if columns.is_empty() {
            return Err(DbError::InvalidOperation(
                "an index needs at least one column".into(),
            ));
        }
        let mut keys = bson::Document::new();
        for (i, c) in columns.iter().enumerate() {
            let dir = column_dirs
                .and_then(|d| d.get(i))
                .copied()
                .unwrap_or(1);
            keys.insert(c.as_str(), if dir < 0 { -1 } else { 1 });
        }
        // The typed-builder's generic state tracks which setters ran at the
        // type level, so setters can't be called conditionally (each call
        // changes the builder's type) — every setter is called unconditionally
        // with the already-Option value instead.
        let partial_filter_doc: Option<bson::Document> =
            match partial_filter.map(str::trim).filter(|s| !s.is_empty()) {
                Some(text) => Some(super::mongo_json::parse(text).map_err(|e| {
                    DbError::InvalidOperation(format!("invalid partial filter: {e}"))
                })?),
                None => None,
            };
        let options = mongodb::options::IndexOptions::builder()
            .name(name.to_string())
            .unique(unique)
            .sparse(sparse)
            .expire_after(ttl_seconds.map(std::time::Duration::from_secs))
            .partial_filter_expression(partial_filter_doc)
            .build();
        let model = mongodb::IndexModel::builder()
            .keys(keys)
            .options(Some(options))
            .build();
        let col = self
            .client
            .database(database)
            .collection::<bson::Document>(collection);
        col.create_index(model)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        Ok(())
    }

    /// Drop an index by name (Phase 5). The default `_id_` index can't be
    /// dropped — rejected here with a friendlier message than the server's.
    pub(super) async fn drop_index(&self, database: &str, collection: &str, name: &str) -> DbResult<()> {
        self.guard.check_write("index change")?;
        if name == "_id_" {
            return Err(DbError::InvalidOperation(
                "the default _id index cannot be dropped".into(),
            ));
        }
        let col = self
            .client
            .database(database)
            .collection::<bson::Document>(collection);
        col.drop_index(name)
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        Ok(())
    }
}
