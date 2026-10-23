//! The binary column rule (spec 0025, amended 2026-10-15; backs AC-13).
//! sqlx keeps each result column's charset private and exposes only the
//! BINARY flag, which MySQL and MariaDB also set on `_bin` collated text and
//! on MariaDB `JSON`. So bytes versus text is decided from two sources: the
//! catalog, for a read the app built against a known table, and a per cell
//! UTF-8 check for every other read.

use std::collections::HashSet;
use sqlx::MySqlConnection;
use super::rows::fetch_text_conn;

/// `information_schema.COLUMNS.DATA_TYPE` values that hold bytes: the binary
/// string and blob types, and every spatial type.
pub(super) const BYTES_TYPES: &[&str] = &[
    "binary", "varbinary", "tinyblob", "blob", "mediumblob", "longblob",
    "geometry", "point", "linestring", "polygon", "multipoint", "multilinestring",
    "multipolygon", "geometrycollection", "geomcollection",
];

/// How a read decides bytes versus text for each cell.
#[derive(Debug, Clone, Copy)]
pub(super) enum BytesRule<'a> {
    /// No known table: `GEOMETRY` is bytes, any other cell is bytes only
    /// when it isn't valid UTF-8. Decided per cell, so a column can mix.
    Fallback,
    /// A read against a known table: these columns (lowercased names) hold
    /// bytes, everything else is text.
    Catalog(&'a HashSet<String>),
}

impl BytesRule<'_> {
    /// Per result column: `Some(true)` bytes, `Some(false)` text, `None`
    /// decide per cell. Result columns match the catalog by name.
    pub(super) fn mask(&self, names: &[String]) -> Vec<Option<bool>> {
        match self {
            BytesRule::Fallback => vec![None; names.len()],
            BytesRule::Catalog(set) => names.iter().map(|n| Some(set.contains(&n.to_lowercase()))).collect(),
        }
    }
}

/// What the catalog says about one table's columns (lowercased names).
#[derive(Debug, Default, Clone)]
pub(super) struct TableColumns {
    /// Columns that hold bytes (the binary column rule).
    pub(super) bytes: HashSet<String>,
    /// `FLOAT` and `DOUBLE` columns: a full row match compares them as text.
    pub(super) approx: HashSet<String>,
    /// `BIT` columns: compared and written by the number their `b'...'`
    /// text spells.
    pub(super) bits: HashSet<String>,
    /// MySQL `JSON` columns: matched by JSON value. MariaDB reports its
    /// `JSON` as `longtext`, so it never lands here.
    pub(super) json: HashSet<String>,
    /// The `AUTO_INCREMENT` column, if any, as the catalog spells it.
    pub(super) auto_increment: Option<String>,
}

impl TableColumns {
    pub(super) fn is_bytes(&self, col: &str) -> bool {
        self.bytes.contains(&col.to_lowercase())
    }

    pub(super) fn is_approx(&self, col: &str) -> bool {
        self.approx.contains(&col.to_lowercase())
    }

    pub(super) fn is_bit(&self, col: &str) -> bool {
        self.bits.contains(&col.to_lowercase())
    }

    pub(super) fn is_json(&self, col: &str) -> bool {
        self.json.contains(&col.to_lowercase())
    }
}

/// The columns of `table` in the connection's current database, read on
/// `conn` just before the read or write so an `ALTER` anywhere is seen at
/// once (never cached). `None` when the lookup fails or finds no such table
/// (a missing privilege, a table dropped meanwhile): the caller falls back,
/// and the statement itself never fails because of it.
pub(super) async fn table_columns(conn: &mut MySqlConnection, table: &str) -> Option<TableColumns> {
    let sql = "SELECT COLUMN_NAME, DATA_TYPE, EXTRA FROM information_schema.COLUMNS \
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?";
    let rows = match fetch_text_conn(conn, sql, &[table]).await {
        Ok(rows) => rows,
        Err(e) => {
            log::warn!("mysql column lookup failed, using the fallback: {e}");
            return None;
        }
    };
    if rows.is_empty() {
        return None;
    }
    Some(classify(&rows))
}

