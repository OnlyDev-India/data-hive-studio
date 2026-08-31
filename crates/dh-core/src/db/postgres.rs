//! PostgreSQL adapter (Phase 2 of `plan.md`): connects over TCP, serves the
//! same [`DbAdapter`] surface as SQLite, and translates the engine-agnostic
//! operation types into Postgres dialect (`$n` placeholders, `information_schema`
//! introspection). Storage-only concepts (WAL, byte export) fall back to the
//! trait's unsupported defaults.

use async_trait::async_trait;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use futures_util::TryStreamExt;
use sqlx::postgres::PgRow;
use sqlx::{Column as _, Connection as _, Row as _, TypeInfo as _};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Instant;

use crate::api::{
    FilterOp, QueryChunk, QueryOp, QueryResult, SchemaOp, TableInfo, TableSchema,
    ColumnInfo, IndexInfo, TriggerInfo,
};
use super::{BatchSink, DbAdapter, DbError, DbResult};

/// Parameters for connecting to a PostgreSQL server.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PgParams {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    /// disable | prefer | require | verify-ca | verify-full (defaults to prefer).
    #[serde(default)]
    pub ssl_mode: Option<String>,
}

fn ssl_mode(v: Option<&str>) -> sqlx::postgres::PgSslMode {
    use sqlx::postgres::PgSslMode::*;
    match v.unwrap_or("prefer").to_lowercase().as_str() {
        "disable" => Disable,
        "require" => Require,
        "verify-ca" => VerifyCa,
        "verify-full" => VerifyFull,
        _ => Prefer,
    }
}

fn default_port() -> u16 {
    5432
}

/// Quote an identifier the Postgres way (double quotes).
fn q(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Convert SQLite-style `?` placeholders to Postgres `$1..$n`. Occurrences
/// inside single-quoted literals are left alone.
fn dollar_placeholders(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    let mut n = 0;
    let mut in_str = false;
    for ch in sql.chars() {
        match ch {
            '\'' => {
                in_str = !in_str;
                out.push(ch);
            }
            '?' if !in_str => {
                n += 1;
                out.push('$');
                out.push_str(&n.to_string());
            }
            _ => out.push(ch),
        }
    }
    out
}

pub struct PgAdapter {
    /// One shared pool for everything (queries + catalog reads). sqlx pools
    /// are internally concurrent and Send+Sync, so queries never serialize.
    pool: PgPool,
    /// Schema every unqualified operation targets ("public" until switched).
    /// Data ops qualify explicitly (safe under PgBouncer transaction pooling,
    /// where session `search_path` is not preserved); the DDL batch uses a
    /// transaction-local search_path instead.
    schema: std::sync::RwLock<String>,
    /// Cached column name -> type maps per (schema, table). Writes used to
    /// pay an information_schema round trip on EVERY insert/update/delete;
    /// now only the first write to a table (or after DDL) does. Cleared by
    /// apply_schema_ops_batch so column changes are never stale.
    type_cache: std::sync::Mutex<
        std::collections::HashMap<(String, String), std::collections::HashMap<String, String>>,
    >,
    /// Database name this connection attached to — used to refuse dropping
    /// it from underneath itself.
    database: String,
}

impl PgAdapter {
    pub async fn connect(params: &PgParams) -> DbResult<Self> {
        let options = PgConnectOptions::new()
            // PgBouncer (transaction mode) compatibility: sqlx caches named
            // prepared statements per connection; pooled proxies break that.
            .statement_cache_capacity(0)
            .host(&params.host)
            .port(params.port)
            .username(&params.user)
            .password(&params.password)
            .database(&params.database)
            .ssl_mode(ssl_mode(params.ssl_mode.as_deref()));

        // ONE pool, ONE awaited connection: `connect_with` returns as soon as
        // the database answers — same as every other SQL client. Extra
        // connections are opened lazily by sqlx when queries need them.
        let pool = PgPoolOptions::new()
            .max_connections(12)
            .min_connections(1)
            .acquire_timeout(std::time::Duration::from_secs(30))
            .idle_timeout(std::time::Duration::from_secs(15 * 60))
            .connect_with(options)
            .await
            .map_err(DbError::Sqlite)?;

        Ok(Self {
            pool,
            schema: std::sync::RwLock::new("public".to_string()),
            type_cache: std::sync::Mutex::new(std::collections::HashMap::new()),
            database: params.database.clone(),
        })
    }

    /// Column name -> type map for a table in the active schema, served from
    /// the cache when possible. The map feeds write ops (INSERT casts, UPDATE
    /// /DELETE NULL matching) and would otherwise cost one information_schema
    /// round trip per operation.
    async fn column_types_for(
        &self,
        table: &str,
    ) -> DbResult<std::collections::HashMap<String, String>> {
        let key = (self.cur_schema(), table.to_string());
        if let Some(hit) = self.type_cache.lock().unwrap().get(&key) {
            return Ok(hit.clone());
        }
        let mut conn = self.pool.acquire().await.map_err(DbError::Sqlite)?;
        let types = column_types(&mut conn, &key.0, table).await?;
        drop(conn);
        self.type_cache
            .lock()
            .unwrap()
            .insert(key, types.clone());
        Ok(types)
    }

    /// The schema unqualified operations currently target.
    fn cur_schema(&self) -> String {
        self.schema.read().unwrap().clone()
    }

    /// Schema-qualified reference: `"schema"."name"`.
    fn tq(&self, name: &str) -> String {
        format!("{}.{}", q(&self.cur_schema()), q(name))
    }

    /// Qualified object reference for `$n::regclass` parameters:
    /// `"schema"."name"`. NO surrounding single quotes — this value is
    /// always BOUND as a parameter (the server applies its own quoting);
    /// embedding quotes would make regclass input fail with
    /// "invalid name syntax".
    fn regclass(&self, name: &str) -> String {
        format!("{}.{}", q(&self.cur_schema()), q(name))
    }

    /// WHERE fragment + params for one filter condition ($n placeholders are
    /// renumbered later by [`dollar_placeholders`], so emit plain `?` here).
    /// One filter condition: SQL fragment with a `?` placeholder plus the
    /// bound value. Values are ALWAYS parameter-bound — interpolating them
    /// breaks on uuid/numeric parsing and invites injection.
    fn filter_sql(cond: &crate::api::GridFilterCond, params: &mut Vec<Option<String>>) -> String {
        let col = q(&cond.column);
        let v = cond.value.clone();
        let mut like = |pat: String| {
            params.push(Some(format!("%{pat}%")));
            format!("{col} ILIKE ?")
        };
        match cond.op {
            FilterOp::Eq => {
                params.push(Some(v));
                format!("{col} = ?")
            }
            FilterOp::Neq => {
                params.push(Some(v));
                format!("{col} <> ?")
            }
            FilterOp::Contains => like(v),
            FilterOp::StartsWith => {
                params.push(Some(format!("{v}%")));
                format!("{col} ILIKE ?")
            }
            FilterOp::EndsWith => {
                params.push(Some(format!("%{v}")));
                format!("{col} ILIKE ?")
            }
            FilterOp::Gt => {
                params.push(Some(v));
                format!("{col} > ?")
            }
            FilterOp::Gte => {
                params.push(Some(v));
                format!("{col} >= ?")
            }
            FilterOp::Lt => {
                params.push(Some(v));
                format!("{col} < ?")
            }
            FilterOp::Lte => {
                params.push(Some(v));
                format!("{col} <= ?")
            }
            FilterOp::IsNull => format!("{col} IS NULL"),
            FilterOp::IsNotNull => format!("{col} IS NOT NULL"),
        }
    }

    fn where_clause(
        filters: &[crate::api::GridFilterCond],
        custom_where: Option<&String>,
        params: &mut Vec<Option<String>>,
    ) -> String {
        let mut parts: Vec<String> = Vec::new();
        for f in filters {
            parts.push(Self::filter_sql(f, params));
        }
        if let Some(w) = custom_where {
            if !w.trim().is_empty() {
                parts.push(format!("({})", w));
            }
        }
        if parts.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", parts.join(" AND "))
        }
    }
}


