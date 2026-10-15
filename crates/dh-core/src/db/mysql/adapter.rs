use async_trait::async_trait;
use std::sync::Arc;
use crate::api::{QueryOp, QueryResult, SchemaOp, TableInfo, TableSchema};
use crate::db::{
    BatchSink, CatalogOverview, DbAdapter, DbError, DbResult, OpOutcome, RunHandle, SchemaObject, SchemaObjectKind,
    ScriptSyntax,
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

    fn pool_size(&self) -> u32 {
        self.pool.options().get_max_connections()
    }

    async fn apply_schema_ops_batch(
        &self,
        _database: Option<&str>,
        _schema: Option<&str>,
        _ops: &[SchemaOp],
    ) -> DbResult<Vec<String>> {
        // The per table DDL apply loop is build plan slice 7 (AC-19).
        Err(DbError::InvalidOperation("the schema designer is not available on MySQL connections yet".into()))
    }

    fn script_syntax(&self) -> ScriptSyntax {
        // Never read yet: `compare_scan` refuses MySQL until build plan
        // slice 10 adds `ScriptSyntax::Mysql` (AC-24).
        ScriptSyntax::Sqlite
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
