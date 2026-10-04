//! One side of a table data diff: a read only, key ordered scan.

use futures_util::TryStreamExt;
use sqlx::sqlite::{Sqlite, SqliteArguments, SqliteConnection, SqliteRow, SqliteValueRef};
use sqlx::{Row, TypeInfo, Value, ValueRef};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

use super::interrupt::{run_error, InterruptHandle};
use super::query::cell_to_string;
use super::schema_ops::quote_ident;
use super::SqliteAdapter;
use crate::api::KeyVal;
use crate::db::compare::{parse_ts, CanonVal, Dec};
use crate::db::stream::BATCH_ROWS;
use crate::db::{DbError, DbResult, RunHandle, ScanOut, ScanRow, ScanSpec};

/// How a column's text is compared, from its declared type. Key columns are
/// always plain, so their order stays SQLite's own text order.
#[derive(Clone, Copy, PartialEq)]
enum Class {
    Plain,
    Json,
    Ts,
}

fn class_of(declared: &str) -> Class {
    let d = declared.to_ascii_uppercase();
    if d.contains("JSON") {
        Class::Json
    } else if d.contains("DATE") || d.contains("TIME") {
        Class::Ts
    } else {
        Class::Plain
    }
}

impl SqliteAdapter {
    pub async fn compare_scan(&self, spec: &ScanSpec<'_>, run: &RunHandle, out: &ScanOut) -> DbResult<()> {
        let classes = self.column_classes(spec).await?;
        let sql = scan_sql(spec);
        let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
        // `query_only` is never switched back, so this connection is closed
        // instead of going back to the pool.
        conn.close_on_drop();
        sqlx::query("PRAGMA query_only = ON")
            .execute(&mut *conn)
            .await
            .map_err(DbError::SqlEngine)?;
        let handle = InterruptHandle(conn.lock_handle().await.map_err(DbError::SqlEngine)?.as_raw_handle());
        let armed = run
            .add_canceller(Box::new(move || {
                handle.interrupt();
                Box::pin(std::future::ready(()))
            }))
            .await;
        let Some(id) = armed else { return Err(DbError::Cancelled) };
        let res = read_rows(&mut conn, &sql, spec, &classes, run, out).await;
        run.remove_canceller(id).await;
        res
    }

    async fn column_classes(&self, spec: &ScanSpec<'_>) -> DbResult<Vec<Class>> {
        let declared: Vec<(String, String)> = sqlx::query_as("SELECT name, type FROM pragma_table_xinfo(?)")
            .bind(spec.table)
            .fetch_all(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        Ok(spec
            .key_columns
            .iter()
            .chain(spec.columns)
            .map(|c| {
                declared
                    .iter()
                    .find(|(name, _)| name.eq_ignore_ascii_case(c))
                    .map_or(Class::Plain, |(_, t)| class_of(t))
            })
            .collect())
    }
}

fn scan_sql(spec: &ScanSpec<'_>) -> String {
    let keys: Vec<String> = spec.key_columns.iter().map(|c| quote_ident(c)).collect();
    let cols: Vec<String> = spec.key_columns.iter().chain(spec.columns).map(|c| quote_ident(c)).collect();
    let mut conds = Vec::new();
    if let Some(f) = spec.filter {
        // On its own lines, so a trailing `--` comment ends with the filter.
        conds.push(format!("(\n{f}\n)"));
    }
    if spec.after_key.is_some() {
        let marks = vec!["?"; keys.len()].join(", ");
        conds.push(format!("({}) > ({marks})", keys.join(", ")));
    }
    let mut sql = format!("SELECT {} FROM {}", cols.join(", "), quote_ident(spec.table));
    if !conds.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conds.join(" AND "));
    }
    sql.push_str(" ORDER BY ");
    sql.push_str(&keys.join(", "));
    sql
}

type Query<'q> = sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>>;

fn bind_key<'q>(q: Query<'q>, k: &KeyVal) -> DbResult<Query<'q>> {
    let bad = || DbError::InvalidOperation(format!("the page key {k:?} cannot be read back"));
    Ok(match k {
        KeyVal::Int(s) => q.bind(s.parse::<i64>().map_err(|_| bad())?),
        KeyVal::Num(s) => q.bind(s.parse::<f64>().map_err(|_| bad())?),
        KeyVal::Bytes(s) => q.bind(B64.decode(s).map_err(|_| bad())?),
        KeyVal::Bool(b) => q.bind(i64::from(*b)),
        KeyVal::Text(s) | KeyVal::Ts(s) | KeyVal::Uuid(s) | KeyVal::Oid(s) | KeyVal::Ejson(s) => {
            q.bind(s.clone())
        }
    })
}

async fn read_rows(
    conn: &mut SqliteConnection,
    sql: &str,
    spec: &ScanSpec<'_>,
    classes: &[Class],
    run: &RunHandle,
    out: &ScanOut,
) -> DbResult<()> {
    let mut q = sqlx::query(sql);
    for k in spec.after_key.unwrap_or_default() {
        q = bind_key(q, k)?;
    }
    let key_count = spec.key_columns.len();
    let mut stream = q.fetch(&mut *conn);
    let mut batch = Vec::with_capacity(BATCH_ROWS);
    while let Some(row) = stream.try_next().await.map_err(|e| run_error(e, Some(run)))? {
        batch.push(decode(&row, key_count, classes)?);
        if batch.len() >= BATCH_ROWS && !out.send(std::mem::take(&mut batch)).await {
            return Ok(());
        }
    }
    if !batch.is_empty() {
        out.send(batch).await;
    }
    Ok(())
}

fn decode(row: &SqliteRow, key_count: usize, classes: &[Class]) -> DbResult<ScanRow> {
    let mut scanned = ScanRow {
        key: Vec::with_capacity(key_count),
        vals: Vec::with_capacity(classes.len() - key_count),
        key_display: Vec::with_capacity(key_count),
        display: Vec::with_capacity(classes.len() - key_count),
        literals: None,
    };
    for (i, class) in classes.iter().enumerate() {
        let shown = cell_to_string(row.try_get_raw(i).map_err(DbError::SqlEngine)?);
        let raw = row.try_get_raw(i).map_err(DbError::SqlEngine)?;
        if i < key_count {
            scanned.key.push(canon(raw, Class::Plain));
            scanned.key_display.push(shown.unwrap_or_else(|| "NULL".into()));
        } else {
            scanned.vals.push(canon(raw, *class));
            scanned.display.push(shown);
        }
    }
    Ok(scanned)
}

fn canon(v: SqliteValueRef<'_>, class: Class) -> CanonVal {
    if v.is_null() {
        return CanonVal::Null;
    }
    let storage = v.type_info().name().to_string();
    let owned = v.to_owned();
    match storage.as_str() {
        "INTEGER" => owned
            .try_decode::<i64>()
            .map_or(CanonVal::Null, |i| CanonVal::Num(Dec::from_i64(i))),
        "REAL" => match owned.try_decode::<f64>() {
            Ok(f) => Dec::from_f64(f).map_or_else(|| CanonVal::Other(f.to_string()), CanonVal::Num),
            Err(_) => CanonVal::Null,
        },
        "BLOB" => CanonVal::Bytes(owned.try_decode::<Vec<u8>>().unwrap_or_default()),
        _ => {
            let s = owned.try_decode::<String>().unwrap_or_default();
            match class {
                Class::Json => serde_json::from_str(&s).map_or(CanonVal::Text(s), CanonVal::Json),
                Class::Ts => parse_ts(&s).map_or(CanonVal::Text(s), CanonVal::Ts),
                Class::Plain => CanonVal::Text(s),
            }
        }
    }
}
