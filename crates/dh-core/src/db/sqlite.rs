//! SQLite backend for the database layer.
//!
//! The database lives in a temp file. On [`SqliteAdapter::open`] the incoming
//! bytes are written to that file; [`SqliteAdapter::save_bytes`] checkpoints
//! the WAL and reads the file back so the original DB can be downloaded
//! byte-for-byte.

use std::path::PathBuf;
use std::time::Instant;

use futures_util::TryStreamExt;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool};
use sqlx::{Column, Connection, Executor, Row, Statement, Value, ValueRef};

use crate::api::{
    ColumnInfo, DefaultMode, FilterOp, ForeignKeyInfo, GridFilterCond, IndexInfo, QueryChunk,
    QueryOp, QueryResult, SchemaOp, TableInfo, TableSchema, TriggerInfo,
};

use std::sync::Arc;

use super::{BatchSink, BuiltQuery, DbAdapter, DbError, DbResult};
use async_trait::async_trait;

/// Rows per streamed IPC chunk. Big enough to amortize channel overhead,
/// small enough that the first paint lands almost immediately.
const STREAM_BATCH_ROWS: usize = 256;

pub struct SqliteAdapter {
    pool: SqlitePool,
    path: PathBuf,
}

impl SqliteAdapter {
    /// Open (or create) a database backed by a temp file. `bytes` seeds the
    /// file if provided (existing db), otherwise a fresh empty db is created.
    pub async fn open(name: &str, bytes: Option<&[u8]>) -> DbResult<Self> {
        let path = temp_path(name)?;
        if let Some(b) = bytes {
            std::fs::write(&path, b)?;
        }
        Self::connect(path).await
    }

    /// Open a database directly at `real_path` (the file the user picked).
    /// The connection works against the original file, so every change is
    /// persisted in place — no separate save step is required.
    pub async fn open_at(real_path: &std::path::Path) -> DbResult<Self> {
        Self::connect(real_path.to_path_buf()).await
    }

    async fn connect(path: PathBuf) -> DbResult<Self> {
        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .foreign_keys(true);
        let pool = SqlitePool::connect_with(options).await.map_err(DbError::SqlEngine)?;
        Ok(Self { pool, path })
    }

    /// Whether this connection is backed by a real user file (vs a temp copy
    /// that should be cleaned up on close).
    pub fn has_real_path(&self) -> bool {
        let dir = std::env::temp_dir().join("dh-studio");
        !self.path.starts_with(&dir)
    }

    /// The underlying database file. Also used to clean up temp files.
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    pub fn display_name(&self) -> &str {
        "SQLite"
    }

