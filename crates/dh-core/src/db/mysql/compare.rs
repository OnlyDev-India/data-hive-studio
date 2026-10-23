//! One side of a table data diff on MySQL and MariaDB (spec 0025 AC-24): a
//! key ordered scan in a read only, consistent snapshot transaction. Key
//! order is binary on the server, so the merge walk agrees with it even on
//! case insensitive collations. Values render as the grid shows them, bytes
//! versus text by the catalog side of the binary column rule.

use futures_util::TryStreamExt;
use sqlx::mysql::MySqlRow;
use sqlx::{Executor as _, MySqlConnection, Row as _};
use crate::api::KeyVal;
use crate::db::compare::{parse_ts, CanonVal, Dec};
use crate::db::stream::BATCH_ROWS;
use crate::db::{DbError, DbResult, RunHandle, ScanOut, ScanRow, ScanSpec};
use super::MySqlAdapter;
use super::bytes::{bit_number, BYTES_TYPES};
use super::cancel::{conn_reusable, connection_id, kill_query, run_error, RunConn};
use super::catalog::col;
use super::connect::Flavor;
use super::rows::{fetch_text_conn, row_to_vec, Wire};
use super::sql_text::q;

/// How a column is read, ordered and compared.
#[derive(Debug, Clone, PartialEq)]
enum Kind {
    Int,
    /// `DECIMAL(p,s)`, kept so a resume key casts to the column's own type.
    Numeric(u32, u32),
    Float,
    /// `BIT`: shown as `b'...'`, compared as the number it spells.
    Bit,
    Bytes,
    /// `DATE` (false) or `DATETIME`/`TIMESTAMP` (true).
    Ts(bool),
    /// MySQL `JSON`, or a MariaDB `LONGTEXT` with its `json_valid` check.
    Json,
    /// Everything else: compared as text, ordered by its UTF-8 bytes.
    Text,
}

fn kind_of(data_type: &str, precision: &str, scale: &str) -> Kind {
    match data_type {
        "tinyint" | "smallint" | "mediumint" | "int" | "integer" | "bigint" | "year" => Kind::Int,
        "decimal" | "numeric" => Kind::Numeric(precision.parse().unwrap_or(65), scale.parse().unwrap_or(30)),
        "float" | "double" | "real" => Kind::Float,
        "bit" => Kind::Bit,
        "date" => Kind::Ts(false),
        "datetime" | "timestamp" => Kind::Ts(true),
        "json" => Kind::Json,
        t if BYTES_TYPES.contains(&t) => Kind::Bytes,
        _ => Kind::Text,
    }
}

struct Col {
    name: String,
    kind: Kind,
}

/// Text as its UTF-8 bytes, so the server orders it the way Rust compares
/// it: no collation, no trailing space padding (`utf8mb4_bin` pads).
fn utf8_bytes(expr: &str) -> String {
    format!("CAST(CONVERT({expr} USING utf8mb4) AS BINARY)")
}

impl Col {
    /// The key expression both the ORDER BY and the resume check use.
    fn key_expr(&self) -> String {
        match self.kind {
            Kind::Text | Kind::Json => utf8_bytes(&q(&self.name)),
            _ => q(&self.name),
        }
    }

    /// The resume placeholder, cast so the comparison is exact (a string
    /// against a number would compare as a double).
    fn key_param(&self) -> String {
        match self.kind {
            Kind::Int => "CAST(? AS DECIMAL(65,0))".into(),
            Kind::Numeric(p, s) => format!("CAST(? AS DECIMAL({p},{s}))"),
            Kind::Float => "(? + 0e0)".into(),
            Kind::Bit => "CAST(? AS UNSIGNED)".into(),
            Kind::Bytes => "FROM_BASE64(?)".into(),
            Kind::Ts(false) => "CAST(? AS DATE)".into(),
            Kind::Ts(true) => "CAST(? AS DATETIME(6))".into(),
            Kind::Text | Kind::Json => utf8_bytes("?"),
        }
    }
}

