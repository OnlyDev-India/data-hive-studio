//! One side of a table data diff: a key ordered scan in a read only,
//! repeatable read transaction, so the side is one consistent snapshot.

use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use futures_util::TryStreamExt;
use sqlx::postgres::{PgArguments, PgRow};
use sqlx::{PgConnection, Postgres, Row as _};

use super::cancel::{conn_reusable, pg_canceller, pg_run_error, RunConn};
use super::rows::row_to_vec;
use super::sql_text::q;
use super::PgAdapter;
use crate::api::KeyVal;
use crate::db::compare::{instant, CanonVal, Dec};
use crate::db::stream::BATCH_ROWS;
use crate::db::{DbError, DbResult, RunHandle, ScanOut, ScanRow, ScanSpec};

/// How a column is read and compared, from its (domain resolved) base type.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Kind {
    Int,
    Float,
    /// Read as text, so values past `rust_decimal`'s range stay exact.
    Numeric,
    Bool,
    Uuid,
    Bytes,
    Ts,
    TsNaive,
    Date,
    Json,
    /// Strings and anything else (enums, arrays, intervals, …): read as
    /// text, and ordered as a key by that text's bytes (`COLLATE "C"`).
    Text,
}

fn kind_of(base: &str) -> Kind {
    match base {
        "int2" | "int4" | "int8" => Kind::Int,
        "float4" | "float8" => Kind::Float,
        "numeric" => Kind::Numeric,
        "bool" => Kind::Bool,
        "uuid" => Kind::Uuid,
        "bytea" => Kind::Bytes,
        "timestamptz" => Kind::Ts,
        "timestamp" => Kind::TsNaive,
        "date" => Kind::Date,
        "json" | "jsonb" => Kind::Json,
        _ => Kind::Text,
    }
}

struct Col {
    name: String,
    kind: Kind,
    /// The base type as `format_type` spells it, for casts.
    base_type: String,
}

impl Col {
    fn select_expr(&self) -> String {
        match self.kind {
            Kind::Numeric | Kind::Text => format!("{}::text", q(&self.name)),
            // A domain reads back under its own name: cast it to the base.
            _ => format!("CAST({} AS {})", q(&self.name), self.base_type),
        }
    }

    /// The key expression both the ORDER BY and the resume check use.
    fn key_expr(&self) -> String {
        match self.kind {
            Kind::Text => format!("{}::text COLLATE \"C\"", q(&self.name)),
            _ => q(&self.name),
        }
    }

    fn key_param(&self, n: usize) -> String {
        match self.kind {
            Kind::Bytes => format!("decode(${n}, 'base64')"),
            Kind::Text => format!("${n}::text"),
            _ => format!("CAST(${n} AS {})", self.base_type),
        }
    }
}

impl PgAdapter {
    pub(super) async fn compare_scan(&self, spec: &ScanSpec<'_>, run: &RunHandle, out: &ScanOut) -> DbResult<()> {
        let pool = self.pool_for(spec.database).await?;
        let schema = spec.schema.map(str::to_string).unwrap_or_else(|| self.cur_schema());
        let mut conn = RunConn::acquire(&pool).await?;
        let cols = scan_columns(&mut conn, &schema, spec).await?;
        let sql = scan_sql(&schema, spec, &cols);

        let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *conn)
            .await
            .map_err(DbError::SqlEngine)?;
        let options = self.connect_options_for(self.resolve_database(spec.database));
        let Some(id) = run.add_canceller(pg_canceller(options, pid)).await else {
            conn.release(true);
            return Err(DbError::Cancelled);
        };
        let res = scan_in_tx(&mut conn, &schema, &sql, spec, &cols, run, out).await;
        run.remove_canceller(id).await;

        // A scan the merge no longer needs still has rows in flight, and any
        // other ending leaves the transaction open: close it, or detach.
        let reusable = match &res {
            Ok(true) => false,
            other => {
                conn_reusable(other)
                    && sqlx::query("ROLLBACK").execute(&mut *conn).await.is_ok()
            }
        };
        conn.release(reusable);
        res.map(|_| ())
    }
}