/// Build the dialect SELECT for a [`QueryOp::Select`] request.
#[allow(clippy::too_many_arguments)]
fn build_select(
    schema: &str,
    table: &str,
    filters: &[crate::api::GridFilterCond],
    custom_where: Option<&String>,
    order_by: Option<&String>,
    asc: bool,
    limit: Option<i64>,
    offset: Option<i64>,
    params: &mut Vec<Option<String>>,
) -> String {
    let where_sql = PgAdapter::where_clause(filters, custom_where, params);
    let dir = if asc { "ASC" } else { "DESC" };
    let order = order_by
        .map(|o| format!(" ORDER BY {} {}", q(o), dir))
        .unwrap_or_default();
    let lim = limit.map(|l| format!(" LIMIT {l}")).unwrap_or_default();
    let off = offset.map(|o| format!(" OFFSET {o}")).unwrap_or_default();
    format!(
        "SELECT * FROM {}.{}{where_sql}{order}{lim}{off}",
        q(schema),
        q(table)
    )
}

/// Render one row as text cells for every PostgreSQL type we may meet.
fn row_to_vec(r: &PgRow) -> Vec<Option<String>> {
    (0..r.columns().len())
        .map(|i| {
            let ty = r.column(i).type_info().name().to_string();
            match ty.as_str() {
                "INT2" => r.try_get::<Option<i16>, _>(i).ok().flatten().map(|v| v.to_string()),
                "INT4" => r.try_get::<Option<i32>, _>(i).ok().flatten().map(|v| v.to_string()),
                "INT8" => r.try_get::<Option<i64>, _>(i).ok().flatten().map(|v| v.to_string()),
                "FLOAT4" | "FLOAT8" => r.try_get::<Option<f64>, _>(i).ok().flatten().map(|v| v.to_string()),
                "NUMERIC" => r
                    .try_get::<Option<rust_decimal::Decimal>, _>(i)
                    .ok()
                    .flatten()
                    .map(|v| v.to_string()),
                "BOOL" => r.try_get::<Option<bool>, _>(i).ok().flatten().map(|v| v.to_string()),
                "UUID" => r.try_get::<Option<uuid::Uuid>, _>(i).ok().flatten().map(|v| v.to_string()),
                "TIMESTAMPTZ" => r
                    .try_get::<Option<DateTime<Utc>>, _>(i)
                    .ok()
                    .flatten()
                    .map(|v| v.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
                "TIMESTAMP" => r
                    .try_get::<Option<NaiveDateTime>, _>(i)
                    .ok()
                    .flatten()
                    .map(|v| v.to_string()),
                "DATE" => r.try_get::<Option<NaiveDate>, _>(i).ok().flatten().map(|v| v.to_string()),
                "TIME" | "TIMETZ" => r.try_get::<Option<NaiveTime>, _>(i).ok().flatten().map(|v| v.to_string()),
                "JSON" | "JSONB" => r
                    .try_get::<Option<serde_json::Value>, _>(i)
                    .ok()
                    .flatten()
                    .map(|v| v.to_string()),
                "BYTEA" => r
                    .try_get::<Option<Vec<u8>>, _>(i)
                    .ok()
                    .flatten()
                    .map(|b| format!("\\x{}", hex_encode(&b))),
                // ARRAY columns: sqlx names custom enum arrays `permission[]`
                // and built-in arrays `_text`/`_int4`. The binary wire format
                // is NOT readable as UTF-8 directly, so decode it and render a
                // Postgres array literal `{a,b,c}`.
                _ if ty.ends_with("[]") || ty.starts_with('_') => r
                    .try_get_unchecked::<Option<Vec<u8>>, _>(i)
                    .ok()
                    .flatten()
                    .map(|b| {
                        let els: Vec<String> = decode_pg_array(&b)
                            .into_iter()
                            .map(|e| e.unwrap_or_default())
                            .collect();
                        format!("{{{}}}", els.join(","))
                    }),
                // USER-DEFINED (domains, composites, custom enums not in
                // pg_enum, …): try a typed text decode first, then the
                // unchecked variant which reads the raw wire bytes as text.
                _ => r
                    .try_get::<Option<String>, _>(i)
                    .ok()
                    .flatten()
                    .or_else(|| {
                        r.try_get_unchecked::<Option<String>, _>(i)
                            .ok()
                            .flatten()
                    }),
            }
        })
        .collect()
}

/// Element type OIDs for fixed-width PostgreSQL base types. A fixed-width array
/// packs its elements back-to-back with no length word; every other element type
/// (text, varchar, enum, numeric, bytea, …) is varlena and length-prefixed.
fn fixed_typlen(elem_oid: u32) -> Option<usize> {
    let w = match elem_oid {
        16 => 1,    // bool
        18 => 1,    // char
        21 => 2,    // int2
        23 => 4,    // int4
        20 => 8,    // int8
        26 => 4,    // oid
        700 => 4,   // float4
        701 => 8,   // float8
        1082 => 4,  // date
        1114 => 8,  // timestamp
        1184 => 8,  // timestamptz
        1266 => 12, // timetz
        1700 => 0,  // numeric is varlena
        2950 => 16, // uuid
        _ => 0,
    };
    if w == 0 {
        None
    } else {
        Some(w)
    }
}

/// Render one fixed-width array element's raw bytes as human-readable text.
fn decode_fixed_elem(elem_oid: u32, b: &[u8]) -> String {
    let take = |n: usize| -> &[u8] { &b[..b.len().min(n)] };
    match elem_oid {
        16 => match b.first() {
            Some(&0) => "false".into(),
            Some(_) => "true".into(),
            None => String::new(),
        },
        18 | 25 => String::from_utf8_lossy(take(1)).into_owned(), // char
        21 => i16::from_be_bytes([take(2)[0], take(2)[1]]).to_string(),
        23 | 26 => i32::from_be_bytes([take(4)[0], take(4)[1], take(4)[2], take(4)[3]]).to_string(),
        20 => {
            let t = take(8);
            i64::from_be_bytes([t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7]]).to_string()
        }
        700 => {
            let t = take(4);
            f32::from_be_bytes([t[0], t[1], t[2], t[3]]).to_string()
        }
        701 => {
            let t = take(8);
            f64::from_be_bytes([t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7]]).to_string()
        }
        2950 => {
            let h = take(16)
                .iter()
                .map(|x| format!("{x:02x}"))
                .collect::<String>();
            format!(
                "{}-{}-{}-{}-{}",
                &h[..8.min(h.len())],
                &h[8..16.min(h.len())],
                &h[16..20.min(h.len())],
                &h[20..24.min(h.len())],
                &h[24..32.min(h.len())]
            )
        }
        // date/timestamp/timetz: keep lossy text rather than guess timezones.
        _ => String::from_utf8_lossy(b).into_owned(),
    }
}