impl MySqlAdapter {
    pub(super) async fn compare_scan(&self, spec: &ScanSpec<'_>, run: &RunHandle, out: &ScanOut) -> DbResult<()> {
        let db = self.require_target(spec.database)?;
        let mut conn = RunConn::acquire(&self.pool).await?;
        // Unqualified names in the filter resolve in this side's database.
        (&mut *conn).execute(format!("USE {}", q(db)).as_str()).await.map_err(DbError::SqlEngine)?;
        let cols = scan_columns(&mut conn, spec, self.server.flavor).await?;
        let sql = scan_sql(spec, &cols);

        let id = connection_id(&mut conn).await?;
        let Some(cid) = run.add_canceller(kill_query(self.one_off_options(), id)).await else {
            conn.release(true);
            return Err(DbError::Cancelled);
        };
        let res = scan_in_tx(&mut conn, &sql, spec, &cols, run, out).await;
        run.remove_canceller(cid).await;

        // A scan the merge no longer needs still has rows in flight, and any
        // other ending leaves the transaction open: close it, or detach.
        let reusable = match &res {
            Ok(true) => false,
            other => conn_reusable(other) && (&mut *conn).execute("ROLLBACK").await.is_ok(),
        };
        conn.release(reusable);
        res.map(|_| ())
    }
}

/// The key and compared columns, in scan order, with how each is read. On
/// MariaDB a `JSON` column is a `LONGTEXT` the server checks with
/// `json_valid`, so those checks mark it as JSON.
async fn scan_columns(conn: &mut MySqlConnection, spec: &ScanSpec<'_>, flavor: Flavor) -> DbResult<Vec<Col>> {
    let found = fetch_text_conn(
        conn,
        "SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
        &[spec.table],
    )
    .await?;
    let json_checked = match flavor {
        Flavor::Mariadb => mariadb_json_columns(conn, spec.table).await,
        Flavor::Mysql => Vec::new(),
    };
    let key_count = spec.key_columns.len();
    spec.key_columns
        .iter()
        .chain(spec.columns)
        .enumerate()
        .map(|(i, name)| {
            let row = found
                .iter()
                .find(|r| col(r, 0).eq_ignore_ascii_case(name))
                .ok_or_else(|| DbError::InvalidOperation(format!("column `{name}` is not on {}", spec.table)))?;
            let mut kind = kind_of(&col(row, 1).to_ascii_lowercase(), &col(row, 2), &col(row, 3));
            if kind == Kind::Text && json_checked.iter().any(|c| c.eq_ignore_ascii_case(name)) {
                kind = Kind::Json;
            }
            // A JSON key orders by its text, so it compares as text too.
            if i < key_count && kind == Kind::Json {
                kind = Kind::Text;
            }
            Ok(Col { name: name.clone(), kind })
        })
        .collect()
}

/// MariaDB columns declared `JSON`: their `json_valid(`col`)` checks. A
/// failed lookup just leaves them as text.
async fn mariadb_json_columns(conn: &mut MySqlConnection, table: &str) -> Vec<String> {
    let sql = "SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS \
               WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ?";
    match fetch_text_conn(conn, sql, &[table]).await {
        Ok(rows) => rows.iter().filter_map(|r| json_valid_column(&col(r, 0))).collect(),
        Err(e) => {
            log::warn!("mariadb json check lookup failed: {e}");
            Vec::new()
        }
    }
}

/// `json_valid(`name`)` gives `name`.
fn json_valid_column(clause: &str) -> Option<String> {
    let inner = clause.trim().strip_prefix("json_valid(`")?.strip_suffix("`)")?;
    (!inner.contains('`') || inner.contains("``")).then(|| inner.replace("``", "`"))
}

fn scan_sql(spec: &ScanSpec<'_>, cols: &[Col]) -> String {
    let keys = &cols[..spec.key_columns.len()];
    let key_exprs: Vec<String> = keys.iter().map(Col::key_expr).collect();
    let select: Vec<String> = cols.iter().map(|c| q(&c.name)).collect();
    let mut conds = Vec::new();
    if let Some(f) = spec.filter {
        // On its own lines, so a trailing `--` or `#` comment ends with it.
        conds.push(format!("(\n{f}\n)"));
    }
    if spec.after_key.is_some() {
        let params: Vec<String> = keys.iter().map(Col::key_param).collect();
        conds.push(format!("({}) > ({})", key_exprs.join(", "), params.join(", ")));
    }
    let mut sql = format!("SELECT {} FROM {}", select.join(", "), q(spec.table));
    if !conds.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conds.join(" AND "));
    }
    sql.push_str(" ORDER BY ");
    sql.push_str(&key_exprs.join(", "));
    sql
}

