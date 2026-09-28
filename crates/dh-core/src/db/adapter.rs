use crate::db::RunHandle;
use std::sync::Arc;
use async_trait::async_trait;
use crate::api::{
    FieldShape,
    MongoRunResult,
    PlanResult,
    ImportCapabilities,
    ImportReport,
    ImportRequest,
    QueryOp,
    QueryResult,
    SchemaOp,
    TableInfo,
    TableSchema,
};
use serde_json;
use super::types::{BatchSink, CatalogOverview, DbError, DbResult, OpOutcome, RoleDetail, SchemaObject, SchemaObjectKind};

/// One database family's driver: connection handling plus every operation
/// the UI can perform. SQLite ships as the built-in adapter; other engines
/// implement the same surface (see `postgres.rs`).
#[async_trait]
pub trait DbAdapter: Send + Sync {
    async fn list_tables(&self) -> DbResult<Vec<TableInfo>>;
    /// Column/FK/index/trigger metadata plus every introspection statement
    /// executed to gather it (for the activity log's full-SQL view).
    /// `database`/`schema`: `None` means this connection's own primary
    /// database / current active schema (every existing call site keeps
    /// behaving identically) — `Some` targets a specific database/schema
    /// directly instead of reading the adapter's ambient state, so a table
    /// pane pinned to a SIBLING database (or a different schema than
    /// whatever's currently active) never race-leaks against another pane's
    /// target. Postgres routes `Some(database)` through `PgAdapter::pool_for`
    /// (see its own doc comment) — the same secondary-pool mechanism the
    /// sidebar's catalog-browsing calls already use.
    async fn table_schema(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        table: &str,
    ) -> DbResult<(TableSchema, Vec<String>)>;
    /// `database`: `None` = this connection's own database. `schema`, when
    /// given (Postgres only — ignored elsewhere), resolves every
    /// UNQUALIFIED name in `sql` through that schema instead of the
    /// connection's own default — a transaction-local `search_path`, not a
    /// rewrite of the SQL text itself (see the Postgres impl).
    async fn run_sql(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        sql: &str,
    ) -> DbResult<QueryResult>;
    async fn execute_params(
        &self,
        database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<u64>;
    async fn run_sql_params(
        &self,
        database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<QueryResult>;
    /// See `table_schema`'s doc comment for `database`/`schema` semantics.
    async fn execute_op(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        op: &QueryOp,
    ) -> DbResult<OpOutcome>;
    async fn execute_op_stream(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        op: &QueryOp,
        on_batch: BatchSink<'_>,
    ) -> DbResult<OpOutcome>;
    /// `run`: the editor run this belongs to, so Stop can reach it. `None`
    /// means not cancellable. An adapter that supports Stop arms its own
    /// canceller on `run` and returns [`DbError::Cancelled`] when the engine
    /// stops the statement because the user asked; one that does not yet
    /// support it ignores `run` (the wrapper still frees the tab).
    async fn run_sql_stream(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        sql: &str,
        run: Option<&RunHandle>,
        on_batch: BatchSink<'_>,
    ) -> DbResult<QueryResult>;
    /// The plan of one SQL statement. Never runs it: `analyze`
    /// (real timings) is the only mode that does. A statement Explain does
    /// not accept and a database error come back inside the [`PlanResult`].
    /// `database`/`schema` as in `run_sql`.
    async fn explain_sql(
        &self,
        _database: Option<&str>,
        _schema: Option<&str>,
        _sql: &str,
        _analyze: bool,
        _run: Option<&RunHandle>,
    ) -> DbResult<PlanResult> {
        Err(DbError::InvalidOperation(
            "Explain is not supported by this adapter".into(),
        ))
    }
    /// The plan of one MongoDB console command. `db`/`collection` as in
    /// `run_mongo`.
    async fn explain_mongo(
        &self,
        _db: &str,
        _collection: Option<&str>,
        _script: &str,
        _analyze: bool,
        _run: Option<&RunHandle>,
    ) -> DbResult<PlanResult> {
        Err(DbError::InvalidOperation(
            "Explain is not supported by this adapter".into(),
        ))
    }
    /// See `table_schema`'s doc comment for `database`/`schema` semantics.
    async fn apply_schema_ops_batch(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        ops: &[SchemaOp],
    ) -> DbResult<Vec<String>>;
    /// Duplicate a table/collection under a new name; returns the statements
    /// that ran (activity log). `copy_data` is honored by MongoDB (the
    /// sidebar's right-click "Duplicate collection" offers a copy-data
    /// checkbox); SQL adapters don't respect it yet and always copy
    /// structure + indexes + data, pending the same UI for SQL tables. See
    /// `table_schema`'s doc comment for `database`/`schema` semantics.
    async fn duplicate_table(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        source: &str,
        target: &str,
        copy_data: bool,
    ) -> DbResult<Vec<String>> {
        let _ = (database, schema, source, target, copy_data);
        Err(DbError::InvalidOperation(
            "duplicate table is not supported by this adapter".into(),
        ))
    }
    /// Write an import (spec 0008) in ONE transaction and report every bad
    /// row. `database`/`schema` as in `table_schema`. Refused on a read only
    /// connection.
    async fn import_rows(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        request: &ImportRequest,
    ) -> DbResult<ImportReport> {
        let _ = (database, schema, request);
        Err(DbError::InvalidOperation(
            "import is not supported by this adapter".into(),
        ))
    }
    /// What an import into this connection can promise (spec 0008). SQL
    /// adapters always roll back cleanly; Mongo asks the server.
    async fn import_capabilities(&self, database: Option<&str>) -> DbResult<ImportCapabilities> {
        let _ = database;
        Ok(ImportCapabilities { atomic: true })
    }
    /// Refresh a materialized view (Postgres). See `table_schema`'s doc
    /// comment for `database`/`schema` semantics.
    async fn refresh_matview(
        &self,
        _database: Option<&str>,
        _schema: Option<&str>,
        _name: &str,
    ) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "refreshing materialized views is not supported by this adapter".into(),
        ))
    }
    /// Schemas the user can switch between (Postgres namespaces). Engines
    /// without schema support report their single implicit one.
    async fn list_schemas(&self) -> DbResult<Vec<String>> {
        Err(DbError::InvalidOperation(
            "schema browsing is not supported by this adapter".into(),
        ))
    }
    /// Databases reachable with the same server credentials (Postgres
    /// `pg_database`). Engines without a server report just themselves.
    async fn list_databases(&self) -> DbResult<Vec<String>> {
        Err(DbError::InvalidOperation(
            "database listing is not supported by this adapter".into(),
        ))
    }
    /// Objects of one `kind` in `schema` — the sidebar catalog tree's
    /// Tables/Views/Materialized Views/Procedures/Functions/Sequences/Types
    /// rows. `database`, when `Some`, targets a SIBLING database on the same
    /// server rather than this connection's own one: Postgres opens (or
    /// reuses) a secondary connection pool for it (see `PgAdapter::pool_for`)
    /// since a single Postgres connection can't otherwise reach another
    /// database at all; MongoDB just addresses `database` directly (one
    /// `mongodb::Client` can already talk to any database with no extra
    /// connection), and only ever returns rows for `Table` (its collections)
    /// — every other kind is empty rather than an error, so the sidebar can
    /// render Mongo's simpler tree shape without special-casing kind by kind.
    async fn list_schema_objects(
        &self,
        _database: Option<&str>,
        _schema: &str,
        _kind: SchemaObjectKind,
    ) -> DbResult<Vec<SchemaObject>> {
        Err(DbError::InvalidOperation(
            "schema object listing is not supported by this adapter".into(),
        ))
    }
    /// Schemas within `database` (`None` = this connection's own database) —
    /// like `list_schemas` but for a specific, possibly non-active database,
    /// so the sidebar tree can expand a sibling database's schema list.
    async fn list_schemas_in(&self, _database: Option<&str>) -> DbResult<Vec<String>> {
        Err(DbError::InvalidOperation(
            "schema browsing is not supported by this adapter".into(),
        ))
    }
    /// Server-wide roles (Postgres `pg_roles`) — cluster-level, so unlike
    /// everything above this takes no database/schema argument: the same
    /// roles are visible identically from every database on the server.
    async fn list_roles(&self) -> DbResult<Vec<SchemaObject>> {
        Err(DbError::InvalidOperation(
            "role listing is not supported by this adapter".into(),
        ))
    }
    /// Full attribute set for every role — the Users & Privileges tab. Same
    /// cluster-wide scope as `list_roles`.
    async fn list_role_details(&self) -> DbResult<Vec<RoleDetail>> {
        Err(DbError::InvalidOperation(
            "role detail listing is not supported by this adapter".into(),
        ))
    }
    /// Installed extensions (Postgres `pg_extension`) — unlike `list_roles`,
    /// this IS scoped by database (`None` = this connection's own), since
    /// each database in a Postgres server has its own independently
    /// installed set. The sidebar renders this once per database node, not
    /// once per schema — extensions aren't schema-owned at all.
    async fn list_extensions(&self, _database: Option<&str>) -> DbResult<Vec<SchemaObject>> {
        Err(DbError::InvalidOperation(
            "extension listing is not supported by this adapter".into(),
        ))
    }
    /// Close ONE sibling database's own connection right now (Postgres: the
    /// secondary pool `pool_for` opened for it), instead of waiting for its
    /// normal idle eviction — the sidebar's per-database "Disconnect" for
    /// anything other than this connection's own primary database. Engines
    /// without a separate per-database connection (MongoDB: one client
    /// already reaches every database, nothing extra to close) don't need
    /// this — the frontend just closes that database's tabs itself.
    async fn disconnect_database(&self, _database: &str) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "closing an individual database's connection is not supported by this adapter".into(),
        ))
    }
    /// Fetch a page of documents from a collection (MongoDB).
    async fn list_documents(
        &self,
        _collection: &str,
        _filter: Option<serde_json::Value>,
        _skip: u64,
        _limit: u64,
    ) -> DbResult<(Vec<serde_json::Value>, u64)> {
        Err(DbError::InvalidOperation(
            "document listing is not supported by this adapter".into(),
        ))
    }
    /// Fetch a page of documents rendered as type-aware MQL extended JSON
    /// text (used by the JSON editor). MongoDB only.
    async fn list_documents_ext(
        &self,
        _collection: &str,
        _filter: Option<serde_json::Value>,
        _skip: u64,
        _limit: u64,
    ) -> DbResult<(Vec<String>, u64)> {
        Err(DbError::InvalidOperation(
            "extended document listing is not supported by this adapter".into(),
        ))
    }
    /// Replace the document matching `id` (an ObjectId hex string) with the
    /// document parsed from `document_text` (MQL extended JSON). MongoDB only.
    async fn save_document(
        &self,
        _collection: &str,
        _id: &str,
        _document_text: &str,
    ) -> DbResult<bool> {
        Err(DbError::InvalidOperation(
            "document editing is not supported by this adapter".into(),
        ))
    }
    /// Insert a new document parsed from `document_text` (MQL extended JSON).
    /// MongoDB only.
    async fn insert_document(
        &self,
        _collection: &str,
        _document_text: &str,
    ) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "document insertion is not supported by this adapter".into(),
        ))
    }
    /// Run a MongoDB console command (a JSON find/aggregate or a shell-subset
    /// statement) against database `db`, with an optional current `collection`
    /// for bare JSON queries. Non-Mongo adapters reject it.
    /// `run`: the console run this belongs to, so Stop can reach it (see
    /// `run_sql_stream`'s doc comment).
    async fn run_mongo(
        &self,
        _db: &str,
        _collection: Option<&str>,
        _script: &str,
        _run: Option<&RunHandle>,
    ) -> DbResult<MongoRunResult> {
        Err(DbError::InvalidOperation(
            "Mongo console commands are only available on MongoDB connections".into(),
        ))
    }
    /// [`run_mongo`], with find, aggregate and bare JSON reads pushing their
    /// rows and documents through `on_batch` as they arrive. Other commands
    /// return inline. Non-Mongo adapters reject it.
    async fn run_mongo_stream(
        &self,
        _db: &str,
        _collection: Option<&str>,
        _script: &str,
        _run: Option<&RunHandle>,
        _on_batch: BatchSink<'_>,
    ) -> DbResult<MongoRunResult> {
        Err(DbError::InvalidOperation(
            "Mongo console commands are only available on MongoDB connections".into(),
        ))
    }
    /// Recursively inferred nested field shape for a MongoDB collection (spec
    /// 0001's "Fields" view) — sampled the same way as `inferred_schema`
    /// (up to 200 documents) but built as a per-path tree instead of a flat
    /// list, decoupled from `table_schema`/`ColumnInfo` so the data grid's
    /// column headers are never affected. Non-Mongo adapters reject it.
    async fn field_tree(
        &self,
        _database: &str,
        _collection: &str,
    ) -> DbResult<Vec<FieldShape>> {
        Err(DbError::InvalidOperation(
            "the nested field view is only available on MongoDB connections".into(),
        ))
    }
    /// Schemas + databases + active schema in ONE round trip — the sidebar
    /// opens with a single catalog wait instead of three back-to-back ones
    /// (which on remote servers queued every later query behind them).
    async fn catalog_overview(&self) -> DbResult<CatalogOverview> {
        Err(DbError::InvalidOperation(
            "catalog overview is not supported by this adapter".into(),
        ))
    }
    /// Point every unqualified operation at `schema`.
    async fn set_active_schema(&self, _schema: &str) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "switching schemas is not supported by this adapter".into(),
        ))
    }
    async fn active_schema(&self) -> DbResult<String> {
        Err(DbError::InvalidOperation(
            "active schema is not supported by this adapter".into(),
        ))
    }
    /// Create a new database on the same server (Postgres). Engines without
    /// server-side catalogs don't support it.
    async fn create_database(&self, _name: &str) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "creating databases is not supported by this adapter".into(),
        ))
    }
    /// Drop a database on the same server. Dropping the database this
    /// connection is attached to is rejected by the server itself.
    async fn drop_database(&self, _name: &str) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "dropping databases is not supported by this adapter".into(),
        ))
    }
    /// Create a schema in the active catalog.
    async fn create_schema(&self, _name: &str) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "creating schemas is not supported by this adapter".into(),
        ))
    }
    /// Create a new collection (MongoDB). An explicit create is optional in
    /// Mongo (a collection also springs into existence on its first insert)
    /// but this gives "New table" a real, immediate equivalent for Mongo
    /// connections instead of SQL DDL. `database` (`None` = this
    /// connection's own primary database) targets a sibling database's
    /// catalog tree row, same as `duplicate_table`'s own `database` param.
    async fn create_collection(&self, _database: Option<&str>, _name: &str) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "creating collections is not supported by this adapter".into(),
        ))
    }
    /// Drop a schema; `cascade` also drops every object inside it.
    async fn drop_schema(&self, _name: &str, _cascade: bool) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "dropping schemas is not supported by this adapter".into(),
        ))
    }
    /// Storage-only concepts for file-backed adapters (WAL merge, byte export).
    /// Network adapters never override these.
    async fn checkpoint(&self) -> DbResult<()> {
        Err(DbError::InvalidOperation(
            "checkpoint is not supported by this adapter".into(),
        ))
    }
    async fn save_bytes(&self) -> DbResult<Vec<u8>> {
        Err(DbError::InvalidOperation(
            "saving to bytes is not supported by this adapter".into(),
        ))
    }
    /// Release pools/handles and perform adapter-specific cleanup.
    async fn close(self: Arc<Self>);
}