/// Decode a PostgreSQL binary array (the `array_send` wire format) into its text
/// elements. Mirrors `array_recv`: a fixed-width element type may be flagged
/// `hasnull` (each element then prefixed by an int32 length, -1 = NULL) or
/// packed contiguously; every other type is varlena and always length-prefixed.
fn decode_pg_array(buf: &[u8]) -> Vec<Option<String>> {
    if buf.len() < 12 {
        return vec![];
    }
    let i32at = |o: usize| -> Option<i32> {
        buf.get(o..o + 4)
            .map(|s| i32::from_be_bytes([s[0], s[1], s[2], s[3]]))
    };
    let Some(ndim) = i32at(0) else { return vec![] };
    let hasnull = i32at(4).unwrap_or(0) != 0;
    let elem_oid = i32at(8).unwrap_or(0) as u32;
    let width = fixed_typlen(elem_oid);
    let mut o = 12usize;
    let mut nelems: i64 = 1;
    for _ in 0..ndim {
        let Some(len) = i32at(o) else { return vec![] };
        if len < 0 {
            return vec![];
        }
        nelems = nelems.saturating_mul(len as i64);
        o += 8; // skip the dimension's lower bound
    }
    if ndim <= 0 || nelems <= 0 || nelems > 1_000_000 {
        return vec![];
    }
    let mut out: Vec<Option<String>> = Vec::with_capacity(nelems as usize);
    while out.len() < nelems as usize && o < buf.len() {
        if let Some(w) = width {
            if hasnull {
                let Some(len) = i32at(o) else { break };
                o += 4;
                if len < 0 {
                    out.push(None);
                    continue;
                }
            }
            let end = (o + w).min(buf.len());
            out.push(Some(decode_fixed_elem(elem_oid, &buf[o..end])));
            o = end;
        } else {
            let Some(len) = i32at(o) else { break };
            o += 4;
            if len < 0 {
                out.push(None);
                continue;
            }
            let end = (o + len as usize).min(buf.len());
            out.push(Some(String::from_utf8_lossy(&buf[o..end]).into_owned()));
            o = end;
        }
    }
    out
}

fn hex_encode(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

/// Column name -> Postgres type name, used to cast string parameters on
/// INSERT/UPDATE/DELETE so text-bound values coerce cleanly.
async fn column_types(
    conn: &mut sqlx::PgConnection,
    schema: &str,
    table: &str,
) -> DbResult<std::collections::HashMap<String, String>> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT column_name, data_type FROM information_schema.columns \
         WHERE table_schema=$1 AND table_name=$2",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(conn)
    .await
    .map_err(DbError::Sqlite)?;
    Ok(rows.into_iter().collect())
}