    pub async fn list_tables(&self) -> DbResult<Vec<TableInfo>> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT name, type FROM sqlite_master \
             WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' \
             ORDER BY name",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows
            .into_iter()
            .map(|(name, kind)| TableInfo { name, kind })
            .collect())
    }

    pub async fn table_schema(&self, table: &str) -> DbResult<(TableSchema, Vec<String>)> {
        // Introspection statements ride back WITH the schema — per-call
        // ownership, so concurrent describes never interleave captures.
        let mut statements: Vec<String> = Vec::new();
        let mut columns = Vec::new();
        {
            let sql = format!("PRAGMA table_info('{}')", escape_str(table));
            statements.push(format!("{};", sql));
            let rows: Vec<(i64, String, String, i64, Option<String>, i64)> =
                sqlx::query_as(&sql).fetch_all(&self.pool).await.map_err(DbError::SqlEngine)?;
            for (_cid, name, data_type, not_null, default, pk) in rows {
                columns.push(ColumnInfo {
                    name,
                    data_type,
                    not_null: not_null != 0,
                    primary_key: pk > 0,
                    default,
                    enum_values: Vec::new(),
                    is_array: false,
                });
            }
        }

        let mut foreign_keys = Vec::new();
        {
            let sql = format!("PRAGMA foreign_key_list('{}')", escape_str(table));
            statements.push(format!("{};", sql));
            let rows: Vec<(i64, i64, String, String, String)> =
                sqlx::query_as(&sql).fetch_all(&self.pool).await.map_err(DbError::SqlEngine)?;
            for (_id, _seq, referenced_table, column, referenced_column) in rows {
                foreign_keys.push(ForeignKeyInfo {
                    column,
                    referenced_table,
                    referenced_column,
                    name: None,
                    on_delete: None,
                    on_update: None,
                });
            }
        }

        let mut indexes = Vec::new();
        {
            let sql = format!("PRAGMA index_list('{}')", escape_str(table));
            statements.push(format!("{};", sql));
            let rows: Vec<(i64, String, i64, String, i64)> =
                sqlx::query_as(&sql).fetch_all(&self.pool).await.map_err(DbError::SqlEngine)?;
            for (_seq, name, unique, origin, partial) in rows {
                if partial != 0 {
                    continue;
                }
                let isql = format!("PRAGMA index_info('{}')", escape_str(&name));
                statements.push(format!("{};", isql));
                let cols: Vec<(i64, i64, String)> =
                    sqlx::query_as(&isql).fetch_all(&self.pool).await.map_err(DbError::SqlEngine)?;
                indexes.push(IndexInfo {
                    name,
                    unique: unique != 0,
                    columns: cols.into_iter().map(|(_, _, c)| c).collect(),
                    origin: origin.to_string(),
                });
            }
        }

        let mut triggers = Vec::new();
        {
            let sql = format!(
                "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = '{}' ORDER BY name",
                escape_str(table)
            );
            statements.push(format!("{};", sql));
            let rows: Vec<(String, Option<String>)> =
                sqlx::query_as(&sql).fetch_all(&self.pool).await.map_err(DbError::SqlEngine)?;
            for (name, body) in rows {
                let sql_text = body.unwrap_or_default();
                if sql_text.trim().is_empty() {
                    continue;
                }
                let (timing, event) = Self::parse_trigger_meta(&sql_text);
                triggers.push(TriggerInfo { name, timing, event, sql: sql_text });
            }
        }

        Ok((
            TableSchema { kind: "table".into(), columns, foreign_keys, indexes, triggers },
            statements,
        ))
    }

    /// Extract the firing timing (BEFORE / AFTER / INSTEAD OF) and event
    /// (INSERT / UPDATE / DELETE) from a CREATE TRIGGER statement by scanning
    /// its keywords. Best-effort — used for display badges only.
    fn parse_trigger_meta(sql: &str) -> (String, String) {
        let lower = sql.to_lowercase();
        let mut timing = String::new();
        let mut words = lower.split_whitespace().peekable();
        while let Some(w) = words.next() {
            match w {
                "before" | "after" => timing = w.to_uppercase(),
                "instead" if words.peek() == Some(&"of") => {
                    timing = "INSTEAD OF".into();
                }
                "insert" | "update" | "delete" => return (timing, w.to_uppercase()),
                _ => {}
            }
        }
        (timing, String::new())
    }

    pub async fn run_sql(&self, sql: &str) -> DbResult<QueryResult> {
        let start = Instant::now();
        let trimmed = sql.trim();

        // Decide whether this looks like a query. Any statement whose first
        // keyword is not a SELECT/PRAGMA/EXPLAIN is executed via execute().
        let first_word = trimmed
            .split(|c: char| c == ' ' || c == '\n' || c == '\t')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        let is_query = matches!(first_word.as_str(), "select" | "pragma" | "explain" | "with");

        let result = if is_query {
            let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
            let prepared = conn.prepare(trimmed).await.map_err(DbError::SqlEngine)?;
            let columns: Vec<String> =
                prepared.columns().iter().map(|c| c.name().to_string()).collect();
            drop(prepared);
            drop(conn);

            let fetched = sqlx::query(trimmed).fetch_all(&self.pool).await.map_err(DbError::SqlEngine)?;
            let mut rows = Vec::with_capacity(fetched.len());
            for row in fetched {
                let mut cells = Vec::with_capacity(columns.len());
                for i in 0..columns.len() {
                    cells.push(cell_to_string(row.try_get_raw(i).map_err(DbError::SqlEngine)?));
                }
                rows.push(cells);
            }
            QueryResult {
                columns,
                rows,
                rows_affected: 0,
                is_select: true,
                error: None,
                elapsed_ms: start.elapsed().as_millis(),
            }
        } else {
            let res = sqlx::query(trimmed).execute(&self.pool).await.map_err(DbError::SqlEngine)?;
            QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                rows_affected: res.rows_affected(),
                is_select: false,
                error: None,
                elapsed_ms: start.elapsed().as_millis(),
            }
        };
        Ok(result)
    }

    /// Execute a DML/DDL statement with positional `?` parameters. Used for
    /// safe row edits — values are always bound, never interpolated.
    pub async fn execute_params(&self, sql: &str, params: &[Option<String>]) -> DbResult<u64> {
        let mut q = sqlx::query(sql);
        for p in params {
            q = q.bind(p);
        }
        let res = q.execute(&self.pool).await.map_err(DbError::SqlEngine)?;
        Ok(res.rows_affected())
    }

    /// Run a SELECT built from UI filters, binding `?` placeholders so user
    /// input is never interpolated into the SQL string.
    pub async fn run_sql_params(&self, sql: &str, params: &[Option<String>]) -> DbResult<QueryResult> {
        let start = Instant::now();
        let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
        let prepared = conn.prepare(sql).await.map_err(DbError::SqlEngine)?;
        let columns: Vec<String> =
            prepared.columns().iter().map(|c| c.name().to_string()).collect();
        drop(prepared);
        drop(conn);

        let mut q = sqlx::query(sql);
        for p in params {
            q = q.bind(p);
        }
        let fetched = q.fetch_all(&self.pool).await.map_err(DbError::SqlEngine)?;
        let mut rows = Vec::with_capacity(fetched.len());
        for row in fetched {
            let mut cells = Vec::with_capacity(columns.len());
            for i in 0..columns.len() {
                cells.push(cell_to_string(row.try_get_raw(i).map_err(DbError::SqlEngine)?));
            }
            rows.push(cells);
        }
        Ok(QueryResult {
            columns,
            rows,
            rows_affected: 0,
            is_select: true,
            error: None,
            elapsed_ms: start.elapsed().as_millis(),
        })
    }

    /// Stream a SELECT row-by-row through `on_batch` in fixed-size batches so
    /// the UI can render early while the rest of the result is still
    /// transferring. Columns are discovered by preparing the statement first,
    /// so they are known even when the result turns out to be empty. Returns
    /// the column names and the total number of rows streamed.
    pub async fn run_select_stream(
        &self,
        sql: &str,
        params: &[Option<String>],
        mut on_batch: impl FnMut(QueryChunk) -> DbResult<()>,
    ) -> DbResult<(Vec<String>, usize)> {
        // Prepare once up front to learn the column names (same trick as
        // run_sql_params), then stream with a freshly bound query.
        let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
        let prepared = conn.prepare(sql).await.map_err(DbError::SqlEngine)?;
        let columns: Vec<String> =
            prepared.columns().iter().map(|c| c.name().to_string()).collect();
        drop(prepared);
        drop(conn);

        on_batch(QueryChunk { columns: Some(columns.clone()), rows: Vec::new() })?;

        let mut q = sqlx::query(sql);
        for p in params {
            q = q.bind(p);
        }
        let mut stream = q.fetch(&self.pool);
        let mut batch: Vec<Vec<Option<String>>> = Vec::with_capacity(STREAM_BATCH_ROWS);
        let mut total = 0usize;
        while let Some(row) = stream.try_next().await.map_err(DbError::SqlEngine)? {
            let mut cells = Vec::with_capacity(columns.len());
            for i in 0..columns.len() {
                cells.push(cell_to_string(row.try_get_raw(i).map_err(DbError::SqlEngine)?));
            }
            batch.push(cells);
            total += 1;
            if batch.len() >= STREAM_BATCH_ROWS {
                on_batch(QueryChunk { columns: None, rows: std::mem::take(&mut batch) })?;
            }
        }
        if !batch.is_empty() {
            on_batch(QueryChunk { columns: None, rows: batch })?;
        }
        Ok((columns, total))
    }

    /// Streaming variant of [`Self::execute_op`] for reads: row batches are
    /// pushed through `on_batch` as they come back from SQLite, and the
    /// resolved [`QueryResult`] carries every field EXCEPT rows (the caller
    /// assembles those from the chunks). Writes ignore the channel and
    /// behave exactly like [`Self::execute_op`].
    pub async fn execute_op_stream(
        &self,
        op: &QueryOp,
        on_batch: BatchSink<'_>,
    ) -> DbResult<super::OpOutcome> {
        let start = Instant::now();
        let q = self.build_query(op)?;
        match op {
            QueryOp::Select { .. } | QueryOp::Count { .. } | QueryOp::SelectDistinct { .. } => {
                let (columns, _total) =
                    self.run_select_stream(&q.sql, &q.params, on_batch).await?;
                Ok(super::OpOutcome {
                    result: QueryResult {
                        columns,
                        rows: Vec::new(),
                        rows_affected: 0,
                        is_select: true,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                    },
                    sql: Some(super::inline_placeholders(&q.sql, &q.params, false) + ";"),
                })
            }
            _ => self.execute_op(op).await,
        }
    }

    /// Streaming variant of [`Self::run_sql`]: SELECT-shaped statements push
    /// row batches through `on_batch` and resolve without rows; other
    /// statements run normally and never touch the channel.
    pub async fn run_sql_stream(
        &self,
        sql: &str,
        on_batch: BatchSink<'_>,
    ) -> DbResult<QueryResult> {
        let trimmed = sql.trim();
        let first_word = trimmed
            .split(|c: char| c == ' ' || c == '\n' || c == '\t')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        let is_query = matches!(first_word.as_str(), "select" | "pragma" | "explain" | "with");
        if !is_query {
            return self.run_sql(trimmed).await;
        }
        let start = Instant::now();
        let (columns, _total) = self.run_select_stream(trimmed, &[], on_batch).await?;
        Ok(QueryResult {
            columns,
            rows: Vec::new(),
            rows_affected: 0,
            is_select: true,
            error: None,
            elapsed_ms: start.elapsed().as_millis(),
        })
    }

    /// The single place query creation happens: turn structured operation
    /// details into SQLite SQL with bound `?` parameters. Adding support for
    /// a new database means implementing this per adapter — UI code never
    /// writes SQL itself.
    pub fn build_query(&self, op: &QueryOp) -> DbResult<BuiltQuery> {
        self.build_query_inner(op)
    }

    fn build_query_inner(&self, op: &QueryOp) -> DbResult<BuiltQuery> {
        match op {
            QueryOp::Select { table, filters, custom_where, order_by, order_dir, limit, offset } => {
                let mut sql = format!("SELECT * FROM {}", quote_ident(table));
                let params = apply_where(&mut sql, filters, custom_where.as_deref());
                if let Some(col) = order_by {
                    let dir = order_direction(order_dir.as_deref());
                    sql.push_str(&format!(" ORDER BY {} {}", quote_ident(col), dir));
                }
                if let Some(l) = limit {
                    sql.push_str(&format!(" LIMIT {l}"));
                }
                if let Some(o) = offset {
                    sql.push_str(&format!(" OFFSET {o}"));
                }
                Ok(BuiltQuery { sql, params })
            }
            QueryOp::Count { table, filters, custom_where } => {
                let mut sql = format!("SELECT COUNT(*) FROM {}", quote_ident(table));
                let params = apply_where(&mut sql, filters, custom_where.as_deref());
                Ok(BuiltQuery { sql, params })
            }
            QueryOp::SelectDistinct { table, column, limit } => {
                let mut sql = format!(
                    "SELECT DISTINCT {c} FROM {t} WHERE {c} IS NOT NULL ORDER BY 1",
                    c = quote_ident(column),
                    t = quote_ident(table),
                );
                if let Some(l) = limit {
                    sql.push_str(&format!(" LIMIT {l}"));
                }
                Ok(BuiltQuery { sql, params: Vec::new() })
            }
            QueryOp::Insert { table, values, skip_empty } => {
                // BTreeMap iterates in sorted key order, keeping the column
                // list and the parameter vector aligned.
                let entries: Vec<(&String, &Option<String>)> = values
                    .iter()
                    .filter(|(_, v)| !skip_empty || v.as_deref().is_some_and(|s| !s.is_empty()))
                    .collect();
                if entries.is_empty() {
                    return Ok(BuiltQuery {
                        sql: format!("INSERT INTO {} DEFAULT VALUES", quote_ident(table)),
                        params: Vec::new(),
                    });
                }
                let cols = entries.iter().map(|(c, _)| quote_ident(c)).collect::<Vec<_>>().join(", ");
                let marks = entries.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
                Ok(BuiltQuery {
                    sql: format!(
                        "INSERT INTO {} ({}) VALUES ({})",
                        quote_ident(table),
                        cols,
                        marks
                    ),
                    params: entries.iter().map(|(_, v)| (*v).clone()).collect(),
                })
            }
            QueryOp::Update { table, set, match_row } => {
                let sets = set.iter().map(|(c, _)| format!("{} = ?", quote_ident(c)))
                    .collect::<Vec<_>>()
                    .join(", ");
                let mut sql = format!("UPDATE {} SET {}", quote_ident(table), sets);
                let mut params: Vec<Option<String>> = set.values().cloned().collect();
                append_match_row(&mut sql, match_row, &mut params)?;
                Ok(BuiltQuery { sql, params })
            }
            QueryOp::Delete { table, match_row } => {
                let mut sql = format!("DELETE FROM {}", quote_ident(table));
                let mut params = Vec::new();
                append_match_row(&mut sql, match_row, &mut params)?;
                Ok(BuiltQuery { sql, params })
            }
            QueryOp::DropTable { table } => Ok(BuiltQuery {
                sql: format!("DROP TABLE {}", quote_ident(table)),
                params: Vec::new(),
            }),
        }
    }

    /// Execute a structured operation: build the SQL via [`Self::build_query`]
    /// and run it. Reads return rows; writes return the affected count.
    pub async fn execute_op(&self, op: &QueryOp) -> DbResult<super::OpOutcome> {
        let start = Instant::now();
        let q = self.build_query(op)?;
        let sql = Some(super::inline_placeholders(&q.sql, &q.params, false) + ";");
        match op {
            QueryOp::Select { .. } | QueryOp::Count { .. } | QueryOp::SelectDistinct { .. } => {
                let result = self.run_sql_params(&q.sql, &q.params).await?;
                Ok(super::OpOutcome { result, sql })
            }
            _ => {
                let rows_affected = self.execute_params(&q.sql, &q.params).await?;
                Ok(super::OpOutcome {
                    result: QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        rows_affected,
                        is_select: false,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                    },
                    sql,
                })
            }
        }
    }

    /// Apply a whole batch of structured schema (DDL) operations as ONE
    /// transaction: either every statement commits, or a failure on any op
    /// rolls everything back and the schema is left exactly as before. This
    /// matters because several ops are pairs by design — e.g. editing an
    /// index runs `DROP INDEX` + `CREATE INDEX`; without the transaction a
    /// failed CREATE would leave the index deleted.
    ///
    /// FK enforcement is suspended for the duration (outside the transaction
    /// — SQLite ignores the pragma inside one) because intermediate batch
    /// states (dropped/rebuilt tables) can transiently violate foreign keys.
    /// Returns every statement that ran so the UI can show/copy it.
    pub async fn apply_schema_ops_batch(&self, ops: &[SchemaOp]) -> DbResult<Vec<String>> {
        let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&mut *conn)
            .await
            .map_err(DbError::SqlEngine)?;

        // The whole batch runs inside one scoped block so the transaction's
        // borrow of `conn` ends before the FK pragma is restored, whatever
        // the outcome. Any `Err` path has already rolled the tx back (or the
        // drop of a live transaction does it implicitly).
        let batch = async {
            let mut tx = conn.begin().await.map_err(DbError::SqlEngine)?;
            let mut executed: Vec<String> = Vec::new();
            for op in ops {
                match Self::apply_op(&mut *tx, op).await {
                    Ok(mut ran) => executed.append(&mut ran),
                    Err(e) => {
                        let _ = tx.rollback().await;
                        return Err(e);
                    }
                }
            }
            tx.commit().await.map_err(DbError::SqlEngine)?;
            Ok(executed)
        }
        .await;

        Self::restore_foreign_keys(&mut conn).await;
        batch
    }

    async fn restore_foreign_keys(conn: &mut sqlx::SqliteConnection) {
        let _ = sqlx::query("PRAGMA foreign_keys = ON").execute(&mut *conn).await;
    }

    /// Execute one operation on an existing connection (inside the caller's
    /// transaction) and return every SQL statement that ran. See [`SchemaOp`]
    /// for the semantics of each variant.
    async fn apply_op(conn: &mut sqlx::SqliteConnection, op: &SchemaOp) -> DbResult<Vec<String>> {
        match op {
            SchemaOp::AlterColumn {
                table,
                column,
                new_name,
                data_type,
                not_null,
                default_mode,
                default_value,
            } => {
                // Plans AND executes internally (rename-only or full rebuild).
                Self::alter_column(
                    conn,
                    table,
                    column,
                    new_name,
                    data_type.as_deref(),
                    *not_null,
                    *default_mode,
                    default_value.as_deref(),
                )
                .await
            }
            other => {
                // Guard against SQLite's double-quoted-string fallback: a
                // quoted identifier that matches no column silently degrades
                // to a string literal, so `CREATE INDEX ... ("typo")` would
                // build a constant-expression index instead of failing. Check
                // the columns up front and reject unknown ones.
                if let SchemaOp::CreateIndex { table, columns, .. } = other {
                    let known: Vec<(String,)> = sqlx::query_as(&format!(
                        "SELECT name FROM pragma_table_info('{}')",
                        escape_str(table)
                    ))
                    .fetch_all(&mut *conn)
                    .await
                    .map_err(DbError::SqlEngine)?;
                    let names: std::collections::HashSet<&str> =
                        known.iter().map(|(n,)| n.as_str()).collect();
                    for c in columns {
                        if !names.contains(c.as_str()) {
                            return Err(DbError::InvalidOperation(format!(
                                "column '{}' not found on table '{}'",
                                c, table
                            )));
                        }
                    }
                }
                let stmts = Self::plan_schema_sql(other)?;
                let mut executed = Vec::with_capacity(stmts.len());
                for s in &stmts {
                    sqlx::query(s).execute(&mut *conn).await.map_err(DbError::SqlEngine)?;
                    executed.push(s.clone());
                }
                Ok(executed)
            }
        }
    }

    /// Build the dialect SQL for every simple [`SchemaOp`] (everything whose
    /// change SQLite supports natively). `AlterColumn` is handled separately
    /// because it may need the full rebuild procedure instead.
    fn plan_schema_sql(op: &SchemaOp) -> DbResult<Vec<String>> {
        Ok(match op {
            SchemaOp::RenameTable { table, new_name } => {
                let new_name = new_name.trim();
                if new_name.is_empty() {
                    return Err(DbError::InvalidOperation("table name is empty".into()));
                }
                vec![format!(
                    "ALTER TABLE {} RENAME TO {}",
                    quote_ident(table),
                    quote_ident(new_name)
                )]
            }
            SchemaOp::AddColumn {
                table,
                name,
                data_type,
                not_null,
                default,
            } => {
                let def = RawColumn {
                    name: name.clone(),
                    data_type: data_type.trim().to_string(),
                    not_null: *not_null,
                    default: default.as_deref().map(normalize_default_literal),
                    pk: 0,
                };
                vec![format!(
                    "ALTER TABLE {} ADD COLUMN {}",
                    quote_ident(table),
                    col_definition(&def, &[])
                )]
            }
            SchemaOp::DropColumn { table, name } => vec![format!(
                "ALTER TABLE {} DROP COLUMN {}",
                quote_ident(table),
                quote_ident(name)
            )],
            SchemaOp::CreateIndex {
                table,
                name,
                columns,
                unique,
            } => {
                if columns.is_empty() {
                    return Err(DbError::InvalidOperation(
                        "an index needs at least one column".into(),
                    ));
                }
                let cols = columns
                    .iter()
                    .map(|c| quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ");
                vec![format!(
                    "CREATE {}INDEX {} ON {} ({})",
                    if *unique { "UNIQUE " } else { "" },
                    quote_ident(name),
                    quote_ident(table),
                    cols
                )]
            }
            SchemaOp::DropIndex { index, .. } => {
                vec![format!("DROP INDEX {}", quote_ident(index))]
            }
            SchemaOp::DropTrigger { name } => {
                vec![format!("DROP TRIGGER {}", quote_ident(name))]
            }
            SchemaOp::SetPrimaryKey { .. }
            | SchemaOp::AddForeignKey { .. }
            | SchemaOp::DropConstraint { .. } => {
                return Err(DbError::InvalidOperation(
                    "primary-key / foreign-key editing requires a table rebuild and is \
                     currently supported on PostgreSQL connections only"
                        .into(),
                ));
            }
            SchemaOp::CreateTrigger { sql } => {
                let sql = sql.trim();
                if sql.is_empty() {
                    return Err(DbError::InvalidOperation(
                        "trigger SQL is empty".into(),
                    ));
                }
                if !sql.to_lowercase().starts_with("create trigger")
                    && !sql.to_lowercase().starts_with("create or replace trigger")
                {
                    return Err(DbError::InvalidOperation(
                        "trigger SQL must start with CREATE TRIGGER".into(),
                    ));
                }
                vec![sql.to_string()]
            }
            SchemaOp::AlterColumn { .. } => unreachable!("handled by the caller"),
        })
    }

    /// Resolve an `alter_column` request against the live schema: a pure
    /// rename becomes a cheap `ALTER TABLE ... RENAME COLUMN`; anything else
    /// (type / NOT NULL / DEFAULT) requires rebuilding the table because
    /// SQLite has no in-place ALTER for those.
    async fn alter_column(
        conn: &mut sqlx::SqliteConnection,
        table: &str,
        column: &str,
        new_name: &Option<String>,
        data_type: Option<&str>,
        not_null: Option<bool>,
        default_mode: Option<DefaultMode>,
        default_value: Option<&str>,
    ) -> DbResult<Vec<String>> {
        let cols = read_raw_columns(conn, table).await?;
        let current = cols
            .iter()
            .find(|c| c.name == column)
            .ok_or_else(|| {
                DbError::InvalidOperation(format!("column '{}' not found", column))
            })?
            .clone();
        drop(cols);

        let target_name = new_name
            .clone()
            .map(|n| n.trim().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| current.name.clone());
        let target_type = data_type
            .map(|t| t.trim().to_string())
            .unwrap_or_else(|| current.data_type.clone());
        let target_not_null = not_null.unwrap_or(current.not_null);
        let (target_default, default_changed) = match default_mode {
            None | Some(DefaultMode::Keep) => (current.default.clone(), false),
            Some(DefaultMode::Drop) => (None, current.default.is_some()),
            Some(DefaultMode::Set) => {
                let literal = default_value.map(normalize_default_literal);
                (literal.clone(), literal != current.default)
            }
        };

        let renamed = target_name != current.name;
        let changed = target_type != current.data_type
            || target_not_null != current.not_null
            || default_changed;
        if !renamed && !changed {
            return Ok(Vec::new()); // nothing to do
        }
        if !changed {
            let sql = format!(
                "ALTER TABLE {} RENAME COLUMN {} TO {}",
                quote_ident(table),
                quote_ident(&current.name),
                quote_ident(&target_name)
            );
            sqlx::query(&sql).execute(&mut *conn).await.map_err(DbError::SqlEngine)?;
            return Ok(vec![sql]);
        }

        let final_def = RawColumn {
            name: target_name,
            data_type: target_type,
            not_null: target_not_null,
            default: target_default,
            pk: current.pk,
        };
        Self::rebuild_table_column(conn, table, column, final_def).await
    }

    /// Rebuild a table with one column replaced by `final_def` (identified by
    /// its CURRENT name `current_name`). SQLite has no in-place ALTER for
    /// type/NOT NULL/DEFAULT changes, so this follows the classic procedure:
    /// create the new definition under a temp name, copy every row over,
    /// drop the original, rename the copy into place, and recreate the
    /// table's explicit indexes. Runs on the caller's connection inside its
    /// transaction; foreign keys are suspended by the batch wrapper because
    /// the intermediate DROP would otherwise be rejected while other tables
    /// still reference this one.
    ///
    /// Caveats: CHECK constraints, collations and inline UNIQUE clauses of
    /// the original CREATE TABLE are not carried over (the rebuild is built
    /// from live metadata), and triggers/views referencing the table are left
    /// untouched and may need manual fixing.
    async fn rebuild_table_column(
        conn: &mut sqlx::SqliteConnection,
        table: &str,
        current_name: &str,
        final_def: RawColumn,
    ) -> DbResult<Vec<String>> {
        let mut cols = read_raw_columns(conn, table).await?;
        let idx = cols
            .iter()
            .position(|c| c.name == current_name)
            .ok_or_else(|| {
                DbError::InvalidOperation(format!("column '{}' not found", current_name))
            })?;
        cols[idx] = final_def;

        let pk_cols: Vec<String> = cols
            .iter()
            .filter(|c| c.pk > 0)
            .collect::<Vec<_>>()
            .into_iter()
            .map(|c| c.name.clone())
            .collect();

        let fks = group_foreign_keys(conn, table).await?;
        let index_sql = recreate_index_statements(conn, table).await?;

        let tmp_ident = quote_ident(&format!("{}__dh_rebuild", table));
        let table_ident = quote_ident(table);

        let mut defs: Vec<String> = cols.iter().map(|c| col_definition(c, &pk_cols)).collect();
        if pk_cols.len() > 1 {
            let list = pk_cols.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", ");
            defs.push(format!("PRIMARY KEY ({})", list));
        }
        for fk in &fks {
            let from = fk.columns.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", ");
            match &fk.referenced_columns {
                Some(to) => {
                    let to_list =
                        to.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", ");
                    defs.push(format!(
                        "FOREIGN KEY ({}) REFERENCES {} ({})",
                        from,
                        quote_ident(&fk.referenced_table),
                        to_list
                    ));
                }
                None => {
                    defs.push(format!(
                        "FOREIGN KEY ({}) REFERENCES {}",
                        from,
                        quote_ident(&fk.referenced_table)
                    ));
                }
            }
        }

        let all_cols = cols.iter().map(|c| quote_ident(&c.name)).collect::<Vec<_>>().join(", ");
        let mut stmts = vec![
            format!("DROP TABLE IF EXISTS {}", tmp_ident),
            format!("CREATE TABLE {} ({})", tmp_ident, defs.join(", ")),
            format!(
                "INSERT INTO {} ({}) SELECT {} FROM {}",
                tmp_ident, all_cols, all_cols, table_ident
            ),
            format!("DROP TABLE {}", table_ident),
            format!("ALTER TABLE {} RENAME TO {}", tmp_ident, table_ident),
        ];
        stmts.extend(index_sql);

        for s in &stmts {
            sqlx::query(s).execute(&mut *conn).await.map_err(DbError::SqlEngine)?;
        }
        Ok(stmts)
    }

    /// Merge the WAL into the main database file so the file alone holds all
    /// changes (used before save and before closing a connection).
    pub async fn checkpoint(&self) -> DbResult<()> {
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        Ok(())
    }

    /// Serialize the full database contents to bytes (for download/save).
    pub async fn save_bytes(&self) -> DbResult<Vec<u8>> {
        // Flush WAL into the main db file so the file alone is the whole database.
        self.checkpoint().await?;
        std::fs::read(&self.path).map_err(DbError::Io)
    }

    /// Duplicate a table including its structure (column types, primary/foreign
    /// keys, constraints, indexes) and all of its data. Views fall back to a
    /// plain `CREATE TABLE AS SELECT` copy.
    pub async fn duplicate_table(&self, source: &str, target: &str) -> DbResult<Vec<String>> {
        let mut ran: Vec<String> = Vec::new();
        const LOOKUP: &str = "SELECT type, sql FROM sqlite_master WHERE name = ?";
        let row: Option<(String, Option<String>)> = sqlx::query_as(LOOKUP)
            .bind(source)
            .fetch_optional(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        ran.push(format!("{LOOKUP};"));

        match row {
            Some((kind, Some(ddl))) if kind == "table" && !ddl.trim().is_empty() => {
                let rewritten = rewrite_table_name(&ddl, source, target);
                ran.push(format!("{rewritten};"));
                sqlx::query(&rewritten)
                    .execute(&self.pool)
                    .await
                    .map_err(DbError::SqlEngine)?;
                ran.append(&mut self.duplicate_indexes(source, target).await?);
            }
            _ => {
                let fallback = format!(
                    "CREATE TABLE {} AS SELECT * FROM {}",
                    quote_ident(target),
                    quote_ident(source),
                );
                ran.push(format!("{fallback};"));
                sqlx::query(&fallback)
                    .execute(&self.pool)
                    .await
                    .map_err(DbError::SqlEngine)?;
            }
        }

        let copy = format!(
            "INSERT INTO {} SELECT * FROM {}",
            quote_ident(target),
            quote_ident(source),
        );
        ran.push(format!("{copy};"));
        sqlx::query(&copy)
            .execute(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        Ok(ran)
    }

    /// Re-create every user index of `source` under `target`, returning the
    /// statements that ran.
    async fn duplicate_indexes(&self, source: &str, target: &str) -> DbResult<Vec<String>> {
        let mut ran = Vec::new();
        let indexes: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name = ?",
        )
        .bind(source)
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        for (name, ddl) in indexes {
            if name.starts_with("sqlite_autoindex") {
                continue;
            }
            if let Some(sql) = ddl {
                if sql.trim().is_empty() {
                    continue;
                }
                let new_name = format!("{}_{}", target, name);
                let rewritten = rewrite_index(&sql, &new_name, source, target);
                ran.push(format!("{rewritten};"));
                sqlx::query(&rewritten)
                    .execute(&self.pool)
                    .await
                    .map_err(DbError::SqlEngine)?;
            }
        }
        Ok(ran)
    }

    /// Close the pool, waiting for any in-flight queries to finish. SQLite
    /// normally removes `.db-wal`/`.db-shm` once the last handle is closed.
    pub async fn close_pool(&self) {
        self.pool.close().await;
    }

    /// Remove any leftover WAL/shared-memory sibling files (the `.db` itself
    /// is kept). SQLite names these `<db>-wal` and `<db>-shm`.
    pub fn remove_aux_files(&self) {
        let _ = std::fs::remove_file(format!("{}-wal", self.path().display()));
        let _ = std::fs::remove_file(format!("{}-shm", self.path().display()));
    }

    /// Remove the database file and any leftover WAL/shared-memory siblings.
    pub fn remove_files(&self) {
        self.remove_aux_files();
        let _ = std::fs::remove_file(self.path());
    }
}

