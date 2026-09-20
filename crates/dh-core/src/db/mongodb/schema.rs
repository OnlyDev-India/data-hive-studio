use futures_util::TryStreamExt;
use crate::db::{DbError, DbResult};
use crate::api::{ColumnInfo, FieldShape, TableInfo, TableSchema};
use super::field_tree::{FIELD_TREE_NODE_BUDGET, FieldTreeAccum, accumulate_field_tree, build_field_children};
use super::MongoAdapter;
use super::convert::bson_type_name;

impl MongoAdapter {
    /// Collect the union of top-level field names across a sample of up to 200
    /// documents, with each field's most-common BSON type. Used to build a
    /// best-effort "schema" for the explorer (MongoDB is schemaless).
    pub(super) async fn inferred_schema(&self, database: &str, collection: &str) -> DbResult<Vec<ColumnInfo>> {
        let col = self
            .client
            .database(database)
            .collection::<bson::Document>(collection);
        let mut cursor = col
            .find(bson::doc! {})
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut types: std::collections::BTreeMap<
            String,
            std::collections::HashMap<&'static str, usize>,
        > = std::collections::BTreeMap::new();
        let mut count = 0;
        while let Some(doc) = cursor
            .try_next()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?
        {
            for (k, v) in doc.iter() {
                let t = bson_type_name(v);
                let entry = types.entry(k.clone()).or_default();
                *entry.entry(t).or_insert(0) += 1;
            }
            count += 1;
            if count >= 200 {
                break;
            }
        }
        if types.is_empty() {
            // Empty collection — nothing to infer; default to a single _id.
            return Ok(vec![ColumnInfo {
                name: "_id".into(),
                data_type: "objectid".into(),
                not_null: false,
                primary_key: true,
                default: None,
                enum_values: Default::default(),
                is_array: false,
            }]);
        }
        Ok(types
            .into_iter()
            .map(|(name, freq)| {
                let data_type = freq
                    .iter()
                    .max_by_key(|(_, n)| **n)
                    .map(|(t, _)| *t)
                    .unwrap_or("bson")
                    .to_string();
                let primary_key = name == "_id";
                let is_array = data_type == "array";
                ColumnInfo {
                    name,
                    data_type,
                    not_null: false,
                    primary_key,
                    default: None,
                    enum_values: Default::default(),
                    is_array,
                }
            })
            .collect())
    }

    /// The recursively inferred nested field shape for the "Fields" view
    /// (spec 0001) — a per-path tree instead of `inferred_schema`'s flat
    /// list, sampled independently so `table_schema`/`ColumnInfo`/the data
    /// grid's column headers are never affected by this. Samples the same
    /// up to 200 documents, then walks each recursively (up to 6 levels,
    /// up to 20 elements per array) accumulating per-path stats, then builds
    /// the `FieldShape` tree from those stats.
    async fn sample_field_tree(
        &self,
        database: &str,
        collection: &str,
    ) -> DbResult<Vec<FieldShape>> {
        let col = self
            .client
            .database(database)
            .collection::<bson::Document>(collection);
        let mut cursor = col
            .find(bson::doc! {})
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        let mut accum = FieldTreeAccum::default();
        let mut sample_count = 0usize;
        while let Some(doc) = cursor
            .try_next()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?
        {
            accumulate_field_tree(&doc, "", 0, &mut accum);
            sample_count += 1;
            if sample_count >= 200 {
                break;
            }
        }
        if sample_count == 0 {
            // Empty collection — nothing to infer; default to a single _id,
            // matching `inferred_schema`'s own empty-collection fallback.
            return Ok(vec![FieldShape {
                name: "_id".into(),
                path: "_id".into(),
                bson_type: "objectid".into(),
                optional: false,
                children: Vec::new(),
                element_types: Vec::new(),
                truncated: None,
                empty: false,
                depth_truncated: false,
            }]);
        }
        let mut budget = FIELD_TREE_NODE_BUDGET;
        // Root fields are never key-capped (matches `inferred_schema`, which
        // never truncates the top-level field list either) — the 50 key cap
        // targets the realistic "wide object" case (a dynamic map nested
        // inside a field), not a collection's own top-level field count.
        let (fields, _truncated, _budget_hit) =
            build_field_children("", 1, sample_count, None, &accum, &mut budget);
        Ok(fields)
    }