/// The key and compared columns, in scan order, with how each is read.
async fn scan_columns(conn: &mut PgConnection, schema: &str, spec: &ScanSpec<'_>) -> DbResult<Vec<Col>> {
    let found: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT a.attname::text, b.typname::text, format_type(b.oid, \
                CASE WHEN t.typtype = 'd' THEN t.typtypmod ELSE a.atttypmod END) \
         FROM pg_attribute a \
         JOIN pg_type t ON t.oid = a.atttypid \
         JOIN pg_type b ON b.oid = CASE WHEN t.typtype = 'd' THEN t.typbasetype ELSE t.oid END \
         WHERE a.attrelid = (quote_ident($1) || '.' || quote_ident($2))::regclass \
           AND a.attnum > 0 AND NOT a.attisdropped",
    )
    .bind(schema)
    .bind(spec.table)
    .fetch_all(&mut *conn)
    .await
    .map_err(DbError::SqlEngine)?;
    spec.key_columns
        .iter()
        .chain(spec.columns)
        .map(|name| {
            let (_, base, base_type) = found
                .iter()
                .find(|(n, ..)| n == name)
                .ok_or_else(|| DbError::InvalidOperation(format!("column \"{name}\" is not on {}", spec.table)))?;
            Ok(Col { name: name.clone(), kind: kind_of(base), base_type: base_type.clone() })
        })
        .collect()
}

fn scan_sql(schema: &str, spec: &ScanSpec<'_>, cols: &[Col]) -> String {
    let keys = &cols[..spec.key_columns.len()];
    let key_exprs: Vec<String> = keys.iter().map(Col::key_expr).collect();
    let select: Vec<String> = cols.iter().map(Col::select_expr).collect();
    let mut conds = Vec::new();
    if let Some(f) = spec.filter {
        // On its own lines, so a trailing `--` comment ends with the filter.
        conds.push(format!("(\n{f}\n)"));
    }
    if spec.after_key.is_some() {
        let params: Vec<String> = keys.iter().enumerate().map(|(i, c)| c.key_param(i + 1)).collect();
        conds.push(format!("({}) > ({})", key_exprs.join(", "), params.join(", ")));
    }
    let mut sql = format!("SELECT {} FROM {}.{}", select.join(", "), q(schema), q(spec.table));
    if !conds.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conds.join(" AND "));
    }
    sql.push_str(" ORDER BY ");
    sql.push_str(&key_exprs.join(", "));
    sql
}

fn key_text(k: &KeyVal) -> String {
    match k {
        KeyVal::Bool(b) => b.to_string(),
        KeyVal::Int(s)
        | KeyVal::Num(s)
        | KeyVal::Text(s)
        | KeyVal::Bytes(s)
        | KeyVal::Ts(s)
        | KeyVal::Uuid(s)
        | KeyVal::Oid(s)
        | KeyVal::Ejson(s) => s.clone(),
    }
}

/// Runs the scan inside its transaction. `Ok(true)` means the merge stopped
/// wanting rows before the scan reached the end.
async fn scan_in_tx(
    conn: &mut PgConnection,
    schema: &str,
    sql: &str,
    spec: &ScanSpec<'_>,
    cols: &[Col],
    run: &RunHandle,
    out: &ScanOut,
) -> DbResult<bool> {
    sqlx::query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
        .execute(&mut *conn)
        .await
        .map_err(DbError::SqlEngine)?;
    // Unqualified names in the filter resolve in this side's schema.
    sqlx::query("SELECT set_config('search_path', $1, true)")
        .bind(q(schema))
        .execute(&mut *conn)
        .await
        .map_err(DbError::SqlEngine)?;

    let mut query: sqlx::query::Query<'_, Postgres, PgArguments> = sqlx::query(sql);
    for k in spec.after_key.unwrap_or_default() {
        query = query.bind(key_text(k));
    }
    let key_count = spec.key_columns.len();
    let mut stream = query.fetch(&mut *conn);
    let mut batch = Vec::with_capacity(BATCH_ROWS);
    while let Some(row) = stream.try_next().await.map_err(|e| pg_run_error(e, run))? {
        batch.push(decode(&row, key_count, cols));
        if batch.len() >= BATCH_ROWS && !out.send(std::mem::take(&mut batch)).await {
            return Ok(true);
        }
    }
    if !batch.is_empty() {
        out.send(batch).await;
    }
    Ok(false)
}

fn decode(row: &PgRow, key_count: usize, cols: &[Col]) -> ScanRow {
    let shown = row_to_vec(row);
    let mut scanned = ScanRow {
        key: Vec::with_capacity(key_count),
        vals: Vec::with_capacity(cols.len() - key_count),
        key_display: Vec::with_capacity(key_count),
        display: Vec::with_capacity(cols.len() - key_count),
        literals: None,
    };
    for (i, (col, text)) in cols.iter().zip(shown).enumerate() {
        let v = canon(row, i, col.kind);
        if i < key_count {
            scanned.key.push(v);
            scanned.key_display.push(text.unwrap_or_else(|| "NULL".into()));
        } else {
            scanned.vals.push(v);
            scanned.display.push(text);
        }
    }
    scanned
}