fn temp_path(name: &str) -> DbResult<PathBuf> {
    let dir = std::env::temp_dir().join("dh-studio");
    std::fs::create_dir_all(&dir)?;
    let safe = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let path = dir.join(format!("{}-{}.db", safe, uuid::Uuid::new_v4()));
    Ok(path)
}

fn cell_to_string(v: sqlx::sqlite::SqliteValueRef<'_>) -> Option<String> {
    if v.is_null() {
        return None;
    }
    if let Some(s) = v.to_owned().try_decode::<String>().ok() {
        return Some(s);
    }
    if let Some(i) = v.to_owned().try_decode::<i64>().ok() {
        return Some(i.to_string());
    }
    if let Some(f) = v.to_owned().try_decode::<f64>().ok() {
        return Some(f.to_string());
    }
    v.to_owned()
        .try_decode::<Vec<u8>>()
        .ok()
        .map(|b| format!("{:?}", b))
}

/// Escape a single-quoted SQL string literal (identifier-safe for PRAGMA name args).
fn escape_str(s: &str) -> String {
    s.replace('\'', "''")
}

/// Quote an identifier for use inside a DDL/DML statement.
fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// One column of a table as read from `PRAGMA table_info`. `pk` is the
/// 1-based position of the column inside the primary key (0 = not part of it).
#[derive(Debug, Clone)]
struct RawColumn {
    name: String,
    data_type: String,
    not_null: bool,
    /// DEFAULT clause as raw literal text straight from the schema (e.g.
    /// `0`, `'x'`, `CURRENT_TIMESTAMP`) or normalized by
    /// [`normalize_default_literal`] for user-supplied values.
    default: Option<String>,
    pk: i64,
}