#[async_trait]
impl DbAdapter for PgAdapter {
    async fn list_tables(&self) -> DbResult<Vec<TableInfo>> {
        let schema = self.cur_schema();
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT c.relname, \
             CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' \
                            WHEN 'm' THEN 'matview' ELSE 'other' END \
             FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE c.relkind IN ('r','v','m') AND n.nspname = $1 \
             ORDER BY c.relname",
        )
        .bind(&schema)
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::Sqlite)?;
        Ok(rows
            .into_iter()
            .map(|(name, kind)| TableInfo { name, kind })
            .collect())
    }

    async fn table_schema(&self, table: &str) -> DbResult<(TableSchema, Vec<String>)> {
        let schema = self.cur_schema();
        let regclass = self.regclass(table);
        // Every introspection statement rides back WITH the schema — per-call
        // ownership, so concurrent describes never interleave captures.
        let mut statements: Vec<String> = Vec::new();

        // What kind of object this is — views open read-only in the UI.
        let sql_kind = "SELECT CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' \
                    WHEN 'm' THEN 'matview' ELSE 'other' END \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relname = $2";
        let sql_cols = "SELECT column_name, data_type, is_nullable, COALESCE(column_default, '') \
             FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 \
             ORDER BY ordinal_position";
        let sql_pk = "SELECT a.attname FROM pg_index i \
             JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum = ANY(i.indkey) \
             WHERE i.indrelid = $1::regclass AND i.indisprimary";
        // Native enum columns — including ARRAYS of a native enum (a column of
        // type `permission[]` has atttypid = the `_permission` array type, whose
        // typelem points back at the enum; we resolve through it so the column
        // surfaces the enum's labels and is flagged as an array).
        let sql_enums = "SELECT a.attname, \
                (CASE WHEN pt.typelem <> 0 THEN el.typname ELSE pt.typname END), \
                (pt.typelem <> 0) AS is_array, \
                e.enumlabel \
             FROM pg_attribute a \
             JOIN pg_type pt ON a.atttypid = pt.oid \
             LEFT JOIN pg_type el ON pt.typelem <> 0 AND pt.typelem = el.oid \
             JOIN pg_enum e ON e.enumtypid = \
                  CASE WHEN pt.typelem <> 0 THEN pt.typelem ELSE pt.oid END \
             WHERE a.attrelid = $1::regclass \
             ORDER BY a.attnum, e.enumsortorder";
        let sql_fks = "SELECT kcu.column_name, ccu.table_name, ccu.column_name, \
              tc.constraint_name, \
              CASE con.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' \
                   WHEN 'd' THEN 'SET DEFAULT' WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END, \
              CASE con.confupdtype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' \
                   WHEN 'd' THEN 'SET DEFAULT' WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name \
             JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name \
             JOIN pg_constraint con ON con.conname = tc.constraint_name \
                  AND con.conrelid = to_regclass(format('%I.%I', tc.table_schema, tc.table_name)) \
             WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_name=$1 AND tc.table_schema=$2";
        let sql_idx = "SELECT indexname, indexdef FROM pg_indexes \
             WHERE schemaname=$1 AND tablename=$2";
        let sql_trig = "SELECT t.tgname, pg_get_triggerdef(t.oid) \
             FROM pg_trigger t WHERE t.tgrelid=$1::regclass AND NOT t.tgisinternal ORDER BY t.tgname";

        // Display copies: real values inlined ($1 -> 'public', …) and a
        // trailing semicolon, so the activity log reads like runnable SQL.
        let st = [Some(schema.clone()), Some(table.to_string())];
        let ts = [Some(table.to_string()), Some(schema.clone())];
        let rg = [Some(regclass.clone())];
        statements.extend([
            super::inline_placeholders(sql_kind, &st, true) + ";",
            super::inline_placeholders(sql_cols, &st, true) + ";",
            super::inline_placeholders(sql_pk, &rg, true) + ";",
            super::inline_placeholders(sql_enums, &rg, true) + ";",
            super::inline_placeholders(sql_fks, &ts, true) + ";",
            super::inline_placeholders(sql_idx, &st, true) + ";",
            super::inline_placeholders(sql_trig, &rg, true) + ";",
        ]);

        // The seven lookups are mutually independent (each only needs the
        // qualified name, known upfront) — run them CONCURRENTLY so a remote
        // server costs one round trip of latency instead of seven.
        let f_kind = sqlx::query_scalar::<_, Option<String>>(sql_kind)
            .bind(&schema)
            .bind(table)
            .fetch_optional(&self.pool);
        let f_cols = sqlx::query_as::<_, (String, String, String, String)>(sql_cols)
            .bind(&schema)
            .bind(table)
            .fetch_all(&self.pool);
        let f_pk = sqlx::query_as::<_, (String,)>(sql_pk)
            .bind(&regclass)
            .fetch_all(&self.pool);
        let f_enums = sqlx::query_as::<_, (String, String, bool, String)>(sql_enums)
            .bind(&regclass)
            .fetch_all(&self.pool);
        let f_fks = sqlx::query_as::<_, (String, String, String, String, String, String)>(sql_fks)
            .bind(table)
            .bind(&schema)
            .fetch_all(&self.pool);
        let f_idx = sqlx::query_as::<_, (String, String)>(sql_idx)
            .bind(&schema)
            .bind(table)
            .fetch_all(&self.pool);
        let f_trig = sqlx::query_as::<_, (String, Option<String>)>(sql_trig)
            .bind(&regclass)
            .fetch_all(&self.pool);

        // Balanced binary join tree — every branch is polled concurrently.
        let (((r_kind, r_cols), (r_pk, r_enums)), ((r_fks, r_idx), r_trig)) =
            futures_util::future::join(
                futures_util::future::join(
                    futures_util::future::join(f_kind, f_cols),
                    futures_util::future::join(f_pk, f_enums),
                ),
                futures_util::future::join(futures_util::future::join(f_fks, f_idx), f_trig),
            )
            .await;

        let object_kind: Option<Option<String>> = r_kind.map_err(DbError::Sqlite)?;
        let columns: Vec<(String, String, String, String)> = r_cols.map_err(DbError::Sqlite)?;
        let pk_rows: Vec<(String,)> = r_pk.map_err(DbError::Sqlite)?;
        let enum_rows: Vec<(String, String, bool, String)> = r_enums.map_err(DbError::Sqlite)?;
        let fk_rows: Vec<(String, String, String, String, String, String)> = r_fks.map_err(DbError::Sqlite)?;
        let idx_rows: Vec<(String, String)> = r_idx.map_err(DbError::Sqlite)?;
        let trig_rows: Vec<(String, Option<String>)> = r_trig.map_err(DbError::Sqlite)?;

        let pk_set: std::collections::HashSet<String> =
            pk_rows.into_iter().map(|(n,)| n).collect();

        let mut cols: Vec<ColumnInfo> = columns
            .into_iter()
            .map(|(name, data_type, nullable, default)| ColumnInfo {
                name,
                data_type,
                not_null: nullable == "NO",
                primary_key: false,
                default: if default.is_empty() { None } else { Some(default) },
                enum_values: Vec::new(),
                is_array: false,
            })
            .map(|mut c| {
                c.primary_key = pk_set.contains(&c.name);
                c
            })
            .collect();

        // Native enum columns: resolve the UDT name and its labels, then
        // surface them on the column (header shows the type name; editors
        // show the labels as a dropdown).
        let mut enum_labels: std::collections::HashMap<
            String,
            (String, bool, Vec<String>),
        > = std::collections::HashMap::new();
        for (col, typname, is_array, label) in enum_rows {
            let entry = enum_labels
                .entry(col)
                .or_insert_with(|| (typname.clone(), is_array, Vec::new()));
            entry.2.push(label);
        }
        for c in &mut cols {
            if let Some((typname, is_array, labels)) = enum_labels.get(&c.name) {
                c.data_type = if *is_array {
                    format!("{}[]", typname)
                } else {
                    typname.clone()
                };
                c.enum_values = labels.clone();
                c.is_array = *is_array;
            }
        }

        let foreign_keys: Vec<crate::api::ForeignKeyInfo> = fk_rows
            .into_iter()
            .filter(|(_c, rt, _rc, _n, _d, _u)| !rt.is_empty())
            .map(|(column, referenced_table, referenced_column, name, on_delete, on_update)| crate::api::ForeignKeyInfo {
                column,
                referenced_table,
                referenced_column,
                name: (!name.is_empty()).then_some(name),
                on_delete: Some(on_delete),
                on_update: Some(on_update),
            })
            .collect();

        let mut indexes = Vec::new();
        for (name, def) in idx_rows {
            let unique = def.to_uppercase().contains("UNIQUE");
            // Parse "(a, b)" tail of the definition for covered columns.
            let cols_part = def.split('(').nth(1).unwrap_or("").rsplit(')').next().unwrap_or("");
            let columns: Vec<String> = cols_part
                .split(',')
                .map(|c| c.trim().trim_matches('"').to_string())
                .filter(|c| !c.is_empty())
                .collect();
            if columns.is_empty() {
                continue;
            }
            indexes.push(IndexInfo { name, unique, columns, origin: "c".into() });
        }

        let triggers = trig_rows
            .into_iter()
            .filter_map(|(name, sql)| {
                let sql = sql?;
                Some(TriggerInfo {
                    timing: String::new(),
                    event: String::new(),
                    name,
                    sql,
                })
            })
            .collect();

        Ok((
            TableSchema {
                kind: object_kind.flatten().unwrap_or_else(|| "table".to_string()),
                columns: cols,
                foreign_keys,
                indexes,
                triggers,
            },
            statements,
        ))
    }

    async fn list_schemas(&self) -> DbResult<Vec<String>> {
        // User-facing schemas only: pg_* internals and information_schema
        // stay hidden (the SQL console can still reach them by hand).
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT nspname FROM pg_namespace \
             WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' \
             ORDER BY (nspname = 'public') DESC, nspname",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::Sqlite)?;
        Ok(rows.into_iter().map(|(n,)| n).collect())
    }

    async fn list_databases(&self) -> DbResult<Vec<String>> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::Sqlite)?;
        Ok(rows.into_iter().map(|(n,)| n).collect())
    }

    /// Schemas + databases + active schema, ONE round trip. The three lists
    /// used to be separate queries; on remote servers (Neon) they serialized
    /// behind the pool and delayed every query that followed.
    async fn catalog_overview(&self) -> DbResult<super::CatalogOverview> {
        let sql = "\
            SELECT COALESCE((\
                SELECT json_agg(nspname ORDER BY nspname) FROM pg_namespace \
                WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'\
            ), '[]'), \
            COALESCE((\
                SELECT json_agg(datname ORDER BY datname) FROM pg_database \
                WHERE datistemplate = false\
            ), '[]'), \
            current_schema()::text";
        let (schemas_v, databases_v, active): (
            serde_json::Value,
            serde_json::Value,
            String,
        ) = sqlx::query_as(sql)
            .fetch_one(&self.pool)
            .await
            .map_err(DbError::Sqlite)?;
        let to_vec = |v: &serde_json::Value| -> Vec<String> {
            v.as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default()
        };
        Ok(super::CatalogOverview {
            schemas: to_vec(&schemas_v),
            databases: to_vec(&databases_v),
            active_schema: active,
        })
    }

    async fn set_active_schema(&self, schema: &str) -> DbResult<()> {
        let exists: Option<i32> = sqlx::query_scalar(
            "SELECT 1 FROM pg_namespace WHERE nspname = $1",
        )
        .bind(schema)
        .fetch_optional(&self.pool)
        .await
        .map_err(DbError::Sqlite)?;
        if exists.is_none() {
            return Err(DbError::InvalidOperation(format!(
                "schema \"{schema}\" does not exist on this server"
            )));
        }
        *self.schema.write().unwrap() = schema.to_string();
        Ok(())
    }

    async fn active_schema(&self) -> DbResult<String> {
        Ok(self.cur_schema())
    }

    // Identifier safety: q() doubles embedded quotes, so interpolated names
    // cannot break out of the quoted identifier.
    async fn create_database(&self, name: &str) -> DbResult<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::InvalidOperation(
                "database name must not be empty".into(),
            ));
        }
        let sql = format!("CREATE DATABASE {}", q(name));
        sqlx::query(&sql)
            .execute(&self.pool)
            .await
            .map_err(DbError::Sqlite)?;
        Ok(())
    }

    async fn drop_database(&self, name: &str) -> DbResult<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::InvalidOperation(
                "database name must not be empty".into(),
            ));
        }
        if name == self.database {
            return Err(DbError::InvalidOperation(
                "cannot drop the database this connection is attached to — open a different database first".into(),
            ));
        }
        let sql = format!("DROP DATABASE IF EXISTS {} WITH (FORCE)", q(name));
        sqlx::query(&sql)
            .execute(&self.pool)
            .await
            .map_err(DbError::Sqlite)?;
        Ok(())
    }

    async fn create_schema(&self, name: &str) -> DbResult<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::InvalidOperation(
                "schema name must not be empty".into(),
            ));
        }
        let sql = format!("CREATE SCHEMA IF NOT EXISTS {}", q(name));
        sqlx::query(&sql)
            .execute(&self.pool)
            .await
            .map_err(DbError::Sqlite)?;
        Ok(())
    }

    async fn drop_schema(&self, name: &str, cascade: bool) -> DbResult<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::InvalidOperation(
                "schema name must not be empty".into(),
            ));
        }
        if name.eq_ignore_ascii_case("public") {
            return Err(DbError::InvalidOperation(
                "the default 'public' schema cannot be dropped".into(),
            ));
        }
        let cascade_sql = if cascade { " CASCADE" } else { "" };
        let sql = format!("DROP SCHEMA IF EXISTS {}{cascade_sql}", q(name));
        sqlx::query(&sql)
            .execute(&self.pool)
            .await
            .map_err(DbError::Sqlite)?;
        // If the user dropped the ACTIVE schema, fall back to public so
        // subsequent unqualified operations keep working.
        if self.cur_schema() == name {
            *self.schema.write().unwrap() = "public".to_string();
        }
        Ok(())
    }

    async fn run_sql(&self, sql: &str) -> DbResult<QueryResult> {
        let start = Instant::now();
        let converted = dollar_placeholders(sql);
        let trimmed = converted.trim();
        let first_word = trimmed
            .split(|c: char| c == ' ' || c == '\n' || c == '\t')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        let is_select = first_word == "select" || first_word == "with";
        if is_select {
            let rows = sqlx::query(trimmed).fetch_all(&self.pool).await.map_err(DbError::Sqlite)?;
            let columns: Vec<String> = rows
                .first()
                .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
                .unwrap_or_default();
            // Reuse row_to_vec so every type (dates, timestamps, arrays,
            // booleans, numerics, …) renders as human-readable text.
            let out: Vec<Vec<Option<String>>> = rows.iter().map(row_to_vec).collect();
            return Ok(QueryResult {
                columns,
                rows: out,
                rows_affected: 0,
                is_select: true,
                error: null_error(),
                elapsed_ms: start.elapsed().as_millis(),
            });
        }
        let res = sqlx::query(trimmed).execute(&self.pool).await.map_err(DbError::Sqlite)?;
        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            rows_affected: res.rows_affected(),
            is_select: false,
            error: null_error(),
            elapsed_ms: start.elapsed().as_millis(),
        })
    }

    async fn execute_params(&self, sql: &str, params: &[Option<String>]) -> DbResult<u64> {
        let converted = dollar_placeholders(sql);
        // Bind the parameters — frontend-built statements use $1..$n and are
        // useless (and unsafe) if executed with them unresolved.
        let mut q = sqlx::query(&converted);
        for p in params {
            q = bind_str(q, p);
        }
        let res = q.execute(&self.pool).await.map_err(DbError::Sqlite)?;
        Ok(res.rows_affected())
    }

    async fn run_sql_params(
        &self,
        sql: &str,
        params: &[Option<String>],
    ) -> DbResult<QueryResult> {
        let start = Instant::now();
        // Frontend-built statements use `?`; renumber to $n and bind.
        let converted = dollar_placeholders(sql);
        let mut q = sqlx::query(&converted);
        for p in params {
            q = bind_str(q, p);
        }
        let rows = q.fetch_all(&self.pool).await.map_err(DbError::Sqlite)?;
        let columns: Vec<String> = rows
            .first()
            .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
            .unwrap_or_default();
        let out: Vec<Vec<Option<String>>> = rows.iter().map(row_to_vec).collect();
        Ok(QueryResult {
            columns,
            rows: out,
            rows_affected: 0,
            is_select: true,
            error: null_error(),
            elapsed_ms: start.elapsed().as_millis(),
        })
    }

    async fn execute_op(&self, op: &QueryOp) -> DbResult<super::OpOutcome> {
        let start = std::time::Instant::now();
        let mk = |columns: Vec<String>,
                  rows: Vec<Vec<Option<String>>>,
                  rows_affected: u64,
                  is_select: bool|
         -> QueryResult {
            QueryResult {
                columns,
                rows,
                rows_affected,
                is_select,
                error: null_error(),
                elapsed_ms: start.elapsed().as_millis(),
            }
        };
        match op {
            QueryOp::Select { table, filters, custom_where, order_by, order_dir, limit, offset } => {
                let mut params = Vec::new();
                let sql = build_select(
                    &self.cur_schema(),
                    table,
                    filters,
                    custom_where.as_ref(),
                    order_by.as_ref(),
                    order_dir.as_deref() != Some("DESC"),
                    *limit,
                    *offset,
                    &mut params,
                );
                let converted = dollar_placeholders(&sql);
                let display = super::inline_placeholders(&converted, &params, true) + ";";
                Ok(super::OpOutcome {
                    result: run_sql_prebound(&self.pool, &sql, params).await?,
                    sql: Some(display),
                })
            }
            QueryOp::Count { table, filters, custom_where } => {
                let mut params = Vec::new();
                let where_sql =
                    Self::where_clause(filters, custom_where.as_ref(), &mut params);
                let sql =
                    format!("SELECT COUNT(*) FROM {}{}", self.tq(table), where_sql);
                let converted = dollar_placeholders(&sql);
                let mut cq = sqlx::query_scalar::<_, i64>(&converted);
                for p in &params {
                    cq = match p {
                        Some(v) => cq.bind(v.clone()),
                        None => cq.bind(None::<String>),
                    };
                }
                // One scalar round trip — no row shaping, no column metadata.
                let count = cq.fetch_one(&self.pool).await.map_err(DbError::Sqlite)? as u64;
                Ok(super::OpOutcome {
                    result: mk(vec!["count".into()], vec![vec![Some(count.to_string())]], count, true),
                    sql: Some(super::inline_placeholders(&converted, &params, true) + ";"),
                })
            }
            QueryOp::SelectDistinct { table, column, limit } => {
                let mut sql =
                    format!("SELECT DISTINCT {} FROM {}", q(column), self.tq(table));
                if let Some(l) = limit {
                    sql.push_str(&format!(" LIMIT {l}"));
                }
                let result = self.run_sql(&sql).await?;
                Ok(super::OpOutcome { result, sql: Some(format!("{};", sql)) })
            }
            QueryOp::Insert { table, values, skip_empty } => {
                let types = self.column_types_for(table).await?;
                let mut names = Vec::new();
                let mut phs = Vec::new();
                // Values whose placeholders land in the SQL, in order — the
                // bind loop below MUST cover exactly these.
                let mut bound: Vec<&Option<String>> = Vec::new();
                let mut n = 0;
                for (col, val) in values {
                    if *skip_empty && val.is_none() { continue; }
                    n += 1;
                    names.push(q(col));
                    let cast = types.get(col.as_str()).map(|t| format!("::{t}")).unwrap_or_default();
                    phs.push(format!("${n}{cast}"));
                    bound.push(val);
                }
                if names.is_empty() {
                    return Ok(super::OpOutcome { result: mk(vec![], vec![], 0, false), sql: None });
                }
                let sql = format!(
                    "INSERT INTO {} ({}) VALUES ({})",
                    self.tq(table),
                    names.join(", "),
                    phs.join(", ")
                );
                log::debug!("pg insert: {sql}");
                let mut ins = sqlx::query(&sql);
                for val in &bound {
                    ins = bind_str(ins, val);
                }
                let res = ins.execute(&self.pool).await.map_err(DbError::Sqlite)?;
                // Display copy: bound values inlined so the log is readable.
                let display = format!(
                    // (trailing semicolon appended below)
                    "INSERT INTO {} ({}) VALUES ({})",
                    self.tq(table),
                    names.join(", "),
                    bound
                        .iter()
                        .map(|v| super::sql_literal(v.as_deref()))
                        .collect::<Vec<_>>()
                        .join(", ")
                );
                let display = format!("{display};");
                Ok(super::OpOutcome {
                    result: mk(vec![], vec![], res.rows_affected(), false),
                    sql: Some(display),
                })
            }
            QueryOp::Update { table, set, match_row } => {
                if set.is_empty() {
                    return Ok(super::OpOutcome { result: mk(vec![], vec![], 0, false), sql: None });
                }
                let types = self.column_types_for(table).await?;
                let mut sets = Vec::new();
                let mut wheres = Vec::new();
                let mut n = 0;
                for (col, _val) in set {
                    n += 1;
                    let cast = types.get(col).map(|t| format!("::{t}")).unwrap_or_default();
                    sets.push(format!("{} = ${n}{}", q(col), cast));
                }
                for (col, val) in match_row {
                    n += 1;
                    let cast = types.get(col).map(|t| format!("::{t}")).unwrap_or_default();
                    wheres.push(if val.is_none() {
                        format!("{} IS NULL", q(col))
                    } else {
                        format!("{} = ${n}{}", q(col), cast)
                    });
                }
                let sql = format!(
                    "UPDATE {} SET {} WHERE {}",
                    self.tq(table),
                    sets.join(", "),
                    wheres.join(" AND ")
                );
                // Placeholder numbering increments for EVERY match column,
                // but IS NULL columns emit no placeholder — so bind the set
                // values, then only the non-NULL match values, in order.
                let mut final_q = sqlx::query(&sql);
                for (_, val) in set.iter() {
                    final_q = bind_str(final_q, val);
                }
                for (_, val) in match_row.iter() {
                    if !val.is_none() {
                        final_q = bind_str(final_q, val);
                    }
                }
                log::debug!("pg update: {sql}");
                let res = final_q.execute(&self.pool).await.map_err(DbError::Sqlite)?;
                // Display copy with values inlined (log only).
                let display = format!(
                    // (trailing semicolon appended below)
                    "UPDATE {} SET {} WHERE {}",
                    self.tq(table),
                    set.iter()
                        .map(|(c, v)| format!("{} = {}", q(c), super::sql_literal(v.as_deref())))
                        .collect::<Vec<_>>()
                        .join(", "),
                    match_row
                        .iter()
                        .map(|(c, v)| match v {
                            None => format!("{} IS NULL", q(c)),
                            Some(_) => {
                                format!("{} = {}", q(c), super::sql_literal(v.as_deref()))
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" AND ")
                );
                let display = format!("{display};");
                Ok(super::OpOutcome {
                    result: mk(vec![], vec![], res.rows_affected(), false),
                    sql: Some(display),
                })
            }
            QueryOp::Delete { table, match_row } => {
                let types = self.column_types_for(table).await?;
                let mut wheres = Vec::new();
                let mut final_q = sqlx::query("");
                let mut n = 0;
                for (col, val) in match_row {
                    n += 1;
                    if val.is_none() {
                        wheres.push(format!("{} IS NULL", q(col)));
                    } else {
                        let cast = types.get(col).map(|t| format!("::{t}")).unwrap_or_default();
                        wheres.push(format!("{} = ${n}{}", q(col), cast));
                        final_q = bind_str(final_q, val);
                    }
                }
                let sql = format!(
                    "DELETE FROM {}{}",
                    self.tq(table),
                    if wheres.is_empty() { String::new() } else { format!(" WHERE {}", wheres.join(" AND ")) }
                );
                log::debug!("pg delete: {sql}");
                let mut real_q = sqlx::query(&sql);
                for (_, val) in match_row.iter() {
                    if !val.is_none() { real_q = bind_str(real_q, val); }
                }
                let res = real_q.execute(&self.pool).await.map_err(DbError::Sqlite)?;
                let display = format!(
                    // (trailing semicolon appended below)
                    "DELETE FROM {}{}",
                    self.tq(table),
                    if match_row.is_empty() {
                        String::new()
                    } else {
                        format!(
                            " WHERE {}",
                            match_row
                                .iter()
                                .map(|(c, v)| match v {
                                    None => format!("{} IS NULL", q(c)),
                                    Some(_) => format!(
                                        "{} = {}",
                                        q(c),
                                        super::sql_literal(v.as_deref())
                                    ),
                                })
                                .collect::<Vec<_>>()
                                .join(" AND ")
                        )
                    }
                );
                let display = format!("{display};");
                Ok(super::OpOutcome {
                    result: mk(vec![], vec![], res.rows_affected(), false),
                    sql: Some(display),
                })
            }
            QueryOp::DropTable { table } => {
                let sql = format!("DROP TABLE IF EXISTS {}", self.tq(table));
                let res = sqlx::query(&sql).execute(&self.pool).await.map_err(DbError::Sqlite)?;
                self.type_cache
                    .lock()
                    .unwrap()
                    .remove(&(self.cur_schema(), table.to_string()));
                Ok(super::OpOutcome {
                    result: mk(vec![], vec![], res.rows_affected(), false),
                    sql: Some(format!("{sql};")),
                })
            }
        }
    }

    async fn execute_op_stream(
        &self,
        op: &QueryOp,
        on_batch: BatchSink<'_>,
    ) -> DbResult<super::OpOutcome> {
        // Only SELECT streams; everything else runs normally.
        let QueryOp::Select { table, filters, custom_where, order_by, order_dir, limit, offset } = op
        else {
            return self.execute_op(op).await
        };
        let start = Instant::now();
        let mut params = Vec::new();
        let sql = dollar_placeholders(&build_select(
            &self.cur_schema(),
            table,
            filters,
            custom_where.as_ref(),
            order_by.as_ref(),
            order_dir.as_deref() != Some("DESC"),
            *limit,
            *offset,
            &mut params,
        ));

        let display = super::inline_placeholders(&sql, &params, true) + ";";
        let mut stream = bind_all(&sql, &params).fetch(&self.pool);
        let mut columns: Option<Vec<String>> = None;
        let mut batch: Vec<Vec<Option<String>>> = Vec::new();

        while let Some(row) = stream.try_next().await.map_err(DbError::Sqlite)? {
            if columns.is_none() {
                columns = Some(row.columns().iter().map(|c| c.name().to_string()).collect());
            }
            batch.push(row_to_vec(&row));
            if batch.len() >= 500 {
                on_batch(QueryChunk {
                    columns: columns.clone(),
                    rows: std::mem::take(&mut batch),
                })?;
            }
        }
        if !batch.is_empty() {
            on_batch(QueryChunk {
                columns: columns.clone(),
                rows: batch,
            })?;
        }

        Ok(super::OpOutcome {
            result: QueryResult {
                columns: columns.unwrap_or_default(),
                rows: vec![], // caller assembles from chunks
                rows_affected: 0,
                is_select: true,
                error: null_error(),
                elapsed_ms: start.elapsed().as_millis(),
            },
            sql: Some(display),
        })
    }

    async fn run_sql_stream(&self, sql: &str, on_batch: BatchSink<'_>) -> DbResult<QueryResult> {
        let result = self.run_sql(sql).await?;
        if result.is_select && !result.rows.is_empty() {
            let chunk = QueryChunk {
                columns: Some(result.columns.clone()),
                rows: result.rows.clone(),
            };
            on_batch(chunk)?;
        }
        Ok(QueryResult { rows: vec![], ..result })
    }

    async fn apply_schema_ops_batch(&self, ops: &[SchemaOp]) -> DbResult<Vec<String>> {
        let mut conn = self.pool.acquire().await.map_err(DbError::Sqlite)?;
        let mut tx = conn.begin().await.map_err(DbError::Sqlite)?;
        // Transaction-local search_path: every unqualified name in the DDL
        // batch resolves inside the active schema. SET LOCAL dies with the
        // transaction, so pooled connections stay clean (PgBouncer-safe).
        let schema = self.cur_schema();
        sqlx::query(&format!("SET LOCAL search_path = {}", q(&schema)))
            .execute(&mut *tx)
            .await
            .map_err(DbError::Sqlite)?;
        let mut executed = vec![format!("SET LOCAL search_path = {}", q(&schema))];
        for op in ops {
            let stmts: Vec<String> = match op {
                SchemaOp::RenameTable { table, new_name } => {
                    vec![format!("ALTER TABLE {} RENAME TO {}", q(table), q(new_name))]
                }
                SchemaOp::AddColumn { table, name, data_type, not_null, default } => {
                    let nn = if *not_null && default.is_some() { " NOT NULL" } else { "" };
                    let dflt = default
                        .as_deref()
                        .map(|d| format!(" DEFAULT {d}"))
                        .unwrap_or_default();
                    vec![format!(
                        "ALTER TABLE {} ADD COLUMN {} {}{nn}{dflt}",
                        q(table),
                        q(name),
                        if data_type.trim().is_empty() { "TEXT" } else { data_type.trim() }
                    )]
                }
                SchemaOp::DropColumn { table, name } => {
                    vec![format!("ALTER TABLE {} DROP COLUMN {}", q(table), q(name))]
                }
                SchemaOp::AlterColumn { table, column, new_name, data_type, not_null, default_mode, default_value } => {
                    // Postgres handles every change IN PLACE — no rebuild
                    // needed (unlike SQLite). Rename is its own statement;
                    // the rest compose into one ALTER with clause list.
                    // NOTE: this arm ONLY builds statements — the batch loop
                    // below owns execution. Double-executing DDL here caused
                    // renames to fail with "column does not exist".
                    let mut ran: Vec<String> = Vec::new();
                    if let Some(n) = new_name {
                        let n = n.trim();
                        if n != column {
                            ran.push(format!(
                                "ALTER TABLE {} RENAME COLUMN {} TO {};",
                                q(table),
                                q(column),
                                q(n)
                            ));
                        }
                    }
                    let mut clauses: Vec<String> = Vec::new();
                    let ac = format!("ALTER COLUMN {}", q(column));
                    let new_type = data_type.as_deref().map(str::trim).filter(|t| !t.is_empty());
                    if let Some(t) = new_type {
                        clauses.push(format!("{ac} TYPE {t} USING {ac2}::{t}", ac2 = q(column)));
                    }
                    match not_null {
                        Some(true) => clauses.push(format!("{ac} SET NOT NULL")),
                        Some(false) => clauses.push(format!("{ac} DROP NOT NULL")),
                        None => {}
                    }
                    match default_mode {
                        Some(crate::api::DefaultMode::Set) => {
                            let v = default_value.clone().unwrap_or_default();
                            if v.trim().is_empty() {
                                clauses.push(format!("{ac} DROP DEFAULT"));
                            } else {
                                clauses.push(format!("{ac} SET DEFAULT {}", v));
                            }
                        }
                        Some(crate::api::DefaultMode::Drop) => {
                            clauses.push(format!("{ac} DROP DEFAULT"))
                        }
                        Some(crate::api::DefaultMode::Keep) | None => {}
                    }
                    if !clauses.is_empty() {
                        let s = format!(
                            "ALTER TABLE {} {};",
                            q(table),
                            clauses.join(", ")
                        );
                        sqlx::query(&s).execute(&mut *tx).await.map_err(DbError::Sqlite)?;
                        ran.push(s);
                    }
                    if ran.is_empty() {
                        return Err(DbError::InvalidOperation(
                            "alter column: nothing to change".into(),
                        ));
                    }
                    ran
                }
                SchemaOp::CreateIndex { table, name, columns, unique } => {
                    let u = if *unique { "UNIQUE " } else { "" };
                    let cols = columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
                    vec![format!(
                        "CREATE {u}INDEX {} ON {} ({cols})",
                        q(name),
                        q(table)
                    )]
                }
                SchemaOp::DropIndex { index } => {
                    vec![format!("DROP INDEX {}", q(index))]
                }
                SchemaOp::DropTrigger { name } => {
                    vec![format!("DROP TRIGGER IF EXISTS {}", q(name))]
                }
                SchemaOp::CreateTrigger { sql } => {
                    let s = sql.trim();
                    if !s.to_uppercase().starts_with("CREATE TRIGGER") {
                        return Err(DbError::InvalidOperation(
                            "trigger SQL must start with CREATE TRIGGER".into(),
                        ));
                    }
                    vec![s.to_string()]
                }
                SchemaOp::SetPrimaryKey { table, columns } => {
                    let pkey = format!("{}_pkey", table);
                    if columns.is_empty() {
                        vec![format!(
                            "ALTER TABLE {} DROP CONSTRAINT IF EXISTS {};",
                            q(table),
                            q(&pkey)
                        )]
                    } else {
                        let cols = columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
                        vec![format!(
                            "ALTER TABLE {} DROP CONSTRAINT IF EXISTS {}, ADD PRIMARY KEY ({cols});",
                            q(table),
                            q(&pkey)
                        )]
                    }
                }
                SchemaOp::AddForeignKey {
                    table,
                    columns,
                    ref_table,
                    ref_columns,
                    on_delete,
                    on_update,
                } => {
                    // Whitelist the referential actions — they are interpolated.
                    const ACTIONS: [&str; 5] =
                        ["CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT", "NO ACTION"];
                    let action = |v: &Option<String>| -> Option<&'static str> {
                        v.as_deref().map(str::trim).and_then(|a| {
                            ACTIONS.iter().find(|k| k.eq_ignore_ascii_case(a)).copied()
                        })
                    };
                    let cols = columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
                    let rcols = ref_columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
                    let mut s = format!(
                        "ALTER TABLE {} ADD CONSTRAINT {} FOREIGN KEY ({cols}) REFERENCES {} ({rcols})",
                        q(table),
                        q(&format!("fk_{}_{}", table, columns.join("_"))),
                        q(ref_table)
                    );
                    if let Some(a) = action(on_delete) {
                        s.push_str(&format!(" ON DELETE {a}"));
                    }
                    if let Some(a) = action(on_update) {
                        s.push_str(&format!(" ON UPDATE {a}"));
                    }
                    s.push(';');
                    vec![s]
                }
                SchemaOp::DropConstraint { table, name } => {
                    vec![format!(
                        "ALTER TABLE {} DROP CONSTRAINT IF EXISTS {};",
                        q(table),
                        q(name)
                    )]
                }
            };
            for st in &stmts {
                sqlx::query(st).execute(&mut *tx).await.map_err(DbError::Sqlite)?;
                executed.push(st.clone());
            }
        }
        tx.commit().await.map_err(DbError::Sqlite)?;
        // DDL may have changed columns/types — drop every cached map so the
        // next write re-introspects.
        self.type_cache.lock().unwrap().clear();
        Ok(executed)
    }

    /// Duplicate a plain table: `LIKE … INCLUDING ALL` copies columns,
    /// defaults, NOT NULL, CHECKs and all indexes (PRIMARY KEY included).
    /// Postgres deliberately excludes FOREIGN KEY constraints from LIKE —
    /// documented limitation, same as pg_dump's --no-owner style copies.
    async fn duplicate_table(&self, source: &str, target: &str) -> DbResult<Vec<String>> {
        let schema = self.cur_schema();
        let kind: Option<String> = sqlx::query_scalar(
            "SELECT CASE c.relkind WHEN 'r' THEN 'table' ELSE NULL END \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relname = $2",
        )
        .bind(&schema)
        .bind(source)
        .fetch_optional(&self.pool)
        .await
        .map_err(DbError::Sqlite)?;
        if kind.is_none() {
            return Err(DbError::InvalidOperation(format!(
                "\"{source}\" is not a plain table — only tables can be duplicated on Postgres"
            )));
        }
        let create = format!(
            "CREATE TABLE {} (LIKE {} INCLUDING ALL)",
            self.tq(target),
            self.tq(source)
        );
        let copy = format!(
            "INSERT INTO {} SELECT * FROM {}",
            self.tq(target),
            self.tq(source)
        );
        sqlx::query(&create)
            .execute(&self.pool)
            .await
            .map_err(DbError::Sqlite)?;
        sqlx::query(&copy)
            .execute(&self.pool)
            .await
            .map_err(DbError::Sqlite)?;
        Ok(vec![format!("{create};"), format!("{copy};")])
    }

    async fn refresh_matview(&self, name: &str) -> DbResult<()> {
        let sql = format!("REFRESH MATERIALIZED VIEW {}", self.tq(name));
        sqlx::query(&sql)
            .execute(&self.pool)
            .await
            .map_err(DbError::Sqlite)?;
        Ok(())
    }

    async fn close(self: Arc<Self>) {
        self.pool.close().await;
    }
}

