//! The value rendering rule (spec 0025, backs AC-13): every cell is read as
//! raw bytes and formatted from its wire format, never decoded through
//! chrono, `i64` or `f64`, so zero dates, unsigned 64 bit integers, wide
//! decimals and out of clock times show exactly as the server stores them.

use sqlx::mysql::{MySqlArguments, MySqlRow};
use sqlx::{Column as _, Executor as _, MySql, MySqlConnection, MySqlPool, Row as _, TypeInfo as _};
use crate::db::{DbError, DbResult};

/// Which protocol a row came in on. Unparameterized runs use the text
/// protocol (the server's own text); prepared statements use the binary one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Wire {
    Text,
    Binary,
}

/// Render one row as text cells.
pub(super) fn row_to_vec(row: &MySqlRow, wire: Wire) -> Vec<Option<String>> {
    (0..row.columns().len()).map(|i| cell(row, i, wire)).collect()
}

fn cell(row: &MySqlRow, i: usize, wire: Wire) -> Option<String> {
    // Not `Option<&[u8]>`: sqlx reads a binary zero date (length 0) as NULL,
    // which is exactly the coercion this rule exists to avoid. A real NULL
    // has no bytes at all, so the plain decode fails only for NULL.
    let bytes: &[u8] = row.try_get_unchecked(i).ok()?;
    let info = row.column(i).type_info();
    let ty = info.name();
    if ty == "BIT" {
        return Some(bit_literal(bytes, bit_width(info)));
    }
    if is_binary_string(ty) {
        return Some(hex(bytes));
    }
    Some(match wire {
        Wire::Text => text(bytes),
        Wire::Binary => binary_value(ty, bytes),
    })
}

/// Whether a string column holds bytes rather than text, so it renders as
/// `0x` hex.
///
/// PENDING spec 0025 amendment (`/architect`): the spec's source is the
/// column's binary charset (63), which sqlx does not expose. The type name
/// below comes from the column's BINARY flag, which MySQL and MariaDB also
/// set on `_bin` collated text columns, so such a column renders as hex here
/// until the spec settles the source.
fn is_binary_string(ty: &str) -> bool {
    matches!(
        ty,
        "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB" | "GEOMETRY"
    )
}

fn text(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        // The session charset is utf8mb4, so the server converts text for
        // us; bytes that still are not UTF-8 are shown as hex, not mangled.
        Err(_) => hex(bytes),
    }
}

pub(super) fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(2 + bytes.len() * 2);
    out.push_str("0x");
    for b in bytes {
        out.push_str(&format!("{b:02X}"));
    }
    out
}

/// `BIT(M)` as `b'...'` with exactly M digits (spec: `BIT(4)` shows
/// `b'0101'`). Both protocols send the value as big endian bytes.
fn bit_literal(bytes: &[u8], width: Option<usize>) -> String {
    let all: String = bytes.iter().map(|b| format!("{b:08b}")).collect();
    let keep = width.unwrap_or(all.len()).clamp(1, all.len().max(1));
    let digits = if all.is_empty() { "0" } else { &all[all.len() - keep.min(all.len())..] };
    format!("b'{digits}'")
}

/// The M in `BIT(M)`. sqlx keeps it private, but prints it in the type's
/// debug form; the unit test below pins that form, so a driver upgrade that
/// changes it fails loudly instead of rendering the wrong width.
fn bit_width(info: &sqlx::mysql::MySqlTypeInfo) -> Option<usize> {
    let debug = format!("{info:?}");
    let rest = debug.split("max_size: Some(").nth(1)?;
    rest.split(')').next()?.parse().ok()
}

/// One binary protocol value as the server would print it.
fn binary_value(ty: &str, b: &[u8]) -> String {
    let unsigned = ty.ends_with("UNSIGNED");
    match ty.trim_end_matches(" UNSIGNED") {
        "BOOLEAN" | "TINYINT" => int_le(b, 1, unsigned),
        "YEAR" => year(b),
        "SMALLINT" => int_le(b, 2, unsigned),
        "INT" | "MEDIUMINT" => int_le(b, 4, unsigned),
        "BIGINT" => int_le(b, 8, unsigned),
        "FLOAT" if b.len() >= 4 => f32::from_le_bytes([b[0], b[1], b[2], b[3]]).to_string(),
        "DOUBLE" if b.len() >= 8 => {
            f64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]).to_string()
        }
        "DATE" => date_time(b, false),
        "DATETIME" | "TIMESTAMP" => date_time(b, true),
        "TIME" => time(b),
        // DECIMAL, JSON, ENUM, SET and text: the bytes are the text.
        _ => text(b),
    }
}