async fn read_raw_columns(
    conn: &mut sqlx::SqliteConnection,
    table: &str,
) -> DbResult<Vec<RawColumn>> {
    let sql = format!("PRAGMA table_info('{}')", escape_str(table));
    let rows: Vec<(i64, String, String, i64, Option<String>, i64)> =
        sqlx::query_as(&sql).fetch_all(conn).await.map_err(DbError::SqlEngine)?;
    Ok(rows
        .into_iter()
        .map(|(_cid, name, data_type, not_null, default, pk)| RawColumn {
            name,
            data_type,
            not_null: not_null != 0,
            default,
            pk,
        })
        .collect())
}

/// A foreign key grouped back into one clause: `FOREIGN KEY (cols)
/// REFERENCES tbl (target_cols?)`.
struct GroupedFk {
    referenced_table: String,
    columns: Vec<String>,
    referenced_columns: Option<Vec<String>>,
}

async fn group_foreign_keys(
    conn: &mut sqlx::SqliteConnection,
    table: &str,
) -> DbResult<Vec<GroupedFk>> {
    let sql = format!("PRAGMA foreign_key_list('{}')", escape_str(table));
    let rows: Vec<(i64, i64, String, String, Option<String>)> =
        sqlx::query_as(&sql).fetch_all(conn).await.map_err(DbError::SqlEngine)?;
    // Group rows by FK id; within a composite key SQLite lists the columns in
    // reverse declaration order, so sort each group's pairs by seq DESCENDING
    // to reconstruct the original clause.
    let mut groups: std::collections::BTreeMap<
        i64,
        (String, Vec<(i64, String)>, Option<Vec<(i64, String)>>),
    > = std::collections::BTreeMap::new();
    for (id, seq, referenced_table, column, referenced_column) in rows {
        let g = groups
            .entry(id)
            .or_insert_with(|| (referenced_table.clone(), Vec::new(), Some(Vec::new())));
        g.1.push((seq, column));
        match (g.2.as_mut(), referenced_column) {
            (Some(rc), Some(target)) => rc.push((seq, target)),
            _ => g.2 = None,
        }
    }
    Ok(groups
        .into_values()
        .map(|(table_name, mut cols, targets)| {
            cols.sort_by(|a, b| b.0.cmp(&a.0));
            let targets = targets.map(|mut t| {
                t.sort_by(|a, b| b.0.cmp(&a.0));
                t.into_iter().map(|(_, c)| c).collect::<Vec<_>>()
            });
            GroupedFk {
                referenced_table: table_name,
                columns: cols.into_iter().map(|(_, c)| c).collect(),
                referenced_columns: targets,
            }
        })
        .collect())
}

