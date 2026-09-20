use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use sqlx::postgres::PgRow;
use sqlx::{
    Column as _,
    Executor as _,
    Row as _,
    Statement as _,
    TypeInfo as _,
    PgPool,
};
use crate::db::{DbError, DbResult};
use super::PgAdapter;

impl PgAdapter {
    /// Column name -> type map for a table in `database`/`schema`, served
    /// from the cache when possible. The map feeds write ops (INSERT casts,
    /// UPDATE/DELETE NULL matching) and would otherwise cost one
    /// information_schema round trip per operation. `pool`/`schema` are the
    /// already-resolved target (see each trait method's own resolution at
    /// its top) — this never reads `self.pool`/`self.cur_schema()` itself,
    /// so a sibling-database caller can't accidentally hit the primary.
    pub(super) async fn column_types_for(
        &self,
        pool: &PgPool,
        database: &str,
        schema: &str,
        table: &str,
    ) -> DbResult<std::collections::HashMap<String, String>> {
        let key = (database.to_string(), schema.to_string(), table.to_string());
        if let Some(hit) = self.type_cache.lock().unwrap().get(&key) {
            return Ok(hit.clone());
        }
        let mut conn = pool.acquire().await.map_err(DbError::SqlEngine)?;
        let types = column_types(&mut conn, schema, table).await?;
        drop(conn);
        self.type_cache
            .lock()
            .unwrap()
            .insert(key, types.clone());
        Ok(types)
    }
}

/// Render one row as text cells for every PostgreSQL type we may meet.
pub(super) fn row_to_vec(r: &PgRow) -> Vec<Option<String>> {
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
                    .map(|b| format!("\\x{}", hex::encode(&b))),
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
    .map_err(DbError::SqlEngine)?;
    Ok(rows.into_iter().collect())
}

/// Column names for `sql`, via Postgres's own Describe step (Parse+Describe,
/// no bound values or fetched rows needed) — independent of whether the
/// statement actually matches any rows. Deriving column names from the
/// first FETCHED row instead (the previous approach here) silently drops
/// every header whenever a query/table genuinely has zero matching rows.
/// Mirrors sqlite.rs's identical `conn.prepare(sql).await?.columns()` trick.
pub(super) async fn describe_columns(pool: &PgPool, sql: &str) -> DbResult<Vec<String>> {
    let mut conn = pool.acquire().await.map_err(DbError::SqlEngine)?;
    let prepared = conn.prepare(sql).await.map_err(DbError::SqlEngine)?;
    Ok(prepared.columns().iter().map(|c| c.name().to_string()).collect())
}

/// Same as `describe_columns`, but on an already-open connection (a
/// transaction) instead of acquiring a fresh one from the pool — needed so
/// the PREPARE step itself resolves unqualified names through the SAME
/// transaction-local search_path `run_sql`'s schema-targeted path just set,
/// not whatever a freshly acquired pool connection happens to have.
pub(super) async fn describe_columns_conn(
    conn: &mut sqlx::PgConnection,
    sql: &str,
) -> DbResult<Vec<String>> {
    let prepared = conn.prepare(sql).await.map_err(DbError::SqlEngine)?;
    Ok(prepared.columns().iter().map(|c| c.name().to_string()).collect())
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