fn get<'r, T: sqlx::Decode<'r, Postgres> + sqlx::Type<Postgres>>(row: &'r PgRow, i: usize) -> Option<T> {
    row.try_get::<Option<T>, _>(i).ok().flatten()
}

fn canon(row: &PgRow, i: usize, kind: Kind) -> CanonVal {
    let v = match kind {
        Kind::Int => get::<i64>(row, i)
            .or_else(|| get::<i32>(row, i).map(i64::from))
            .or_else(|| get::<i16>(row, i).map(i64::from))
            .map(|n| CanonVal::Num(Dec::from_i64(n))),
        Kind::Float => get::<f64>(row, i)
            .or_else(|| get::<f32>(row, i).map(f64::from))
            .map(|f| Dec::from_f64(f).map_or_else(|| CanonVal::Other(f.to_string()), CanonVal::Num)),
        Kind::Numeric => get::<String>(row, i).map(|s| Dec::parse(&s).map_or(CanonVal::Other(s), CanonVal::Num)),
        Kind::Bool => get::<bool>(row, i).map(CanonVal::Bool),
        Kind::Uuid => get::<uuid::Uuid>(row, i).map(|u| CanonVal::Uuid(*u.as_bytes())),
        Kind::Bytes => get::<Vec<u8>>(row, i).map(CanonVal::Bytes),
        Kind::Ts => get::<DateTime<Utc>>(row, i).map(|t| CanonVal::Ts(instant(t))),
        Kind::TsNaive => get::<NaiveDateTime>(row, i).map(|t| CanonVal::Ts(instant(t.and_utc()))),
        Kind::Date => get::<NaiveDate>(row, i)
            .and_then(|d| d.and_hms_opt(0, 0, 0))
            .map(|t| CanonVal::Ts(instant(t.and_utc()))),
        Kind::Json => get::<serde_json::Value>(row, i).map(CanonVal::Json),
        Kind::Text => get::<String>(row, i).map(CanonVal::Text),
    };
    v.unwrap_or(CanonVal::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn col(name: &str, kind: Kind, base_type: &str) -> Col {
        Col { name: name.into(), kind, base_type: base_type.into() }
    }

    fn spec<'a>(keys: &'a [String], cols: &'a [String], filter: Option<&'a str>, after: Option<&'a [KeyVal]>) -> ScanSpec<'a> {
        ScanSpec {
            database: None,
            schema: None,
            table: "t",
            key_columns: keys,
            columns: cols,
            filter,
            after_key: after,
            literals: false,
        }
    }

    #[test]
    fn kinds_follow_the_base_type() {
        assert_eq!(kind_of("int8"), Kind::Int);
        assert_eq!(kind_of("numeric"), Kind::Numeric);
        assert_eq!(kind_of("varchar"), Kind::Text);
        assert_eq!(kind_of("mood"), Kind::Text);
        assert_eq!(kind_of("timestamptz"), Kind::Ts);
    }

    #[test]
    fn text_keys_order_bytewise_and_resume_after_the_last_key() {
        let keys = vec!["name".to_string(), "id".to_string()];
        let cols = vec!["price".to_string()];
        let described = [
            col("name", Kind::Text, "text"),
            col("id", Kind::Int, "integer"),
            col("price", Kind::Numeric, "numeric(10,2)"),
        ];
        let after = [KeyVal::Text("b".into()), KeyVal::Int("7".into())];
        let sql = scan_sql("public", &spec(&keys, &cols, Some("price > 1"), Some(&after)), &described);
        assert_eq!(
            sql,
            "SELECT \"name\"::text, CAST(\"id\" AS integer), \"price\"::text FROM \"public\".\"t\" \
             WHERE (\nprice > 1\n) AND (\"name\"::text COLLATE \"C\", \"id\") > ($1::text, CAST($2 AS integer)) \
             ORDER BY \"name\"::text COLLATE \"C\", \"id\""
        );
    }

    #[test]
    fn enum_and_binary_keys_compare_as_text_and_bytes() {
        let keys = vec!["mood".to_string(), "blob".to_string()];
        let described = [col("mood", Kind::Text, "mood"), col("blob", Kind::Bytes, "bytea")];
        let after = [KeyVal::Text("ok".into()), KeyVal::Bytes("AQI=".into())];
        let sql = scan_sql("s", &spec(&keys, &[], None, Some(&after)), &described);
        assert!(sql.contains("(\"mood\"::text COLLATE \"C\", \"blob\") > ($1::text, decode($2, 'base64'))"), "{sql}");
        assert!(sql.ends_with("ORDER BY \"mood\"::text COLLATE \"C\", \"blob\""), "{sql}");
    }
}

#[cfg(test)]
mod live_tests {
    use crate::api::{CompareChunk, CompareDataRequest, DiffKind, DiffRow, TableRef};
    use crate::db::postgres::query::read_only_live_tests::params;
    use crate::db::{compare_data_on, PgAdapter, DIFF_PAGE_SIZE};

    fn side(table: &str) -> TableRef {
        TableRef {
            conn_id: "c".into(),
            conn_key: String::new(),
            database: None,
            schema: Some("dh_cmp".into()),
            table: table.into(),
        }
    }

    fn req(cols: &[&str], filter: Option<&str>) -> CompareDataRequest {
        CompareDataRequest {
            left: side("l"),
            right: side("r"),
            key_columns: vec!["k".into()],
            columns: cols.iter().map(|s| s.to_string()).collect(),
            filter: filter.map(str::to_string),
            after_key: None,
            count_all: true,
            page_size: DIFF_PAGE_SIZE,
            run_id: uuid::Uuid::new_v4().to_string(),
        }
    }

    async fn rows(a: &PgAdapter, req: &CompareDataRequest) -> (crate::api::CompareSummary, Vec<DiffRow>) {
        let mut found = Vec::new();
        let mut sink = |c: CompareChunk| {
            if let CompareChunk::Rows { rows } = c {
                found.extend(rows);
            }
            Ok(())
        };
        let s = compare_data_on(a, a, "pg-cmp-test", req, &mut sink).await.unwrap();
        (s, found)
    }

    #[tokio::test]
    #[ignore = "requires a live Postgres test database, see server::store::test_pg_url"]
    async fn pg_diff_orders_text_keys_bytewise_and_compares_by_type() {
        let a = PgAdapter::connect(&params(false)).await.unwrap();
        for sql in [
            "DROP SCHEMA IF EXISTS dh_cmp CASCADE",
            "CREATE SCHEMA dh_cmp",
            "CREATE TABLE dh_cmp.l (k text PRIMARY KEY, n integer, t timestamptz, j jsonb, s text)",
            "CREATE TABLE dh_cmp.r (k varchar(10) PRIMARY KEY, n numeric(8,2), t timestamptz, j jsonb, s text)",
            "INSERT INTO dh_cmp.l VALUES \
               ('B', 1, '2024-03-01 10:00+02', '{\"a\":1,\"b\":2}', 'x'), \
               ('a', 2, '2024-03-01 08:00+00', '[1,2]', 'a'), \
               ('é', 3, NULL, NULL, 'y')",
            "INSERT INTO dh_cmp.r VALUES \
               ('B', 1.00, '2024-03-01 08:00+00', '{\"b\":2,\"a\":1}', 'x'), \
               ('a', 2.5, '2024-03-01 08:00+00', '[2,1]', 'a '), \
               ('z', 4, NULL, NULL, NULL)",
        ] {
            a.run_sql(None, None, sql).await.unwrap();
        }

        let (s, found) = rows(&a, &req(&["n", "t", "j", "s"], None)).await;
        let c = s.counts;
        assert_eq!((c.identical, c.changed, c.left_only, c.right_only), (1, 1, 1, 1));
        let got: Vec<_> = found.iter().map(|r| (r.kind, r.key_display[0].clone())).collect();
        // "C" order: 'a' after 'B', 'é' (0xC3) after 'z'.
        assert_eq!(
            got,
            vec![
                (DiffKind::Changed, "a".into()),
                (DiffKind::RightOnly, "z".into()),
                (DiffKind::LeftOnly, "é".into()),
            ]
        );
        assert_eq!(found[0].changed, Some(vec![0, 2, 3]));

        let (s, found) = rows(&a, &req(&["s"], Some("k <> 'a' -- trailing comment"))).await;
        assert_eq!((s.counts.identical, s.counts.left_only, s.counts.right_only), (1, 1, 1));
        assert!(found.iter().all(|r| r.key_display[0] != "a"));

        let mut bad = req(&["s"], Some("no_such_column = 1"));
        bad.run_id = uuid::Uuid::new_v4().to_string();
        let mut sink = |_: CompareChunk| Ok(());
        let err = compare_data_on(&a, &a, "pg-cmp-test", &bad, &mut sink).await.unwrap_err();
        assert!(err.to_string().contains("side"), "{err}");

        let mut write = req(&["s"], Some("1 = 1; DELETE FROM dh_cmp.l"));
        write.run_id = uuid::Uuid::new_v4().to_string();
        assert!(compare_data_on(&a, &a, "pg-cmp-test", &write, &mut sink).await.is_err());
        a.run_sql(None, None, "DROP SCHEMA dh_cmp CASCADE").await.unwrap();
    }
}