/// CREATE INDEX statements that re-create the table's explicit indexes
/// (`c` = user-created, `u` = UNIQUE constraint — both were dropped together
/// with the old table; auto PK indexes come back via the PRIMARY KEY clause).
async fn recreate_index_statements(
    conn: &mut sqlx::SqliteConnection,
    table: &str,
) -> DbResult<Vec<String>> {
    let list_sql = format!("PRAGMA index_list('{}')", escape_str(table));
    let rows: Vec<(i64, String, i64, String, i64)> =
        sqlx::query_as(&list_sql).fetch_all(&mut *conn).await.map_err(DbError::SqlEngine)?;
    let mut out = Vec::new();
    for (_seq, name, unique, origin, partial) in rows {
        // Partial indexes are not carried over by the rebuild, and pk/'u'
        // origins are implicit (constraint-owned, reserved sqlite_autoindex
        // names) — the fresh CREATE TABLE already reproduces them.
        if partial != 0 || origin != "c" {
            continue;
        }
        let info_sql = format!("PRAGMA index_info('{}')", escape_str(&name));
        let cols: Vec<(i64, i64, String)> = sqlx::query_as(&info_sql)
            .fetch_all(&mut *conn)
            .await
            .map_err(DbError::SqlEngine)?;
        let col_list = cols
            .into_iter()
            .map(|(_, _, c)| quote_ident(&c))
            .collect::<Vec<_>>()
            .join(", ");
        out.push(format!(
            "CREATE {}INDEX {} ON {} ({})",
            if unique != 0 { "UNIQUE " } else { "" },
            quote_ident(&name),
            quote_ident(table),
            col_list
        ));
    }
    Ok(out)
}

