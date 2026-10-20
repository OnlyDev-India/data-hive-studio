use async_trait::async_trait;
use std::sync::Arc;
use crate::api::{
    ImportReport, ImportRequest, PlanResult, QueryOp, QueryResult, SchemaApplyReport, SchemaGraph, SchemaOp, TableInfo, TableSchema,
};
use crate::db::{
    BatchSink, CatalogOverview, DbAdapter, DbResult, OpOutcome, RoleDetail, RunHandle, ScanOut, ScanSpec,
    SchemaObject, SchemaObjectKind, ScriptSyntax,
};
use super::MySqlAdapter;

/// One line calls into the topic files. `schema` arguments are ignored:
/// MySQL has no schema level.
#[async_trait]
impl DbAdapter for MySqlAdapter {
    async fn list_tables(&self) -> DbResult<Vec<TableInfo>> {
        MySqlAdapter::list_tables(self).await
    }

    async fn table_schema(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        table: &str,
    ) -> DbResult<(TableSchema, Vec<String>)> {
        MySqlAdapter::table_schema(self, database, table).await
    }

    async fn schema_graph(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
    ) -> DbResult<(SchemaGraph, Vec<String>)> {
        MySqlAdapter::schema_graph(self, database).await
    }

    async fn run_sql(&self, database: Option<&str>, _schema: Option<&str>, sql: &str) -> DbResult<QueryResult> {
        MySqlAdapter::run_sql(self, database, sql).await
    }

    async fn execute_params(&self, database: Option<&str>, sql: &str, params: &[Option<String>]) -> DbResult<u64> {
        MySqlAdapter::execute_params(self, database, sql, params).await
    }

    async fn run_sql_params(
        &self,
        database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<QueryResult> {
        MySqlAdapter::run_sql_params(self, database, sql, params).await
    }

    async fn execute_op(&self, database: Option<&str>, _schema: Option<&str>, op: &QueryOp) -> DbResult<OpOutcome> {
        MySqlAdapter::execute_op(self, database, op).await
    }

    async fn execute_op_stream(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        op: &QueryOp,
        on_batch: BatchSink<'_>,
    ) -> DbResult<OpOutcome> {
        MySqlAdapter::execute_op_stream(self, database, op, on_batch).await
    }

    async fn run_sql_stream(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        sql: &str,
        run: Option<&RunHandle>,
        on_batch: BatchSink<'_>,
    ) -> DbResult<QueryResult> {
        MySqlAdapter::run_sql_stream(self, database, sql, run, on_batch).await
    }

    async fn run_read_only(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        sql: &str,
        time_ms: Option<u64>,
        run: Option<&RunHandle>,
        on_batch: BatchSink<'_>,
    ) -> DbResult<QueryResult> {
        MySqlAdapter::run_read_only(self, database, sql, time_ms, run, on_batch).await
    }

    async fn explain_sql(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        sql: &str,
        analyze: bool,
        run: Option<&RunHandle>,
    ) -> DbResult<PlanResult> {
        Ok(MySqlAdapter::explain_sql(self, database, sql, analyze, run).await)
    }

    fn pool_size(&self) -> u32 {
        self.pool.options().get_max_connections()
    }

    async fn apply_schema_ops_batch(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        ops: &[SchemaOp],
    ) -> DbResult<Vec<String>> {
        MySqlAdapter::apply_schema_ops_batch(self, database, ops).await
    }

    async fn apply_schema_ops_report(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        ops: &[SchemaOp],
    ) -> DbResult<SchemaApplyReport> {
        MySqlAdapter::apply_schema_ops_report(self, database, ops).await
    }

    async fn plan_schema_ops(&self, database: Option<&str>, _schema: Option<&str>, ops: &[SchemaOp]) -> DbResult<Vec<String>> {
        MySqlAdapter::plan_schema_ops(self, database, ops).await
    }

    fn script_syntax(&self) -> ScriptSyntax {
        ScriptSyntax::Mysql
    }

    async fn compare_scan(&self, spec: &ScanSpec<'_>, run: &RunHandle, out: &ScanOut) -> DbResult<()> {
        MySqlAdapter::compare_scan(self, spec, run, out).await
    }

    async fn import_rows(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        request: &ImportRequest,
    ) -> DbResult<ImportReport> {
        MySqlAdapter::import_rows(self, database, request).await
    }

    async fn list_schemas(&self) -> DbResult<Vec<String>> {
        Ok(Vec::new())
    }

    async fn list_schemas_in(&self, _database: Option<&str>) -> DbResult<Vec<String>> {
        Ok(Vec::new())
    }

    async fn list_databases(&self) -> DbResult<Vec<String>> {
        MySqlAdapter::list_databases(self).await
    }

    async fn list_schema_objects(
        &self,
        database: Option<&str>,
        _schema: &str,
        kind: SchemaObjectKind,
    ) -> DbResult<Vec<SchemaObject>> {
        MySqlAdapter::list_schema_objects(self, database, kind).await
    }

    async fn object_definition(
        &self,
        database: Option<&str>,
        kind: SchemaObjectKind,
        name: &str,
    ) -> DbResult<String> {
        MySqlAdapter::object_definition(self, database, kind, name).await
    }

    async fn list_roles(&self) -> DbResult<Vec<SchemaObject>> {
        MySqlAdapter::list_roles(self).await
    }

    async fn list_role_details(&self) -> DbResult<Vec<RoleDetail>> {
        MySqlAdapter::list_role_details(self).await
    }

    async fn create_database(&self, name: &str) -> DbResult<()> {
        MySqlAdapter::create_database_with(self, name, None, None).await
    }

    async fn create_database_with(&self, name: &str, charset: Option<&str>, collation: Option<&str>) -> DbResult<()> {
        MySqlAdapter::create_database_with(self, name, charset, collation).await
    }

    async fn drop_database(&self, name: &str) -> DbResult<()> {
        MySqlAdapter::drop_database(self, name).await
    }

    async fn duplicate_table(
        &self,
        database: Option<&str>,
        _schema: Option<&str>,
        source: &str,
        target: &str,
        copy_data: bool,
    ) -> DbResult<Vec<String>> {
        MySqlAdapter::duplicate_table(self, database, source, target, copy_data).await
    }

    async fn catalog_overview(&self) -> DbResult<CatalogOverview> {
        MySqlAdapter::catalog_overview(self).await
    }

    async fn active_schema(&self) -> DbResult<String> {
        Ok(self.database.clone().unwrap_or_default())
    }

    /// One pool reaches every database, so there is nothing per database
    /// to close: the frontend just closes that database's tabs.
    async fn disconnect_database(&self, _database: &str) -> DbResult<()> {
        Ok(())
    }

    async fn close(self: Arc<Self>) {
        MySqlAdapter::close(self).await
    }
}