fn classify(rows: &[Vec<Option<String>>]) -> TableColumns {
    let mut out = TableColumns::default();
    for r in rows {
        let Some(name) = r.first().and_then(|v| v.as_deref()) else { continue };
        let ty = r.get(1).and_then(|v| v.as_deref()).unwrap_or("").to_ascii_lowercase();
        let extra = r.get(2).and_then(|v| v.as_deref()).unwrap_or("").to_ascii_lowercase();
        if BYTES_TYPES.contains(&ty.as_str()) {
            out.bytes.insert(name.to_lowercase());
        }
        match ty.as_str() {
            "float" | "double" => {
                out.approx.insert(name.to_lowercase());
            }
            "bit" => {
                out.bits.insert(name.to_lowercase());
            }
            "json" => {
                out.json.insert(name.to_lowercase());
            }
            _ => {}
        }
        if extra.contains("auto_increment") {
            out.auto_increment = Some(name.to_string());
        }
    }
    out
}

/// One bound parameter. Bytes go to the server as a binary parameter, so
/// no charset conversion touches them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Param {
    Text(Option<String>),
    Bytes(Vec<u8>),
}

impl Param {
    /// Every value as text: filters, and every statement with no known
    /// table.
    pub(super) fn texts(values: &[Option<String>]) -> Vec<Param> {
        values.iter().cloned().map(Param::Text).collect()
    }
}

/// The binding rule for binary columns (backs AC-14, AC-21): in a bytes
/// column, `0x` followed by pairs of hex digits binds as those bytes and
/// any other value as its UTF-8 bytes. A text column binds the text as
/// typed, so `0x41` typed into a `VARCHAR` stores those four characters.
pub(super) fn bind_value(value: &Option<String>, is_bytes: bool) -> Param {
    match value {
        Some(text) if is_bytes => Param::Bytes(hex_literal(text).unwrap_or_else(|| text.as_bytes().to_vec())),
        _ => Param::Text(value.clone()),
    }
}

/// The placeholder a MySQL `JSON` column compares through, so the shown
/// text is matched as a JSON value rather than as a JSON string.
pub(super) const JSON_SLOT: &str = "CAST(? AS JSON)";

/// A `BIT` column's value (the BIT and JSON comparison rule): the number
/// its text spells, as decimal text in `CAST(? AS UNSIGNED)`, or the text
/// as typed in a plain `?` when it spells none (a write then gets the
/// server's error, a match or filter finds nothing).
pub(super) fn bit_slot(text: &str) -> (&'static str, String) {
    match bit_number(text) {
        Some(n) => ("CAST(? AS UNSIGNED)", n.to_string()),
        None => ("?", text.to_string()),
    }
}

/// `^[bB]'[01]{1,64}'$` read as base 2, or `^[0-9]+$` that fits in 64 bits
/// unsigned.
pub(super) fn bit_number(text: &str) -> Option<u64> {
    let digits = text
        .strip_prefix("b'")
        .or_else(|| text.strip_prefix("B'"))
        .and_then(|rest| rest.strip_suffix('\''));
    match digits {
        Some(d) if (1..=64).contains(&d.len()) && d.bytes().all(|b| b == b'0' || b == b'1') => {
            u64::from_str_radix(d, 2).ok()
        }
        Some(_) => None,
        None if !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit()) => text.parse().ok(),
        None => None,
    }
}