fn int_le(b: &[u8], width: usize, unsigned: bool) -> String {
    let mut buf = [0u8; 8];
    let n = b.len().min(width);
    buf[..n].copy_from_slice(&b[..n]);
    if unsigned {
        return u64::from_le_bytes(buf).to_string();
    }
    // Sign extend from `width` bytes.
    let raw = u64::from_le_bytes(buf);
    let shift = 64 - 8 * width as u32;
    (((raw << shift) as i64) >> shift).to_string()
}

fn year(b: &[u8]) -> String {
    let y = u16::from_le_bytes([b.first().copied().unwrap_or(0), b.get(1).copied().unwrap_or(0)]);
    format!("{y:04}")
}

/// Binary `DATE`/`DATETIME`/`TIMESTAMP`: a length byte (0, 4, 7 or 11), then
/// year (u16), month, day, hour, minute, second and microseconds (u32). A
/// length of 0 is the zero date.
fn date_time(b: &[u8], with_time: bool) -> String {
    let len = b.first().copied().unwrap_or(0) as usize;
    let v = &b[1.min(b.len())..];
    let at = |i: usize| v.get(i).copied().unwrap_or(0);
    let year = if len >= 4 { u16::from_le_bytes([at(0), at(1)]) } else { 0 };
    let (month, day) = if len >= 4 { (at(2), at(3)) } else { (0, 0) };
    let date = format!("{year:04}-{month:02}-{day:02}");
    if !with_time {
        return date;
    }
    let (h, m, s) = if len >= 7 { (at(4), at(5), at(6)) } else { (0, 0, 0) };
    let micros = if len >= 11 { u32::from_le_bytes([at(7), at(8), at(9), at(10)]) } else { 0 };
    format!("{date} {h:02}:{m:02}:{s:02}{}", fraction(micros))
}

/// Binary `TIME`: a length byte (0, 8 or 12), sign, days (u32), hours,
/// minutes, seconds and microseconds. Days fold into hours, so
/// `-838:59:59` comes back as written.
fn time(b: &[u8]) -> String {
    let len = b.first().copied().unwrap_or(0) as usize;
    let v = &b[1.min(b.len())..];
    let at = |i: usize| v.get(i).copied().unwrap_or(0);
    if len < 8 {
        return "00:00:00".into();
    }
    let negative = at(0) == 1;
    let days = u32::from_le_bytes([at(1), at(2), at(3), at(4)]);
    let hours = days * 24 + at(5) as u32;
    let micros = if len >= 12 { u32::from_le_bytes([at(8), at(9), at(10), at(11)]) } else { 0 };
    format!(
        "{}{hours:02}:{:02}:{:02}{}",
        if negative { "-" } else { "" },
        at(6),
        at(7),
        fraction(micros)
    )
}

/// Fractional seconds without trailing zeros (the binary protocol does not
/// carry the column's precision).
fn fraction(micros: u32) -> String {
    if micros == 0 {
        return String::new();
    }
    let digits = format!("{micros:06}");
    format!(".{}", digits.trim_end_matches('0'))
}

/// Run a catalog read on a pooled connection and render every row through
/// the same rule, so `information_schema` columns (some of which MySQL 8
/// flags as binary) never fail a typed decode. Prepared when it has
/// `params`.
pub(super) async fn fetch_text(pool: &MySqlPool, sql: &str, params: &[&str]) -> DbResult<Vec<Vec<Option<String>>>> {
    let mut conn = pool.acquire().await.map_err(DbError::SqlEngine)?;
    fetch_text_conn(&mut conn, sql, params).await
}

/// [`fetch_text`] on a connection the caller already holds.
pub(super) async fn fetch_text_conn(
    conn: &mut MySqlConnection,
    sql: &str,
    params: &[&str],
) -> DbResult<Vec<Vec<Option<String>>>> {
    let rows: Vec<MySqlRow> = if params.is_empty() {
        (&mut *conn).fetch_all(sql).await
    } else {
        let mut q = sqlx::query::<MySql>(sql);
        for p in params {
            q = q.bind(p.to_string());
        }
        q.fetch_all(&mut *conn).await
    }
    .map_err(DbError::SqlEngine)?;
    let wire = if params.is_empty() { Wire::Text } else { Wire::Binary };
    Ok(rows.iter().map(|r| catalog_row(r, wire)).collect())
}

