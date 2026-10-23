use crate::api::{FilterOp, GridFilterCond};
use super::bytes::{bit_slot, TableColumns, JSON_SLOT};
use super::sql_text::q;

/// One grid filter as a WHERE fragment with `?` placeholders. Values are
/// always bound, never interpolated. `LIKE` follows the column's own
/// collation, which is case insensitive on the usual `_ci` ones (MySQL has
/// no `ILIKE`). A `BIT` column compares the number its value spells, and
/// equality on a MySQL `JSON` column compares JSON values (the BIT and JSON
/// comparison rule); the column side stays bare so an index still applies.
fn filter_sql(cond: &GridFilterCond, cols: &TableColumns, params: &mut Vec<Option<String>>) -> String {
    let col = q(&cond.column);
    let (bit, json) = (cols.is_bit(&cond.column), cols.is_json(&cond.column));
    let slot = |value: &str, equality: bool| -> (&'static str, String) {
        if bit {
            bit_slot(value)
        } else if json && equality {
            (JSON_SLOT, value.to_string())
        } else {
            ("?", value.to_string())
        }
    };
    let v = cond.value.as_str();
    let mut bound = |(mark, value): (&str, String), op: &str| {
        params.push(Some(value));
        format!("{col} {op} {mark}")
    };
    match cond.op {
        FilterOp::Eq => bound(slot(v, true), "="),
        FilterOp::Neq => bound(slot(v, true), "<>"),
        FilterOp::Contains => bound(("?", format!("%{v}%")), "LIKE"),
        FilterOp::StartsWith => bound(("?", format!("{v}%")), "LIKE"),
        FilterOp::EndsWith => bound(("?", format!("%{v}")), "LIKE"),
        FilterOp::Gt => bound(slot(v, false), ">"),
        FilterOp::Gte => bound(slot(v, false), ">="),
        FilterOp::Lt => bound(slot(v, false), "<"),
        FilterOp::Lte => bound(slot(v, false), "<="),
        FilterOp::IsNull => format!("{col} IS NULL"),
        FilterOp::IsNotNull => format!("{col} IS NOT NULL"),
        FilterOp::In => {
            if cond.values.is_empty() {
                "1 = 0".to_string()
            } else {
                let marks: Vec<&str> = cond
                    .values
                    .iter()
                    .map(|value| {
                        let (mark, value) = slot(value, true);
                        params.push(Some(value));
                        mark
                    })
                    .collect();
                format!("{col} IN ({})", marks.join(", "))
            }
        }
    }
}