/// Render one column definition for CREATE TABLE / ADD COLUMN.
fn col_definition(c: &RawColumn, pk_cols: &[String]) -> String {
    let mut s = quote_ident(&c.name);
    if !c.data_type.is_empty() {
        s.push(' ');
        s.push_str(&c.data_type);
    }
    if c.not_null {
        s.push_str(" NOT NULL");
    }
    if let Some(d) = &c.default {
        s.push_str(" DEFAULT ");
        s.push_str(d);
    }
    if pk_cols.len() == 1 && pk_cols[0] == c.name {
        s.push_str(" PRIMARY KEY");
    }
    s
}

/// Turn a user-typed DEFAULT value into safe literal text. Free text is
/// always treated as a string literal (quoted/escaped), numbers pass through,
/// and the NULL/CURRENT_* keywords are recognized so they keep their special
/// meaning. User input is never spliced into DDL unquoted.
fn normalize_default_literal(input: &str) -> String {
    let t = input.trim();
    if t.is_empty() || t.eq_ignore_ascii_case("null") {
        return "NULL".to_string();
    }
    if matches!(
        t.to_ascii_lowercase().as_str(),
        "current_timestamp" | "current_time" | "current_date"
    ) {
        return t.to_ascii_uppercase();
    }
    let body = t.strip_prefix(['+', '-']).unwrap_or(t);
    let looks_numeric = !body.is_empty()
        && body.chars().all(|c| c.is_ascii_digit() || c == '.')
        && body.matches('.').count() <= 1;
    if looks_numeric {
        return t.to_string();
    }
    format!("'{}'", t.replace('\'', "''"))
}

/// Bind value for an equality/comparison filter: the UI treats an empty
/// string as "no value", which binds NULL.
fn bind_value(v: &str) -> Option<String> {
    if v.is_empty() { None } else { Some(v.to_string()) }
}

/// Escape LIKE wildcards in user input; used with `ESCAPE '\'`.
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

/// ASC/DESC keyword from an optional direction string (defaults to ASC).
fn order_direction(dir: Option<&str>) -> &'static str {
    if dir.is_some_and(|d| d.eq_ignore_ascii_case("desc")) { "DESC" } else { "ASC" }
}

/// Append a WHERE clause matching every column of a stored row: `col = ?`
/// for values, `col IS NULL` for NULLs (plain `= NULL` never matches). The
/// full row is matched instead of just the primary key so the target stays
/// correct even when the user edits key columns, and tables without any
/// primary key remain editable.
fn append_match_row(
    sql: &mut String,
    row: &std::collections::BTreeMap<String, Option<String>>,
    params: &mut Vec<Option<String>>,
) -> DbResult<()> {
    if row.is_empty() {
        return Err(DbError::InvalidOperation(
            "operation needs at least one column to match".into(),
        ));
    }
    let parts = row
        .iter()
        .map(|(c, v)| match v {
            Some(_) => {
                params.push(v.clone());
                format!("{} = ?", quote_ident(c))
            }
            None => format!("{} IS NULL", quote_ident(c)),
        })
        .collect::<Vec<_>>()
        .join(" AND ");
    sql.push_str(" WHERE ");
    sql.push_str(&parts);
    Ok(())
}

/// Append the WHERE clause to `sql` from UI filters (or the user's raw WHERE
/// text, which wins when both are present) and return the bound parameters.
fn apply_where(
    sql: &mut String,
    filters: &[GridFilterCond],
    custom_where: Option<&str>,
) -> Vec<Option<String>> {
    let mut parts: Vec<String> = Vec::new();
    let mut params: Vec<Option<String>> = Vec::new();
    for f in filters {
        let col = quote_ident(&f.column);
        let part = match f.op {
            FilterOp::Eq => {
                params.push(bind_value(&f.value));
                format!("{col} = ?")
            }
            FilterOp::Neq => {
                params.push(bind_value(&f.value));
                format!("{col} != ?")
            }
            FilterOp::Contains => {
                params.push(Some(format!("%{}%", escape_like(&f.value))));
                format!("{col} LIKE ? ESCAPE '\\'")
            }
            FilterOp::StartsWith => {
                params.push(Some(format!("{}%", escape_like(&f.value))));
                format!("{col} LIKE ? ESCAPE '\\'")
            }
            FilterOp::EndsWith => {
                params.push(Some(format!("%{}", escape_like(&f.value))));
                format!("{col} LIKE ? ESCAPE '\\'")
            }
            FilterOp::Gt => {
                params.push(bind_value(&f.value));
                format!("{col} > ?")
            }
            FilterOp::Gte => {
                params.push(bind_value(&f.value));
                format!("{col} >= ?")
            }
            FilterOp::Lt => {
                params.push(bind_value(&f.value));
                format!("{col} < ?")
            }
            FilterOp::Lte => {
                params.push(bind_value(&f.value));
                format!("{col} <= ?")
            }
            FilterOp::IsNull => format!("{col} IS NULL"),
            FilterOp::IsNotNull => format!("{col} IS NOT NULL"),
        };
        if parts.is_empty() {
            parts.push(part);
        } else {
            let conj = if f.conjunction.as_deref().is_some_and(|c| c.eq_ignore_ascii_case("OR")) {
                "OR"
            } else {
                "AND"
            };
            parts.push(format!("{conj} {part}"));
        }
    }
    if !parts.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&parts.join(" "));
    } else if let Some(w) = custom_where.map(str::trim).filter(|w| !w.is_empty()) {
        sql.push_str(" WHERE ");
        sql.push_str(w);
    }
    params
}

