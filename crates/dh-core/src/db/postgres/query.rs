use std::time::Instant;
use crate::api::{QueryChunk, QueryOp, QueryResult};
use crate::db::read_only::Dialect;
use crate::db::stream::Collected;
use crate::db::{BatchSink, DbError, DbResult, RunHandle};
use super::PgAdapter;
use super::exec::{bind_str, null_error};
use super::filters::build_select;
use super::rows::{describe_columns, row_to_vec};
use super::sql_text::dollar_placeholders;
use super::stream::stream_statement;

impl PgAdapter {
    /// `run_sql` past the read only check. The session itself is also read
    /// only on a read only connection, so a write the check let through (a
    /// data changing CTE) fails here and the caller turns it into the typed
    /// refusal. Reads the whole result through the same row loop the editor
    /// streams with, into a collecting sink.
    async fn run_sql_locked(&self, database: Option<&str>, schema: Option<&str>, sql: &str) -> DbResult<QueryResult> {
        let mut collected = Collected::default();
        let mut sink = |chunk: QueryChunk| {
            collected.push_chunk(chunk);
            Ok(())
        };
        let result = self.run_sql_cancellable(database, schema, sql, None, &mut sink).await?;
        drop(sink);
        Ok(QueryResult { rows: collected.rows, ..result })
    }

    pub(super) async fn run_sql(&self, database: Option<&str>, schema: Option<&str>, sql: &str) -> DbResult<QueryResult> {
        self.guard.check_sql(Dialect::Postgres, sql)?;
        self.run_sql_locked(database, schema, sql)
            .await
            .map_err(|e| self.guard.refine(e))
    }