/// Execute a SELECT whose `?` placeholders are renumbered to `$n`, binding
/// `params` in order, and render every row as text cells.
async fn run_sql_prebound(
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
    let rows = q.fetch_all(pool).await.map_err(DbError::Sqlite)?;
    let columns: Vec<String> = rows
        .first()
        .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
        .unwrap_or_default();
    let out: Vec<Vec<Option<String>>> = rows.iter().map(row_to_vec).collect();
    Ok(QueryResult {
        columns,
        rows: out,
        rows_affected: 0,
        is_select: true,
        error: null_error(),
        elapsed_ms: start.elapsed().as_millis(),
    })
}

fn null_error() -> Option<String> {
    None
}

/// Bind one optional string parameter.
fn bind_str<'q>(
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
fn bind_all<'a>(
    sql: &'a str,
    params: &[Option<String>],
) -> sqlx::query::Query<'a, sqlx::Postgres, sqlx::postgres::PgArguments> {
    let mut q = sqlx::query(sql);
    for p in params {
        q = bind_str(q, p);
    }
    q
}

#[cfg(test)]
mod array_decode_tests {
    use super::{decode_pg_array, fixed_typlen};

    fn i32(v: i32) -> Vec<u8> {
        v.to_be_bytes().to_vec()
    }

    #[test]
    fn varlena_empty_and_values() {
        // {read,write} — varlena (no fixed width), no nulls.
        let mut b = Vec::new();
        b.extend(i32(1)); // ndim
        b.extend(i32(0)); // hasnull
        b.extend(i32(25)); // elem oid = text (varlena)
        b.extend(i32(2)); // nelems
        b.extend(i32(1)); // lower bound
        b.extend(i32(4)); // "read"
        b.extend(b"read");
        b.extend(i32(5)); // "write"
        b.extend(b"write");
        let got = decode_pg_array(&b);
        assert_eq!(got, vec![Some("read".into()), Some("write".into())]);
        assert_eq!(fixed_typlen(25), None);
    }

