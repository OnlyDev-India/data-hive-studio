use sqlx::{Connection as _, PgConnection, PgPool};
use std::time::Instant;
use crate::api::QueryResult;
use crate::db::{DbError, DbResult, RunHandle};
use super::rows::{describe_columns, describe_columns_conn, row_to_vec};
use super::sql_text::{dollar_placeholders, q};
use super::cancel::pg_run_error;

/// Run one statement on `conn`, rendering rows as text cells.
pub(super) async fn exec_statement(
    conn: &mut PgConnection,
    trimmed: &str,
    is_select: bool,
    start: Instant,
    run: &RunHandle,
) -> DbResult<QueryResult> {
    if is_select {
        let columns = describe_columns_conn(conn, trimmed).await?;
        let rows = sqlx::query(trimmed)
            .fetch_all(&mut *conn)
            .await
            .map_err(|e| pg_run_error(e, run))?;
        let out: Vec<Vec<Option<String>>> = rows.iter().map(row_to_vec).collect();
        return Ok(QueryResult {
            columns,
            rows: out,
            rows_affected: 0,
            is_select: true,
            error: null_error(),
            elapsed_ms: start.elapsed().as_millis(),
            cancelled: false,
        });
    }
    let res = sqlx::query(trimmed)
        .execute(&mut *conn)
        .await
        .map_err(|e| pg_run_error(e, run))?;
    Ok(QueryResult {
        columns: vec![],
        rows: vec![],
        rows_affected: res.rows_affected(),
        is_select: false,
        error: null_error(),
        elapsed_ms: start.elapsed().as_millis(),
        cancelled: false,
    })
}

/// `exec_statement` inside a transaction whose `search_path` is `schema`
/// (transaction local, so the pooled connection stays clean). A stopped
/// statement never commits: the transaction rolls back with it.
pub(super) async fn run_in_schema_tx(
    conn: &mut PgConnection,
    schema: &str,
    trimmed: &str,
    is_select: bool,
    start: Instant,
    run: &RunHandle,
) -> DbResult<QueryResult> {
    let mut tx = conn.begin().await.map_err(DbError::SqlEngine)?;
    sqlx::query(&format!("SET LOCAL search_path = {}", q(schema)))
        .execute(&mut *tx)
        .await
        .map_err(DbError::SqlEngine)?;
    let result = exec_statement(&mut tx, trimmed, is_select, start, run).await?;
    tx.commit().await.map_err(DbError::SqlEngine)?;
    Ok(result)
}

/// Execute a SELECT whose `?` placeholders are renumbered to `$n`, binding
/// `params` in order, and render every row as text cells.
pub(super) async fn run_sql_prebound(
    pool: &PgPool,
    sql: &str,
    params: Vec<Option<String>>,
) -> DbResult<QueryResult> {
    let start = Instant::now();
    let converted = dollar_placeholders(sql);
    let mut q = sqlx::query(&converted);
    for p in &params {
        q = bind_str(q, p);
    }
    let columns = describe_columns(pool, &converted).await?;
    let rows = q.fetch_all(pool).await.map_err(DbError::SqlEngine)?;
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

pub(super) fn null_error() -> Option<String> {
    None
}

/// Bind one optional string parameter.
pub(super) fn bind_str<'q>(
    q: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    v: &Option<String>,
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    match v {
        Some(x) => q.bind(x.clone()),
        None => q.bind(None::<String>),
    }
}

/// Build a query from SQL whose `?` placeholders are ALREADY renumbered to
/// `$1..$n` (see [`dollar_placeholders`]), binding `params` in order.
pub(super) fn bind_all<'a>(
    sql: &'a str,
    params: &[Option<String>],
) -> sqlx::query::Query<'a, sqlx::Postgres, sqlx::postgres::PgArguments> {
    let mut q = sqlx::query(sql);
    for p in params {
        q = bind_str(q, p);
    }
    q
}