fn unquote(tok: &str) -> &str {
    if tok.len() >= 2 && tok.starts_with('"') && tok.ends_with('"') {
        &tok[1..tok.len() - 1]
    } else {
        tok
    }
}

/// Rewrite a `CREATE TABLE` statement so it targets `target` instead of
/// `source`. Only the identifier after `CREATE TABLE [IF NOT EXISTS]
/// [schema.]` is replaced — the column definitions (types, keys, constraints)
/// are preserved verbatim.
fn rewrite_table_name(ddl: &str, source: &str, target: &str) -> String {
    let Some(open) = ddl.find('(') else {
        return ddl.to_string();
    };
    let header = &ddl[..open];
    let body = &ddl[open..];
    let new_header = header
        .split_whitespace()
        .map(|tok| {
            let (prefix, name) = match tok.rfind('.') {
                Some(i) => (&tok[..=i], &tok[i + 1..]),
                None => ("", tok),
            };
            if unquote(name) == source {
                format!("{prefix}{}", quote_ident(target))
            } else {
                tok.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    format!("{new_header}{body}")
}

/// Rewrite a `CREATE [UNIQUE] INDEX` statement so it uses `new_index_name` and
/// targets `target` instead of `source`.
fn rewrite_index(ddl: &str, new_index_name: &str, source: &str, target: &str) -> String {
    let mut out = String::new();
    let mut sep = "";
    let mut replaced_name = false;
    let mut seen_on = false;
    for tok in ddl.split_whitespace() {
        let lower = tok.to_ascii_lowercase();
        let piece = if lower == "on" {
            seen_on = true;
            tok.to_string()
        } else if !replaced_name && !matches!(lower.as_str(), "create" | "index" | "unique" | "if" | "not" | "exists") {
            replaced_name = true;
            quote_ident(new_index_name)
        } else if seen_on {
            let (prefix, name) = match tok.rfind('.') {
                Some(i) => (&tok[..=i], &tok[i + 1..]),
                None => ("", tok),
            };
            seen_on = false;
            if unquote(name) == source {
                format!("{prefix}{}", quote_ident(target))
            } else {
                tok.to_string()
            }
        } else {
            tok.to_string()
        };
        out.push_str(sep);
        out.push_str(&piece);
        sep = " ";
    }
    out
}
#[cfg(test)]
mod tests {
    use super::*;

    async fn test_adapter() -> SqliteAdapter {
        let dir = std::env::temp_dir().join("dh-studio-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("test-{}.db", uuid::Uuid::new_v4()));
        SqliteAdapter::connect(path).await.unwrap()
    }

    async fn index_exists(adapter: &SqliteAdapter, name: &str) -> bool {
        let rows: Vec<(String,)> =
            sqlx::query_as("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
                .bind(name)
                .fetch_all(&adapter.pool)
                .await
                .unwrap();
        !rows.is_empty()
    }

    /// The exact scenario that motivated the transaction: an index edit is a
    /// DROP + CREATE pair. Realistic failure path — unique was toggled OFF
    /// (batch 1 succeeded), duplicate rows snuck in while enforcement was
    /// off, then toggling unique back ON fails on the UNIQUE violation. The
    /// rollback must restore the non-unique index instead of leaving none.
    #[tokio::test]
    async fn failed_batch_rolls_back_drop_index() {
        let adapter = test_adapter().await;
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT)")
            .execute(&adapter.pool)
            .await
            .unwrap();
        sqlx::query("CREATE UNIQUE INDEX ux_email ON t (email)")
            .execute(&adapter.pool)
            .await
            .unwrap();

        // Batch 1 — toggle unique OFF: drop + recreate as a plain index.
        let batch1 = vec![
            SchemaOp::DropIndex { table: None, index: "ux_email".into() },
            SchemaOp::CreateIndex {
                table: "t".into(),
                name: "ux_email".into(),
                columns: vec!["email".into()],
                unique: false,
            },
        ];
        adapter.apply_schema_ops_batch(&batch1).await.unwrap();

        // With uniqueness no longer enforced, duplicate emails sneak in.
        sqlx::query("INSERT INTO t (email) VALUES ('a@x.dev'), ('a@x.dev')")
            .execute(&adapter.pool)
            .await
            .unwrap();

        // Batch 2 — toggle unique back ON: the CREATE hits the duplicates…
        let batch2 = vec![
            SchemaOp::DropIndex { table: None, index: "ux_email".into() },
            SchemaOp::CreateIndex {
                table: "t".into(),
                name: "ux_email".into(),
                columns: vec!["email".into()],
                unique: true,
            },
        ];
        let result = adapter.apply_schema_ops_batch(&batch2).await;
        assert!(result.is_err(), "batch should fail on the UNIQUE violation");
        // …so the DROP rolls back and the index survives, still non-unique.
        assert!(
            index_exists(&adapter, "ux_email").await,
            "DROP INDEX must be rolled back when the paired CREATE fails"
        );
        let sql: Vec<(Option<String>,)> = sqlx::query_as(
            "SELECT sql FROM sqlite_master WHERE type='index' AND name='ux_email'",
        )
        .fetch_all(&adapter.pool)
        .await
        .unwrap();
        let ddl = sql[0].0.as_deref().unwrap_or_default();
        assert!(
            !ddl.contains("UNIQUE"),
            "rolled-back index must be the pre-batch NON-unique one: {ddl}"
        );
    }

    /// A typo'd column in CreateIndex must fail loudly instead of SQLite's
    /// double-quoted-string fallback silently creating an expression index.
    #[tokio::test]
    async fn create_index_rejects_unknown_column() {
        let adapter = test_adapter().await;
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT)")
            .execute(&adapter.pool)
            .await
            .unwrap();
        let ops = vec![SchemaOp::CreateIndex {
            table: "t".into(),
            name: "ix_bad".into(),
            columns: vec!["no_such_column".into()],
            unique: false,
        }];
        let result = adapter.apply_schema_ops_batch(&ops).await;
        assert!(result.is_err(), "unknown column must be rejected");
        assert!(
            !index_exists(&adapter, "ix_bad").await,
            "no index should exist for an unknown column"
        );
    }

    /// A fully valid batch commits every statement.
    #[tokio::test]
    async fn successful_batch_commits() {
        let adapter = test_adapter().await;
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT)")
            .execute(&adapter.pool)
            .await
            .unwrap();

        let ops = vec![
            SchemaOp::AddColumn {
                table: "t".into(),
                name: "phone".into(),
                data_type: "TEXT".into(),
                not_null: false,
                default: None,
            },
            SchemaOp::CreateIndex {
                table: "t".into(),
                name: "ix_phone".into(),
                columns: vec!["phone".into()],
                unique: true,
            },
        ];
        let ran = adapter.apply_schema_ops_batch(&ops).await.unwrap();
        assert_eq!(ran.len(), 2);
        assert!(index_exists(&adapter, "ix_phone").await);
    }

    /// Nothing from a failing batch leaks — not even earlier DDL like
    /// renames or added columns.
    #[tokio::test]
    async fn failed_batch_rolls_back_ddl_from_earlier_ops() {
        let adapter = test_adapter().await;
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT)")
            .execute(&adapter.pool)
            .await
            .unwrap();

        let ops = vec![
            SchemaOp::RenameTable { table: "t".into(), new_name: "t2".into() },
            SchemaOp::DropIndex { table: None, index: "never_existed".into() },
        ];
        assert!(adapter.apply_schema_ops_batch(&ops).await.is_err());
        let tables: Vec<(String,)> =
            sqlx::query_as("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 't%'")
                .fetch_all(&adapter.pool)
                .await
                .unwrap();
        assert_eq!(tables.len(), 1, "only the original table should exist");
        assert_eq!(tables[0].0, "t", "the rename must have been rolled back");
    }

    /// FK suspension around the batch lets a rebuild-style intermediate state
    /// pass, and enforcement is back ON afterwards.
    #[tokio::test]
    async fn foreign_keys_restored_after_batch() {
        use futures_util::future::BoxFuture;
        let adapter = test_adapter().await;
        let fk_on: BoxFuture<'_, bool> = Box::pin(async {
            let row: (i64,) = sqlx::query_as("PRAGMA foreign_keys")
                .fetch_one(&adapter.pool)
                .await
                .unwrap();
            row.0 == 1
        });
        assert!(fk_on.await, "pool default is foreign_keys = ON");

        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY)")
            .execute(&adapter.pool)
            .await
            .unwrap();
        adapter.apply_schema_ops_batch(&vec![SchemaOp::RenameTable {
            table: "t".into(),
            new_name: "t2".into(),
        }])
        .await
        .unwrap();

        let row: (i64,) = sqlx::query_as("PRAGMA foreign_keys")
            .fetch_one(&adapter.pool)
            .await
            .unwrap();
        assert_eq!(row.0, 1, "FK enforcement must be restored after the batch");
    }
}