    #[test]
    fn varlena_with_null() {
        // {read,NULL,admin}
        let mut b = Vec::new();
        b.extend(i32(1));
        b.extend(i32(1)); // hasnull
        b.extend(i32(694124)); // arbitrary enum oid -> varlena
        b.extend(i32(3));
        b.extend(i32(1));
        b.extend(i32(4));
        b.extend(b"read");
        b.extend(i32(-1)); // NULL
        b.extend(i32(5));
        b.extend(b"admin");
        assert_eq!(
            decode_pg_array(&b),
            vec![
                Some("read".into()),
                None,
                Some("admin".into())
            ]
        );
    }

    #[test]
    fn empty_array() {
        // ndim = 0
        let mut b = Vec::new();
        b.extend(i32(0)); // ndim = 0 => empty array
        b.extend(i32(0));
        b.extend(i32(25));
        assert_eq!(decode_pg_array(&b), Vec::<Option<String>>::new());
    }

    #[test]
    fn fixed_width_no_null() {
        // int[] {1,2} -> fixed width 4, packed contiguously.
        let mut b = Vec::new();
        b.extend(i32(1)); // ndim
        b.extend(i32(0)); // hasnull
        b.extend(i32(23)); // int4, width 4
        b.extend(i32(2));
        b.extend(i32(1));
        b.extend(1i32.to_be_bytes());
        b.extend(2i32.to_be_bytes());
        assert_eq!(
            decode_pg_array(&b),
            vec![Some("1".into()), Some("2".into())]
        );
        assert_eq!(fixed_typlen(23), Some(4));
    }

    #[test]
    fn fixed_width_with_null() {
        // int[] {1,NULL} -> width 4, hasnull with length prefixes.
        let mut b = Vec::new();
        b.extend(i32(1));
        b.extend(i32(1)); // hasnull
        b.extend(i32(23));
        b.extend(i32(2));
        b.extend(i32(1));
        b.extend(i32(4)); // len
        b.extend(1i32.to_be_bytes());
        b.extend(i32(-1)); // NULL
        assert_eq!(
            decode_pg_array(&b),
            vec![Some("1".into()), None]
        );
    }
}

