use crate::api::{FilterOp, GridFilterCond};
use super::sql_text::q;

/// One grid filter as a WHERE fragment with `?` placeholders. Values are
/// always bound, never interpolated. `LIKE` follows the column's own
/// collation, which is case insensitive on the usual `_ci` ones (MySQL has
/// no `ILIKE`).
fn filter_sql(cond: &GridFilterCond, params: &mut Vec<Option<String>>) -> String {
    let col = q(&cond.column);
    let v = cond.value.clone();
    let mut bound = |value: String, op: &str| {
        params.push(Some(value));
        format!("{col} {op} ?")
    };
    match cond.op {
        FilterOp::Eq => bound(v, "="),
        FilterOp::Neq => bound(v, "<>"),
        FilterOp::Contains => bound(format!("%{v}%"), "LIKE"),
        FilterOp::StartsWith => bound(format!("{v}%"), "LIKE"),
        FilterOp::EndsWith => bound(format!("%{v}"), "LIKE"),
        FilterOp::Gt => bound(v, ">"),
        FilterOp::Gte => bound(v, ">="),
        FilterOp::Lt => bound(v, "<"),
        FilterOp::Lte => bound(v, "<="),
        FilterOp::IsNull => format!("{col} IS NULL"),
        FilterOp::IsNotNull => format!("{col} IS NOT NULL"),
        FilterOp::In => {
            if cond.values.is_empty() {
                "1 = 0".to_string()
            } else {
                params.extend(cond.values.iter().cloned().map(Some));
                format!("{col} IN ({})", vec!["?"; cond.values.len()].join(", "))
            }
        }
    }
}

pub(super) fn where_clause(
    filters: &[GridFilterCond],
    custom_where: Option<&String>,
    params: &mut Vec<Option<String>>,
) -> String {
    let mut joined = String::new();
    for f in filters {
        let part = filter_sql(f, params);
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

    fn cond(column: &str, op: FilterOp, value: &str) -> GridFilterCond {
        GridFilterCond { column: column.into(), op, value: value.into(), values: vec![], conjunction: None }
    }

    #[test]
    fn filters_bind_their_values() {
        let mut params = Vec::new();
        let sql = where_clause(
            &[cond("name", FilterOp::Contains, "ab"), cond("deleted_at", FilterOp::IsNull, "")],
            Some(&"`id` > 3".to_string()),
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
        let sql = where_clause(&[cond("a", FilterOp::Eq, "1"), second], None, &mut params);
        assert_eq!(sql, " WHERE `a` = ? OR `b` = ?");
    }
}