/// The grid's WHERE. `cols` is the table's catalog, read on the same
/// connection before this is built; an empty one (a failed lookup) leaves
/// every filter as a plain `?`.
pub(super) fn where_clause(
    filters: &[GridFilterCond],
    custom_where: Option<&String>,
    cols: &TableColumns,
    params: &mut Vec<Option<String>>,
) -> String {
    let mut joined = String::new();
    for f in filters {
        let part = filter_sql(f, cols, params);
        if joined.is_empty() {
            joined = part;
        } else {
            let or = f.conjunction.as_deref().is_some_and(|c| c.eq_ignore_ascii_case("OR"));
            joined = format!("{joined} {} {part}", if or { "OR" } else { "AND" });
        }
    }
    let mut parts: Vec<String> = Vec::new();
    if !joined.is_empty() {
        parts.push(if filters.len() > 1 && custom_where.is_some_and(|w| !w.trim().is_empty()) {
            format!("({joined})")
        } else {
            joined
        });
    }
    if let Some(w) = custom_where.filter(|w| !w.trim().is_empty()) {
        parts.push(format!("({w})"));
    }
    if parts.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", parts.join(" AND "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn cond(column: &str, op: FilterOp, value: &str) -> GridFilterCond {
        GridFilterCond { column: column.into(), op, value: value.into(), values: vec![], conjunction: None }
    }

    #[test]
    fn filters_bind_their_values() {
        let mut params = Vec::new();
        let sql = where_clause(
            &[cond("name", FilterOp::Contains, "ab"), cond("deleted_at", FilterOp::IsNull, "")],
            Some(&"`id` > 3".to_string()),
            &TableColumns::default(),
            &mut params,
        );
        assert_eq!(sql, " WHERE (`name` LIKE ? AND `deleted_at` IS NULL) AND (`id` > 3)");
        assert_eq!(params, vec![Some("%ab%".to_string())]);
    }

    #[test]
    fn an_or_conjunction_joins_with_or() {
        let mut params = Vec::new();
        let mut second = cond("b", FilterOp::Eq, "2");
        second.conjunction = Some("or".into());
        let sql = where_clause(&[cond("a", FilterOp::Eq, "1"), second], None, &TableColumns::default(), &mut params);
        assert_eq!(sql, " WHERE `a` = ? OR `b` = ?");
    }

    fn bit_and_json() -> TableColumns {
        TableColumns {
            bits: HashSet::from(["b".to_string()]),
            json: HashSet::from(["j".to_string()]),
            ..TableColumns::default()
        }
    }

    fn one(c: GridFilterCond) -> (String, Vec<Option<String>>) {
        let mut params = Vec::new();
        let sql = where_clause(&[c], None, &bit_and_json(), &mut params);
        (sql, params)
    }

    fn texts(v: &[&str]) -> Vec<Option<String>> {
        v.iter().map(|s| Some(s.to_string())).collect()
    }

    #[test]
    fn a_bit_filter_compares_the_number_its_value_spells() {
        assert_eq!(one(cond("B", FilterOp::Eq, "b'0101'")), (" WHERE `B` = CAST(? AS UNSIGNED)".into(), texts(&["5"])));
        assert_eq!(one(cond("b", FilterOp::Gt, "b'0100'")), (" WHERE `b` > CAST(? AS UNSIGNED)".into(), texts(&["4"])));
        assert_eq!(one(cond("b", FilterOp::Lte, "5")), (" WHERE `b` <= CAST(? AS UNSIGNED)".into(), texts(&["5"])));
        // Not a number: bound as typed, so it finds nothing.
        assert_eq!(one(cond("b", FilterOp::Neq, "x")), (" WHERE `b` <> ?".into(), texts(&["x"])));
        let mut list = cond("b", FilterOp::In, "");
        list.values = vec!["b'0101'".into(), "x".into()];
        assert_eq!(one(list), (" WHERE `b` IN (CAST(? AS UNSIGNED), ?)".into(), texts(&["5", "x"])));
        // The text filters keep comparing text.
        assert_eq!(one(cond("b", FilterOp::Contains, "01")), (" WHERE `b` LIKE ?".into(), texts(&["%01%"])));
    }

    #[test]
    fn json_equality_compares_json_values_and_the_rest_stays_text() {
        let doc = r#"{"a": [1, 2]}"#;
        assert_eq!(one(cond("j", FilterOp::Eq, doc)), (" WHERE `j` = CAST(? AS JSON)".into(), texts(&[doc])));
        assert_eq!(one(cond("j", FilterOp::Neq, "1")), (" WHERE `j` <> CAST(? AS JSON)".into(), texts(&["1"])));
        let mut list = cond("j", FilterOp::In, "");
        list.values = vec!["[]".into(), "null".into()];
        assert_eq!(one(list), (" WHERE `j` IN (CAST(? AS JSON), CAST(? AS JSON))".into(), texts(&["[]", "null"])));
        assert_eq!(one(cond("j", FilterOp::Gt, "1")), (" WHERE `j` > ?".into(), texts(&["1"])));
        assert_eq!(one(cond("j", FilterOp::StartsWith, "{")), (" WHERE `j` LIKE ?".into(), texts(&["{%"])));
        // Any other column is untouched.
        assert_eq!(one(cond("note", FilterOp::Eq, "b'0101'")), (" WHERE `note` = ?".into(), texts(&["b'0101'"])));
    }
}