/// `^0x([0-9A-Fa-f]{2})*$` (case insensitive `0x`) decoded.
fn hex_literal(text: &str) -> Option<Vec<u8>> {
    let digits = text.strip_prefix("0x").or_else(|| text.strip_prefix("0X"))?;
    if digits.len() % 2 != 0 || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    (0..digits.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&digits[i..i + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(name: &str, ty: &str, extra: &str) -> Vec<Option<String>> {
        vec![Some(name.into()), Some(ty.into()), Some(extra.into())]
    }

    #[test]
    fn only_binary_blob_and_spatial_types_hold_bytes() {
        let cols = classify(&[
            row("Raw", "VARBINARY", ""),
            row("pic", "longblob", ""),
            row("spot", "point", ""),
            row("code", "varchar", ""),
            row("doc", "longtext", ""),
            row("j", "json", ""),
        ]);
        assert_eq!(cols.bytes, HashSet::from(["raw".to_string(), "pic".to_string(), "spot".to_string()]));
    }

    #[test]
    fn floats_and_the_auto_increment_column_are_found() {
        let cols = classify(&[
            row("Id", "int", "auto_increment"),
            row("f", "float", ""),
            row("d", "double", ""),
            row("n", "decimal", ""),
            row("at", "timestamp", "DEFAULT_GENERATED on update CURRENT_TIMESTAMP"),
        ]);
        assert_eq!(cols.approx, HashSet::from(["f".to_string(), "d".to_string()]));
        assert_eq!(cols.auto_increment.as_deref(), Some("Id"));
    }

    #[test]
    fn bit_and_json_columns_are_found() {
        let cols = classify(&[row("B", "bit", ""), row("j", "json", ""), row("m", "longtext", "")]);
        assert!(cols.is_bit("b") && cols.is_json("J"));
        assert!(!cols.is_json("m"));
    }

    #[test]
    fn a_bit_value_reads_the_shown_form_or_a_plain_number() {
        assert_eq!(bit_slot("b'0101'"), ("CAST(? AS UNSIGNED)", "5".to_string()));
        assert_eq!(bit_slot("B'1'"), ("CAST(? AS UNSIGNED)", "1".to_string()));
        assert_eq!(bit_slot("9"), ("CAST(? AS UNSIGNED)", "9".to_string()));
        assert_eq!(bit_slot("007"), ("CAST(? AS UNSIGNED)", "7".to_string()));
        let max = format!("b'{}'", "1".repeat(64));
        assert_eq!(bit_slot(&max).1, u64::MAX.to_string());
        assert_eq!(bit_slot("18446744073709551615").1, u64::MAX.to_string());
        // Anything else goes as typed.
        for typed in ["abc", "b''", "b'012'", "b'0101", "-1", "18446744073709551616", "", "1.5"] {
            assert_eq!(bit_slot(typed), ("?", typed.to_string()), "{typed}");
        }
        assert_eq!(bit_slot(&format!("b'{}'", "1".repeat(65))).0, "?");
    }

    #[test]
    fn a_bytes_column_binds_hex_pairs_as_bytes_and_anything_else_as_utf8() {
        let bytes = |v: &str| bind_value(&Some(v.into()), true);
        assert_eq!(bytes("0xDEAD"), Param::Bytes(vec![0xDE, 0xAD]));
        assert_eq!(bytes("0Xdead"), Param::Bytes(vec![0xDE, 0xAD]));
        assert_eq!(bytes("0x"), Param::Bytes(vec![]));
        assert_eq!(bytes("abc"), Param::Bytes(b"abc".to_vec()));
        assert_eq!(bytes("0xABC"), Param::Bytes(b"0xABC".to_vec()));
        assert_eq!(bytes("0xZZ"), Param::Bytes(b"0xZZ".to_vec()));
        assert_eq!(bind_value(&None, true), Param::Text(None));
        // A text column keeps the text as typed.
        assert_eq!(bind_value(&Some("0x41".into()), false), Param::Text(Some("0x41".into())));
    }

    #[test]
    fn the_mask_matches_result_columns_by_name() {
        let set = HashSet::from(["raw".to_string()]);
        let names = vec!["id".to_string(), "RAW".to_string()];
        assert_eq!(BytesRule::Catalog(&set).mask(&names), vec![Some(false), Some(true)]);
        assert_eq!(BytesRule::Fallback.mask(&names), vec![None, None]);
    }
}