/// The text a resume key binds as, for [`Col::key_param`]'s cast.
fn key_text(k: &KeyVal, kind: &Kind) -> String {
    match k {
        KeyVal::Bool(b) => if *b { "1" } else { "0" }.into(),
        KeyVal::Ts(s) if matches!(kind, Kind::Ts(_)) => parse_ts(s)
            .and_then(|n| {
                let secs = n.div_euclid(1_000_000_000) as i64;
                let sub = n.rem_euclid(1_000_000_000) as u32;
                chrono::DateTime::from_timestamp(secs, sub)
            })
            .map(|t| t.naive_utc().format("%Y-%m-%d %H:%M:%S%.6f").to_string())
            .unwrap_or_else(|| s.clone()),
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
    conn: &mut MySqlConnection,
    sql: &str,
    spec: &ScanSpec<'_>,
    cols: &[Col],
    run: &RunHandle,
    out: &ScanOut,
) -> DbResult<bool> {
    (&mut *conn).execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ").await.map_err(DbError::SqlEngine)?;
    (&mut *conn)
        .execute("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY")
        .await
        .map_err(DbError::SqlEngine)?;

    // Always prepared, even with no resume key, so a filter can never carry
    // a second statement.
    let mut query = sqlx::query(sql);
    for (k, c) in spec.after_key.unwrap_or_default().iter().zip(cols) {
        query = query.bind(key_text(k, &c.kind));
    }
    let mask: Vec<Option<bool>> = cols.iter().map(|c| Some(c.kind == Kind::Bytes)).collect();
    let key_count = spec.key_columns.len();
    let mut stream = query.fetch(&mut *conn);
    let mut batch = Vec::with_capacity(BATCH_ROWS);
    while let Some(row) = stream.try_next().await.map_err(|e| run_error(e, Some(run)))? {
        batch.push(decode(&row, key_count, cols, &mask));
        if batch.len() >= BATCH_ROWS && !out.send(std::mem::take(&mut batch)).await {
            return Ok(true);
        }
    }
    if !batch.is_empty() {
        out.send(batch).await;
    }
    Ok(false)
}

fn decode(row: &MySqlRow, key_count: usize, cols: &[Col], mask: &[Option<bool>]) -> ScanRow {
    let shown = row_to_vec(row, Wire::Binary, mask);
    let mut scanned = ScanRow {
        key: Vec::with_capacity(key_count),
        vals: Vec::with_capacity(cols.len() - key_count),
        key_display: Vec::with_capacity(key_count),
        display: Vec::with_capacity(cols.len() - key_count),
        literals: None,
    };
    for (i, (c, text)) in cols.iter().zip(shown).enumerate() {
        let v = match (&c.kind, &text) {
            (_, None) => CanonVal::Null,
            (Kind::Bytes, Some(_)) => row
                .try_get_unchecked::<&[u8], _>(i)
                .map_or(CanonVal::Null, |b| CanonVal::Bytes(b.to_vec())),
            (kind, Some(t)) => canon(kind, t),
        };
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

/// A shown value as a canonical one. A value with no canonical form (a zero
/// date, text that isn't JSON) compares as its text.
fn canon(kind: &Kind, text: &str) -> CanonVal {
    let num = |s: &str| Dec::parse(s).map_or_else(|| CanonVal::Other(s.to_string()), CanonVal::Num);
    match kind {
        Kind::Int | Kind::Numeric(..) | Kind::Float => num(text),
        Kind::Bit => bit_number(text).map_or_else(|| CanonVal::Other(text.into()), |n| num(&n.to_string())),
        Kind::Ts(_) => parse_ts(text).map_or_else(|| CanonVal::Other(text.into()), CanonVal::Ts),
        Kind::Json => serde_json::from_str(text).map_or_else(|_| CanonVal::Text(text.into()), CanonVal::Json),
        Kind::Bytes | Kind::Text => CanonVal::Text(text.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(name: &str, kind: Kind) -> Col {
        Col { name: name.into(), kind }
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
    fn kinds_follow_the_data_type() {
        assert_eq!(kind_of("bigint", "20", "0"), Kind::Int);
        assert_eq!(kind_of("decimal", "65", "30"), Kind::Numeric(65, 30));
        assert_eq!(kind_of("varbinary", "", ""), Kind::Bytes);
        assert_eq!(kind_of("point", "", ""), Kind::Bytes);
        assert_eq!(kind_of("timestamp", "", ""), Kind::Ts(true));
        assert_eq!(kind_of("enum", "", ""), Kind::Text);
        assert_eq!(kind_of("longtext", "", ""), Kind::Text);
    }

    #[test]
    fn text_keys_order_by_their_utf8_bytes_and_resume_with_exact_casts() {
        let keys = vec!["name".to_string(), "id".to_string()];
        let cols = vec!["price".to_string()];
        let described = [c("name", Kind::Text), c("id", Kind::Int), c("price", Kind::Numeric(10, 2))];
        let after = [KeyVal::Text("b".into()), KeyVal::Int("18446744073709551615".into())];
        let sql = scan_sql(&spec(&keys, &cols, Some("price > 1 # note"), Some(&after)), &described);
        assert_eq!(
            sql,
            "SELECT `name`, `id`, `price` FROM `t` \
             WHERE (\nprice > 1 # note\n) AND (CAST(CONVERT(`name` USING utf8mb4) AS BINARY), `id`) > \
             (CAST(CONVERT(? USING utf8mb4) AS BINARY), CAST(? AS DECIMAL(65,0))) \
             ORDER BY CAST(CONVERT(`name` USING utf8mb4) AS BINARY), `id`"
        );
    }

    #[test]
    fn every_key_kind_resumes_through_its_own_cast() {
        let kinds = [
            (Kind::Numeric(12, 4), "CAST(? AS DECIMAL(12,4))"),
            (Kind::Float, "(? + 0e0)"),
            (Kind::Bit, "CAST(? AS UNSIGNED)"),
            (Kind::Bytes, "FROM_BASE64(?)"),
            (Kind::Ts(false), "CAST(? AS DATE)"),
            (Kind::Ts(true), "CAST(? AS DATETIME(6))"),
        ];
        for (kind, param) in kinds {
            assert_eq!(c("k", kind).key_param(), param);
        }
        let ts = key_text(&KeyVal::Ts("2024-03-01T08:00:00.5Z".into()), &Kind::Ts(true));
        assert_eq!(ts, "2024-03-01 08:00:00.500000");
    }

    #[test]
    fn values_canonicalise_from_what_the_grid_shows() {
        assert!(matches!(canon(&Kind::Int, "18446744073709551615"), CanonVal::Num(_)));
        assert!(matches!(canon(&Kind::Bit, "b'0101'"), CanonVal::Num(d) if d.to_plain() == "5"));
        assert!(matches!(canon(&Kind::Ts(false), "0000-00-00"), CanonVal::Other(s) if s == "0000-00-00"));
        assert!(matches!(canon(&Kind::Ts(true), "2024-03-01 08:00:00"), CanonVal::Ts(_)));
        assert!(matches!(canon(&Kind::Json, "{\"a\": 1}"), CanonVal::Json(_)));
        assert!(matches!(canon(&Kind::Json, "{oops"), CanonVal::Text(_)));
        assert!(matches!(canon(&Kind::Text, "a "), CanonVal::Text(s) if s == "a "));
    }

    #[test]
    fn mariadb_json_checks_name_their_column() {
        assert_eq!(json_valid_column("json_valid(`doc`)").as_deref(), Some("doc"));
        assert_eq!(json_valid_column("json_valid(`a``b`)").as_deref(), Some("a`b"));
        assert_eq!(json_valid_column("`n` > 0"), None);
    }
}