    pub(super) async fn list_tables(&self) -> DbResult<Vec<TableInfo>> {
        let names = self
            .client
            .database(&self.cur_database())
            .list_collection_names()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        Ok(names
            .into_iter()
            .map(|name| TableInfo {
                name,
                kind: "table".into(),
            })
            .collect())
    }

    pub(super) async fn table_schema(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        table: &str,
    ) -> DbResult<(TableSchema, Vec<String>)> {
        let db = database.map(str::to_string).unwrap_or_else(|| self.cur_database());
        // The field sample and the index listing don't depend on each other,
        // so they share one round trip of latency instead of paying two.
        let (columns, indexes) = tokio::join!(
            self.inferred_schema(&db, table),
            self.list_indexes(&db, table),
        );
        let columns = columns?;
        // Index listing degrades gracefully (empty) rather than failing the
        // whole schema fetch — browsing a collection shouldn't break because
        // of a transient listIndexes issue.
        let indexes = indexes.unwrap_or_default();
        Ok((
            TableSchema {
                // "table" → the grid renders the collection with editable
                // cells; grid CRUD maps to Mongo update/insert/delete ops.
                kind: "table".into(),
                columns,
                foreign_keys: Vec::new(),
                indexes,
                triggers: Vec::new(),
            },
            vec![
                format!("db.{table}.find().limit(200) / sample to infer fields"),
                format!("db.{table}.getIndexes()"),
            ],
        ))
    }

    /// Spec 0001's "Fields" view — deliberately independent of
    /// `table_schema` above: this never touches `ColumnInfo`/`TableSchema`,
    /// so the data grid's column headers can't be affected by it.
    pub(super) async fn field_tree(&self, database: &str, collection: &str) -> DbResult<Vec<FieldShape>> {
        self.sample_field_tree(database, collection).await
    }

    pub(super) async fn list_schemas(&self) -> DbResult<Vec<String>> {
        Ok(vec![])
    }

    pub(super) async fn list_databases(&self) -> DbResult<Vec<String>> {
        let names = self
            .client
            .list_database_names()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        Ok(names)
    }

    /// The sidebar catalog tree's Mongo shape is just database → collections
    /// (no schemas/procedures/functions/sequences/types) — `Table` is the
    /// only kind that ever returns rows; everything else is empty rather
    /// than an error, so the frontend never has to special-case Mongo kind
    /// by kind. Unlike Postgres, addressing a sibling database costs
    /// nothing: one `mongodb::Client` already talks to any database by name
    /// with no extra connection, so this needs no pooling of its own.
    pub(super) async fn list_schema_objects(
        &self,
        database: Option<&str>,
        _schema: &str,
        kind: super::SchemaObjectKind,
    ) -> DbResult<Vec<super::SchemaObject>> {
        if kind != super::SchemaObjectKind::Table {
            return Ok(vec![]);
        }
        let db = database.map(str::to_string).unwrap_or_else(|| self.cur_database());
        let names = self
            .client
            .database(&db)
            .list_collection_names()
            .await
            .map_err(|e| DbError::InvalidOperation(format!("mongo: {e}")))?;
        Ok(names
            .into_iter()
            .map(|name| super::SchemaObject { name, extra: None })
            .collect())
    }

    pub(super) async fn catalog_overview(&self) -> DbResult<super::CatalogOverview> {
        let databases = self.list_databases().await?;
        Ok(super::CatalogOverview {
            schemas: vec![],
            databases,
            active_schema: self.cur_database(),
        })
    }

    pub(super) async fn active_schema(&self) -> DbResult<String> {
        Ok(self.cur_database())
    }

    /// Switch which database on the server unqualified collection operations
    /// (grid browsing, the console, SQL) target. Mongo has no schemas —
    /// this reuses the `DbAdapter` schema-switch slot for Mongo's database
    /// switch, the same way the sidebar already treats "schema" as the
    /// per-engine catalog unit.
    pub(super) async fn set_active_schema(&self, schema: &str) -> DbResult<()> {
        let dbs = self.list_databases().await?;
        if !dbs.iter().any(|d| d == schema) {
            return Err(DbError::InvalidOperation(format!(
                "database \"{schema}\" does not exist on this server"
            )));
        }
        *self.database.write().unwrap() = schema.to_string();
        Ok(())
    }
}
