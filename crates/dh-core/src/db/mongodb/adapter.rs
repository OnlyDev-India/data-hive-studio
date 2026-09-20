use async_trait::async_trait;
use std::sync::Arc;
use crate::db::{BatchSink, DbAdapter, DbResult, OpOutcome, RunHandle};
use crate::api::{FieldShape, QueryOp, QueryResult, SchemaOp, TableInfo, TableSchema};
use super::MongoAdapter;

#[async_trait]
impl DbAdapter for MongoAdapter {
    async fn list_tables(&self) -> DbResult<Vec<TableInfo>> {
        MongoAdapter::list_tables(self).await
    }

    async fn table_schema(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        table: &str,
    ) -> DbResult<(TableSchema, Vec<String>)> {
        MongoAdapter::table_schema(self, database, _schema, table).await
    }

    async fn field_tree(&self, database: &str, collection: &str) -> DbResult<Vec<FieldShape>> {
        MongoAdapter::field_tree(self, database, collection).await
    }

    async fn list_schemas(&self) -> DbResult<Vec<String>> {
        MongoAdapter::list_schemas(self).await
    }

    async fn list_databases(&self) -> DbResult<Vec<String>> {
        MongoAdapter::list_databases(self).await
    }

    async fn list_schema_objects(
        &self,
        database: Option<&str>,
        _schema: &str,
        kind: super::SchemaObjectKind,
    ) -> DbResult<Vec<super::SchemaObject>> {
        MongoAdapter::list_schema_objects(self, database, _schema, kind).await
    }

    async fn list_documents(
        &self,
        collection: &str,
        filter: Option<serde_json::Value>,
        skip: u64,
        limit: u64,
    ) -> DbResult<(Vec<serde_json::Value>, u64)> {
        MongoAdapter::list_documents_impl(self, collection, filter, skip, limit).await
    }

    async fn list_documents_ext(
        &self,
        collection: &str,
        filter: Option<serde_json::Value>,
        skip: u64,
        limit: u64,
    ) -> DbResult<(Vec<String>, u64)> {
        MongoAdapter::list_documents_ext(self, collection, filter, skip, limit).await
    }

    async fn save_document(
        &self,
        collection: &str,
        id: &str,
        document_text: &str,
    ) -> DbResult<bool> {
        MongoAdapter::save_document(self, collection, id, document_text).await
    }

    async fn insert_document(&self, collection: &str, document_text: &str) -> DbResult<()> {
        MongoAdapter::insert_document(self, collection, document_text).await
    }

    async fn run_mongo(
        &self,
        db: &str,
        collection: Option<&str>,
        script: &str,
        run: Option<&RunHandle>,
    ) -> DbResult<crate::api::MongoRunResult> {
        MongoAdapter::run_mongo(self, db, collection, script, run).await
    }

    async fn catalog_overview(&self) -> DbResult<super::CatalogOverview> {
        MongoAdapter::catalog_overview(self).await
    }

    async fn active_schema(&self) -> DbResult<String> {
        MongoAdapter::active_schema(self).await
    }

    async fn set_active_schema(&self, schema: &str) -> DbResult<()> {
        MongoAdapter::set_active_schema(self, schema).await
    }

    async fn create_collection(&self, database: Option<&str>, name: &str) -> DbResult<()> {
        MongoAdapter::create_collection(self, database, name).await
    }

    async fn duplicate_table(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        source: &str,
        target: &str,
        copy_data: bool,
    ) -> DbResult<Vec<String>> {
        MongoAdapter::duplicate_table(self, database, _schema, source, target, copy_data).await
    }

    async fn run_sql(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        sql: &str,
    ) -> DbResult<QueryResult> {
        MongoAdapter::run_sql(self, database, _schema, sql).await
    }

    async fn execute_params(
        &self,
        _database: Option<&str>,
        _sql: &str,
        _params: &[Option<String>],
    ) -> DbResult<u64> {
        MongoAdapter::execute_params(self, _database, _sql, _params).await
    }

    async fn run_sql_params(
        &self,
        database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<QueryResult> {
        MongoAdapter::run_sql_params(self, database, sql, params).await
    }

    async fn execute_op(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        op: &QueryOp,
    ) -> DbResult<OpOutcome> {
        MongoAdapter::execute_op(self, database, _schema, op).await
    }

    async fn execute_op_stream(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        op: &QueryOp,
        on_batch: BatchSink<'_>,
    ) -> DbResult<OpOutcome> {
        MongoAdapter::execute_op_stream(self, database, schema, op, on_batch).await
    }

    async fn run_sql_stream(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        sql: &str,
        run: Option<&RunHandle>,
        on_batch: BatchSink<'_>,
    ) -> DbResult<QueryResult> {
        MongoAdapter::run_sql_stream(self, database, _schema, sql, run, on_batch).await
    }

    async fn apply_schema_ops_batch(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        ops: &[SchemaOp],
    ) -> DbResult<Vec<String>> {
        MongoAdapter::apply_schema_ops_batch(self, database, _schema, ops).await
    }

    async fn close(self: Arc<Self>) {
        MongoAdapter::close(self).await
    }
}