    pub(super) async fn execute_params(
        &self,
        database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<u64> {
        // Grid built statements only, so the same statement check as the editor
        // names the keyword it refused (UPDATE, INSERT, DELETE).
        self.guard.check_sql(Dialect::Postgres, sql)?;
        let pool = self.pool_for(database).await?;
        let converted = dollar_placeholders(sql);
        // Bind the parameters — frontend-built statements use $1..$n and are
        // useless (and unsafe) if executed with them unresolved.
        let mut q = sqlx::query(&converted);
        for p in params {
            q = bind_str(q, p);
        }
        let res = q.execute(&pool).await.map_err(DbError::SqlEngine)?;
        Ok(res.rows_affected())
    }

    pub(super) async fn run_sql_params(
        &self,
        database: Option<&str>,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<QueryResult> {
        self.guard.check_sql(Dialect::Postgres, sql)?;
        let pool = self.pool_for(database).await?;
        let start = Instant::now();
        // Frontend-built statements use `?`; renumber to $n and bind.
        let converted = dollar_placeholders(sql);
        let mut q = sqlx::query(&converted);
        for p in params {
            q = bind_str(q, p);
        }
        let columns = describe_columns(&pool, &converted).await?;
        let rows = q.fetch_all(&pool).await.map_err(DbError::SqlEngine)?;
        let out: Vec<Vec<Option<String>>> = rows.iter().map(row_to_vec).collect();
        Ok(QueryResult {
            columns,
            rows: out,
            rows_affected: 0,
            is_select: true,
            error: null_error(),
            elapsed_ms: start.elapsed().as_millis(),
            cancelled: false,
        })
    }

    pub(super) async fn execute_op_stream(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        op: &QueryOp,
        on_batch: BatchSink<'_>,
    ) -> DbResult<super::OpOutcome> {
        self.guard.check_op(op)?;
        // Only SELECT streams; everything else runs normally.
        let QueryOp::Select { table, filters, custom_where, order_by, limit, offset } = op else {
            return self.execute_op(database, schema, op).await
        };
        let pool = self.pool_for(database).await?;
        let schema = schema.map(str::to_string).unwrap_or_else(|| self.cur_schema());
        let start = Instant::now();
        let mut params = Vec::new();
        let sql = dollar_placeholders(&build_select(
            &schema,
            table,
            filters,
            custom_where.as_ref(),
            order_by,
            *limit,
            *offset,
            &mut params,
        ));

        let display = super::inline_placeholders(&sql, &params, true) + ";";
        // The same row loop the editor uses: rows go out as the server sends
        // them, columns come from the first row, and a page with no rows
        // describes the statement once so it still reports real names.
        let mut conn = pool.acquire().await.map_err(DbError::SqlEngine)?;
        let streamed = stream_statement(&mut conn, &sql, &params, None, on_batch).await;
        if streamed.is_err() {
            // Do not hand a half read connection back to the pool.
            drop(conn.detach());
        }
        let columns = streamed?.columns;

        Ok(super::OpOutcome {
            result: QueryResult {
                columns,
                rows: vec![], // caller assembles from chunks
                rows_affected: 0,
                is_select: true,
                error: null_error(),
                elapsed_ms: start.elapsed().as_millis(),
                cancelled: false,
            },
            sql: Some(display),
        })
    }

    pub(super) async fn run_sql_stream(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        sql: &str,
        run: Option<&RunHandle>,
        on_batch: BatchSink<'_>,
    ) -> DbResult<QueryResult> {
        // Before a canceller is armed, so a refused statement never becomes
        // a run Stop could reach.
        self.guard.check_sql(Dialect::Postgres, sql)?;
        self.run_sql_cancellable(database, schema, sql, run, on_batch)
            .await
            .map_err(|e| self.guard.refine(e))
    }
}

/// The read only lock (spec 0007) against a real server. All `#[ignore]`d,
/// same instance as the Stop tests: `cargo test -p dh-core -- --ignored
/// pg_read_only`.
#[cfg(test)]
mod read_only_live_tests {
    use super::*;
    use crate::db::postgres::params::PgParams;

    fn params(read_only: bool) -> PgParams {
        let url = std::env::var("DH_TEST_DATABASE_URL")
            .unwrap_or_else(|_| "postgres://postgres@127.0.0.1:5544/dh_server_test".to_string());
        let rest = url.strip_prefix("postgres://").expect("a postgres:// url");
        let (auth, tail) = rest.split_once('@').expect("user@host in the url");
        let (user, password) = auth.split_once(':').unwrap_or((auth, ""));
        let (hostport, database) = tail.split_once('/').expect("/database in the url");
        let (host, port) = hostport.split_once(':').unwrap_or((hostport, "5432"));
        serde_json::from_value(serde_json::json!({
            "host": host, "port": port.parse::<u16>().unwrap(), "user": user,
            "password": password, "database": database, "ssl_mode": "disable",
            "read_only": read_only,
        }))
        .unwrap()
    }

    fn is_refusal<T>(res: DbResult<T>) -> bool {
        matches!(&res, Err(DbError::ReadOnly(m)) if m.starts_with(super::super::READ_ONLY_PREFIX))
    }

    /// AC-2, AC-3, AC-5, AC-14: reads work, every kind of write is refused
    /// with the typed error, and the row is still there afterwards.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_read_only_refuses_writes_and_keeps_reads() {
        let rw = PgAdapter::connect(&params(false)).await.unwrap();
        let ro = PgAdapter::connect(&params(true)).await.unwrap();
        let table = format!("dh_ro_{}", uuid::Uuid::new_v4().simple());
        rw.run_sql(None, None, &format!("CREATE TABLE {table} (id int primary key, v text)"))
            .await
            .unwrap();
        rw.run_sql(None, None, &format!("INSERT INTO {table} VALUES (1, 'a')")).await.unwrap();

        // Reads still work.
        let read = ro.run_sql(None, None, &format!("SELECT v FROM {table}")).await.unwrap();
        assert_eq!(read.rows, vec![vec![Some("a".to_string())]]);
        ro.run_sql(None, None, &format!("EXPLAIN SELECT * FROM {table}")).await.unwrap();

        // The check refuses a hand typed write, and a whole script.
        assert!(is_refusal(ro.run_sql(None, None, &format!("UPDATE {table} SET v = 'b'")).await));
        assert!(is_refusal(
            ro.run_sql(None, None, &format!("SELECT 1; DELETE FROM {table}")).await
        ));

        // Statements that could switch the lock off are refused by the check.
        for sql in [
            "SET default_transaction_read_only = off",
            "SELECT set_config('default_transaction_read_only', 'off', false)",
            "BEGIN READ WRITE",
        ] {
            assert!(is_refusal(ro.run_sql(None, None, sql).await), "{sql}");
        }

        // A write the check lets through (starts with WITH) is refused by the
        // session lock, and comes back as the typed error too.
        let cte = format!("WITH d AS (DELETE FROM {table} RETURNING *) SELECT * FROM d");
        assert!(is_refusal(ro.run_sql(None, None, &cte).await));

        // Structured writes are refused before they reach the database.
        let delete = QueryOp::Delete {
            table: table.clone(),
            match_row: [("id".to_string(), Some("1".to_string()))].into(),
        };
        assert!(is_refusal(ro.execute_op(None, None, &delete).await));
        assert!(is_refusal(ro.execute_op(None, None, &QueryOp::DropTable { table: table.clone() }).await));
        assert!(is_refusal(ro.execute_params(None, &format!("DELETE FROM {table}"), &[]).await));
        assert!(is_refusal(ro.duplicate_table(None, None, &table, "dh_ro_copy", true).await));
        assert!(is_refusal(ro.create_schema("dh_ro_schema").await));
        assert!(is_refusal(ro.drop_schema("dh_ro_schema", false).await));
        assert!(is_refusal(ro.create_database("dh_ro_db").await));
        assert!(is_refusal(ro.drop_database("dh_ro_db").await));
        assert!(is_refusal(ro.refresh_matview(None, None, "dh_ro_mv").await));

        // Nothing changed.
        let left = rw.run_sql(None, None, &format!("SELECT count(*) FROM {table}")).await.unwrap();
        assert_eq!(left.rows, vec![vec![Some("1".to_string())]]);
        rw.run_sql(None, None, &format!("DROP TABLE {table}")).await.unwrap();
    }

    /// AC-3: a pooled session on a read only connection starts with new
    /// transactions read only, whatever the SQL check says.
    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_read_only_sessions_start_read_only() {
        let ro = PgAdapter::connect(&params(true)).await.unwrap();
        let on = ro.run_sql(None, None, "SHOW default_transaction_read_only").await.unwrap();
        assert_eq!(on.rows, vec![vec![Some("on".to_string())]]);
        let rw = PgAdapter::connect(&params(false)).await.unwrap();
        let off = rw.run_sql(None, None, "SHOW default_transaction_read_only").await.unwrap();
        assert_eq!(off.rows, vec![vec![Some("off".to_string())]]);
    }
}
