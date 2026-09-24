use async_trait::async_trait;
use std::sync::Arc;
use crate::api::{ImportReport, ImportRequest, QueryOp, QueryResult, SchemaOp, TableInfo, TableSchema};
use crate::db::{
    BatchSink,
    DbAdapter,
    DbResult,
    RoleDetail,
    RunHandle,
    SchemaObject,
    SchemaObjectKind,
};
use super::PgAdapter;

#[async_trait]
impl DbAdapter for PgAdapter {
    async fn list_tables(&self) -> DbResult<Vec<TableInfo>> {
        PgAdapter::list_tables(self).await
    }

    async fn table_schema(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        table: &str,
    ) -> DbResult<(TableSchema, Vec<String>)> {
        PgAdapter::table_schema(self, database, schema, table).await
    }

    async fn list_schemas(&self) -> DbResult<Vec<String>> {
        PgAdapter::list_schemas(self).await
    }

    async fn import_rows(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        request: &ImportRequest,
    ) -> DbResult<ImportReport> {
        PgAdapter::import_rows(self, database, schema, request).await
    }

    async fn list_databases(&self) -> DbResult<Vec<String>> {
        PgAdapter::list_databases(self).await
    }

    async fn list_schemas_in(&self, database: Option<&str>) -> DbResult<Vec<String>> {
        PgAdapter::list_schemas_in(self, database).await
    }

    async fn list_roles(&self) -> DbResult<Vec<SchemaObject>> {
        PgAdapter::list_roles(self).await
    }

    async fn list_extensions(&self, database: Option<&str>) -> DbResult<Vec<SchemaObject>> {
        PgAdapter::list_extensions(self, database).await
    }

    async fn list_role_details(&self) -> DbResult<Vec<RoleDetail>> {
        PgAdapter::list_role_details(self).await
    }

    async fn disconnect_database(&self, database: &str) -> DbResult<()> {
        PgAdapter::disconnect_database(self, database).await
    }

    async fn list_schema_objects(
        &self,
        database: Option<&str>,
        schema: &str,
        kind: SchemaObjectKind,
    ) -> DbResult<Vec<SchemaObject>> {
        PgAdapter::list_schema_objects(self, database, schema, kind).await
    }

    async fn catalog_overview(&self) -> DbResult<super::CatalogOverview> {
        PgAdapter::catalog_overview(self).await
    }

    async fn set_active_schema(&self, schema: &str) -> DbResult<()> {
        PgAdapter::set_active_schema(self, schema).await
    }

    async fn active_schema(&self) -> DbResult<String> {
        PgAdapter::active_schema(self).await
    }

    async fn create_database(&self, name: &str) -> DbResult<()> {
        PgAdapter::create_database(self, name).await
    }

    async fn drop_database(&self, name: &str) -> DbResult<()> {
        PgAdapter::drop_database(self, name).await
    }

    async fn create_schema(&self, name: &str) -> DbResult<()> {
        PgAdapter::create_schema(self, name).await
    }

    async fn drop_schema(&self, name: &str, cascade: bool) -> DbResult<()> {
        PgAdapter::drop_schema(self, name, cascade).await
    }

    async fn run_sql(&self, database: Option<&str>, schema: Option<&str>, sql: &str) -> DbResult<QueryResult> {
        PgAdapter::run_sql(self, database, schema, sql).await
    }

    async fn execute_params(
        &self,
        database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<u64> {
        PgAdapter::execute_params(self, database, sql, params).await
    }

    async fn run_sql_params(
        &self,
        database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<QueryResult> {
        PgAdapter::run_sql_params(self, database, sql, params).await
    }

    async fn execute_op(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        op: &QueryOp,
    ) -> DbResult<super::OpOutcome> {
        PgAdapter::execute_op(self, database, schema, op).await
    }

    async fn execute_op_stream(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        op: &QueryOp,
        on_batch: BatchSink<'_>,
    ) -> DbResult<super::OpOutcome> {
        PgAdapter::execute_op_stream(self, database, schema, op, on_batch).await
    }

    async fn run_sql_stream(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        sql: &str,
        run: Option<&RunHandle>,
        on_batch: BatchSink<'_>,
    ) -> DbResult<QueryResult> {
        PgAdapter::run_sql_stream(self, database, schema, sql, run, on_batch).await
    }

    async fn apply_schema_ops_batch(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        ops: &[SchemaOp],
    ) -> DbResult<Vec<String>> {
        PgAdapter::apply_schema_ops_batch(self, database, schema, ops).await
    }

    async fn duplicate_table(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        source: &str,
        target: &str,
        _copy_data: bool,
    ) -> DbResult<Vec<String>> {
        PgAdapter::duplicate_table(self, database, schema, source, target, _copy_data).await
    }

    async fn refresh_matview(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        name: &str,
    ) -> DbResult<()> {
        PgAdapter::refresh_matview(self, database, schema, name).await
    }

    async fn close(self: Arc<Self>) {
        PgAdapter::close(self).await
    }
}