/// Catalog rows hold names and text, never real binary data: always UTF-8.
fn catalog_row(row: &MySqlRow, wire: Wire) -> Vec<Option<String>> {
    (0..row.columns().len())
        .map(|i| {
            let bytes: &[u8] = row.try_get_unchecked(i).ok()?;
            let ty = row.column(i).type_info().name();
            Some(match wire {
                Wire::Binary if !is_binary_string(ty) => binary_value(ty, bytes),
                _ => String::from_utf8_lossy(bytes).into_owned(),
            })
        })
        .collect()
}

/// Bind string parameters the grid and builders send (`None` is NULL).
pub(super) fn bind_all<'q>(
    sql: &'q str,
    params: &[Option<String>],
) -> sqlx::query::Query<'q, MySql, MySqlArguments> {
    let mut q = sqlx::query(sql);
    for p in params {
        q = q.bind(p.clone());
    }
    q
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integers_keep_their_full_range() {
        assert_eq!(int_le(&u64::MAX.to_le_bytes(), 8, true), "18446744073709551615");
        assert_eq!(int_le(&(-5i64).to_le_bytes(), 8, false), "-5");
        assert_eq!(int_le(&[0xFF], 1, false), "-1");
        assert_eq!(int_le(&[0xFF], 1, true), "255");
        assert_eq!(int_le(&(-300i32).to_le_bytes(), 4, false), "-300");
        assert_eq!(int_le(&(-2i16).to_le_bytes(), 2, false), "-2");
    }

    #[test]
    fn zero_dates_show_as_written() {
        assert_eq!(date_time(&[0], false), "0000-00-00");
        assert_eq!(date_time(&[0], true), "0000-00-00 00:00:00");
        // 2024-02-29 13:05:09.120000
        let mut b = vec![11, 0xE8, 0x07, 2, 29, 13, 5, 9];
        b.extend(120_000u32.to_le_bytes());
        assert_eq!(date_time(&b, true), "2024-02-29 13:05:09.12");
        assert_eq!(date_time(&[4, 0xE8, 0x07, 2, 29], false), "2024-02-29");
        // `YYYY-00-00` style partial dates keep their zeros.
        assert_eq!(date_time(&[4, 0xE8, 0x07, 0, 0], false), "2024-00-00");
    }

    #[test]
    fn time_beyond_a_day_is_exact() {
        // -838:59:59 is 34 days and 22 hours.
        let mut b = vec![8, 1];
        b.extend(34u32.to_le_bytes());
        b.extend([22, 59, 59]);
        assert_eq!(time(&b), "-838:59:59");
        assert_eq!(time(&[0]), "00:00:00");
    }

    #[test]
    fn bits_render_with_the_column_width() {
        assert_eq!(bit_literal(&[0b0101], Some(4)), "b'0101'");
        assert_eq!(bit_literal(&[0x01, 0x00], Some(9)), "b'100000000'");
        assert_eq!(bit_literal(&[0b0101], None), "b'00000101'");
    }

    #[test]
    fn binary_bytes_render_as_hex() {
        assert_eq!(hex(&[0xDE, 0xAD, 0x00]), "0xDEAD00");
        assert_eq!(hex(&[]), "0x");
    }

    #[test]
    fn decimals_and_years_keep_the_server_text() {
        let wide = "12345678901234567890123456789012345.123456789012345678901234567890";
        assert_eq!(binary_value("DECIMAL", wide.as_bytes()), wide);
        assert_eq!(binary_value("YEAR", &0u16.to_le_bytes()), "0000");
        assert_eq!(binary_value("YEAR", &2024u16.to_le_bytes()), "2024");
        assert_eq!(binary_value("BIGINT UNSIGNED", &u64::MAX.to_le_bytes()), "18446744073709551615");
    }

    /// Pins the debug form `bit_width` reads, so a driver upgrade that
    /// changes it fails here.
    #[test]
    fn the_bit_width_is_read_from_the_type_debug_form() {
        let info = <&[u8] as sqlx::Type<MySql>>::type_info();
        assert!(format!("{info:?}").contains("max_size: None"), "{info:?}");
        assert_eq!(bit_width(&info), None);
    }
}
