use crate::api::{ImportReport, ImportRequest, QueryOp, QueryResult, SchemaOp, TableInfo, TableSchema};
use std::sync::Arc;
use crate::db::read_only::Dialect;
use crate::db::{BatchSink, DbAdapter, DbResult, RunHandle};
use async_trait::async_trait;
use super::SqliteAdapter;

// ---- Adapter-trait plumbing -------------------------------------------------
// The inherent methods above stay the single source of truth; the trait
// simply exposes them polymorphically so the registry can hold any engine.
#[async_trait]
impl DbAdapter for SqliteAdapter {
    async fn list_tables(&self) -> DbResult<Vec<TableInfo>> {
        SqliteAdapter::list_tables(self).await
    }
    // SQLite has exactly one implicit schema and one database per connection.
    async fn import_rows(
        &self,
        _database: Option<&str>,
        _schema: Option<&str>,
        request: &ImportRequest,
    ) -> DbResult<ImportReport> {
        SqliteAdapter::import_rows(self, request).await
    }
    async fn list_schemas(&self) -> DbResult<Vec<String>> {
        Ok(vec!["main".to_string()])
    }
    async fn list_databases(&self) -> DbResult<Vec<String>> {
        let name = self
            .path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("main")
            .to_string();
        Ok(vec![name])
    }
    async fn set_active_schema(&self, _schema: &str) -> DbResult<()> {
        Ok(())
    }
    async fn active_schema(&self) -> DbResult<String> {
        Ok("main".to_string())
    }
    // `database`/`schema` are ignored throughout — a SQLite connection IS a
    // single file with a single implicit schema, so there is no sibling
    // target these could ever address (unlike Postgres, where they route to
    // `PgAdapter::pool_for`/an explicit schema).
    async fn table_schema(
        &self,
        _database: Option<&str>,
        _schema: Option<&str>,
        table: &str,
    ) -> DbResult<(TableSchema, Vec<String>)> {
        SqliteAdapter::table_schema(self, table).await
    }
    async fn run_sql(
        &self,
        _database: Option<&str>,
        _schema: Option<&str>,
        sql: &str,
    ) -> DbResult<QueryResult> {
        self.guard.check_sql(Dialect::Sqlite, sql)?;
        SqliteAdapter::run_sql(self, sql, None)
            .await
            .map_err(|e| self.guard.refine(e))
    }
    async fn execute_params(
        &self,
        _database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<u64> {
        // Grid built statements only, so the same statement check as the editor
        // names the keyword it refused (UPDATE, INSERT, DELETE).
        self.guard.check_sql(Dialect::Sqlite, sql)?;
        SqliteAdapter::execute_params(self, sql, params).await
    }
    async fn run_sql_params(
        &self,
        _database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<QueryResult> {
        self.guard.check_sql(Dialect::Sqlite, sql)?;
        SqliteAdapter::run_sql_params(self, sql, params).await
    }
    async fn execute_op(
        &self,
        _database: Option<&str>,
        _schema: Option<&str>,
        op: &QueryOp,
    ) -> DbResult<super::OpOutcome> {
        self.guard.check_op(op)?;
        SqliteAdapter::execute_op(self, op).await
    }
    async fn execute_op_stream(
        &self,
        _database: Option<&str>,
        _schema: Option<&str>,
        op: &QueryOp,
        mut on_batch: BatchSink<'_>,
    ) -> DbResult<super::OpOutcome> {
        self.guard.check_op(op)?;
        SqliteAdapter::execute_op_stream(self, op, &mut on_batch).await
    }
    async fn run_sql_stream(
        &self,
        _database: Option<&str>,
        _schema: Option<&str>,
        sql: &str,
        run: Option<&RunHandle>,
        mut on_batch: BatchSink<'_>,
    ) -> DbResult<QueryResult> {
        // Before a canceller is armed, so a refused statement never becomes
        // a run Stop could reach.
        self.guard.check_sql(Dialect::Sqlite, sql)?;
        SqliteAdapter::run_sql_stream(self, sql, run, &mut on_batch)
            .await
            .map_err(|e| self.guard.refine(e))
    }
    async fn apply_schema_ops_batch(
        &self,
        _database: Option<&str>,
        _schema: Option<&str>,
        ops: &[SchemaOp],
    ) -> DbResult<Vec<String>> {
        if !ops.is_empty() {
            self.guard.check_write("schema changes")?;
        }
        SqliteAdapter::apply_schema_ops_batch(self, ops).await
    }
    async fn duplicate_table(
        &self,
        _database: Option<&str>,
        _schema: Option<&str>,
        source: &str,
        target: &str,
        copy_data: bool,
    ) -> DbResult<Vec<String>> {
        self.guard.check_write("duplicate table")?;
        SqliteAdapter::duplicate_table(self, source, target, copy_data).await
    }
    async fn checkpoint(&self) -> DbResult<()> {
        SqliteAdapter::checkpoint(self).await
    }
    async fn save_bytes(&self) -> DbResult<Vec<u8>> {
        SqliteAdapter::save_bytes(self).await
    }
    /// Merge WAL, close pools, and clean up temp/WAL files (moved here from
    /// the old central close_connection so every adapter owns its teardown).
    async fn close(self: Arc<Self>) {
        let _ = self.checkpoint().await;
        self.close_pool().await;
        if !self.has_real_path() {
            self.remove_files();
        } else if !self.guard.is_on() {
            // A read only connection could not merge the WAL, and the file may
            // be in use by another program: leave its WAL and shared memory
            // files alone.
            self.remove_aux_files();
        }
    }
}