#[cfg(test)]
mod trigger_tests {
    use super::*;

    #[tokio::test]
    async fn table_schema_lists_triggers() {
        let dir = std::env::temp_dir().join("dh-studio-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("trig-{}.db", uuid::Uuid::new_v4()));
        let adapter = SqliteAdapter::connect(path).await.unwrap();

        sqlx::query("CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER)")
            .execute(&adapter.pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE log (msg TEXT)")
            .execute(&adapter.pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TRIGGER audit_qty AFTER UPDATE OF qty ON orders\nBEGIN\n  INSERT INTO log VALUES ('changed');\nEND",
        )
        .execute(&adapter.pool)
        .await
        .unwrap();

        let (schema, _) = adapter.table_schema("orders").await.unwrap();
        assert_eq!(schema.triggers.len(), 1, "expected the audit_qty trigger");
        let t = &schema.triggers[0];
        assert_eq!(t.name, "audit_qty");
        assert_eq!(t.timing, "AFTER");
        assert_eq!(t.event, "UPDATE");
        assert!(t.sql.contains("INSERT INTO log"));
    }

    #[tokio::test]
    async fn table_schema_empty_triggers_when_none() {
        let dir = std::env::temp_dir().join("dh-studio-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("notrig-{}.db", uuid::Uuid::new_v4()));
        let adapter = SqliteAdapter::connect(path).await.unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY)")
            .execute(&adapter.pool)
            .await
            .unwrap();
        let (schema, _) = adapter.table_schema("t").await.unwrap();
        assert!(schema.triggers.is_empty());
    }
}

#[cfg(test)]
mod trigger_op_tests {
    use super::*;

    #[tokio::test]
    async fn trigger_edit_drop_create_pair_is_atomic() {
        let dir = std::env::temp_dir().join("dh-studio-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("trigop-{}.db", uuid::Uuid::new_v4()));
        let adapter = SqliteAdapter::connect(path).await.unwrap();

        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, qty INTEGER)")
            .execute(&adapter.pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE log (msg TEXT)")
            .execute(&adapter.pool)
            .await
            .unwrap();
        let old_sql = "CREATE TRIGGER audit_qty AFTER UPDATE ON t BEGIN INSERT INTO log VALUES ('u'); END";
        sqlx::query(old_sql).execute(&adapter.pool).await.unwrap();

        // Edit = drop old + create rewritten SQL, in ONE batch.
        let new_sql = "CREATE TRIGGER audit_qty AFTER INSERT ON t BEGIN INSERT INTO log VALUES ('i'); END";
        let ops = vec![
            SchemaOp::DropTrigger { name: "audit_qty".into() },
            SchemaOp::CreateTrigger { sql: new_sql.into() },
        ];
        adapter.apply_schema_ops_batch(&ops).await.unwrap();

        let (schema, _) = adapter.table_schema("t").await.unwrap();
        assert_eq!(schema.triggers.len(), 1);
        assert!(schema.triggers[0].sql.contains("AFTER INSERT"), "trigger was updated");
    }

    #[tokio::test]
    async fn failed_trigger_create_rolls_back_the_drop() {
        let dir = std::env::temp_dir().join("dh-studio-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("trigbad-{}.db", uuid::Uuid::new_v4()));
        let adapter = SqliteAdapter::connect(path).await.unwrap();

        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY)")
            .execute(&adapter.pool)
            .await
            .unwrap();
        let old_sql = "CREATE TRIGGER keep_me AFTER DELETE ON t BEGIN SELECT 1; END";
        sqlx::query(old_sql).execute(&adapter.pool).await.unwrap();

        // The replacement SQL is invalid (missing ON clause) → whole batch
        // must roll back and the original trigger must survive.
        let ops = vec![
            SchemaOp::DropTrigger { name: "keep_me".into() },
            SchemaOp::CreateTrigger { sql: "CREATE TRIGGER broken AFTER ON t BEGIN SELECT 1; END".into() },
        ];
        assert!(adapter.apply_schema_ops_batch(&ops).await.is_err());

        let (schema, _) = adapter.table_schema("t").await.unwrap();
        assert_eq!(schema.triggers.len(), 1, "original trigger must survive");
        assert_eq!(schema.triggers[0].name, "keep_me");
    }
}

// ---- Adapter-trait plumbing -------------------------------------------------
// The inherent methods above stay the single source of truth; the trait
// simply exposes them polymorphically so the registry can hold any engine.
#[async_trait]
impl DbAdapter for SqliteAdapter {
    async fn list_tables(&self) -> DbResult<Vec<TableInfo>> {
        SqliteAdapter::list_tables(self).await
    }
    // SQLite has exactly one implicit schema and one database per connection.
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
    async fn table_schema(&self, table: &str) -> DbResult<(TableSchema, Vec<String>)> {
        SqliteAdapter::table_schema(self, table).await
    }
    async fn run_sql(&self, sql: &str) -> DbResult<QueryResult> {
        SqliteAdapter::run_sql(self, sql).await
    }
    async fn execute_params(&self, sql: &str, params: &[Option<String>]) -> DbResult<u64> {
        SqliteAdapter::execute_params(self, sql, params).await
    }
    async fn run_sql_params(&self, sql: &str, params: &[Option<String>]) -> DbResult<QueryResult> {
        SqliteAdapter::run_sql_params(self, sql, params).await
    }
    async fn execute_op(&self, op: &QueryOp) -> DbResult<super::OpOutcome> {
        SqliteAdapter::execute_op(self, op).await
    }
    async fn execute_op_stream(
        &self,
        op: &QueryOp,
        mut on_batch: BatchSink<'_>,
    ) -> DbResult<super::OpOutcome> {
        SqliteAdapter::execute_op_stream(self, op, &mut on_batch).await
    }
    async fn run_sql_stream(&self, sql: &str, mut on_batch: BatchSink<'_>) -> DbResult<QueryResult> {
        SqliteAdapter::run_sql_stream(self, sql, &mut on_batch).await
    }
    async fn apply_schema_ops_batch(&self, ops: &[SchemaOp]) -> DbResult<Vec<String>> {
        SqliteAdapter::apply_schema_ops_batch(self, ops).await
    }
    async fn duplicate_table(&self, source: &str, target: &str) -> DbResult<Vec<String>> {
        SqliteAdapter::duplicate_table(self, source, target).await
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
        } else {
            self.remove_aux_files();
        }
    }
}
