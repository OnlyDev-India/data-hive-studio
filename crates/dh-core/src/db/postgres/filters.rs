use crate::api::FilterOp;
use super::PgAdapter;
use super::sql_text::q;

impl PgAdapter {
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
            FilterOp::In => {
                if cond.values.is_empty() {
                    "1 = 0".to_string()
                } else {
                    let placeholders = vec!["?"; cond.values.len()].join(", ");
                    for v in &cond.values {
                        params.push(Some(v.clone()));
                    }
                    format!("{col} IN ({placeholders})")
                }
            }
        }
    }

    pub(super) fn where_clause(
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
pub(super) fn build_select(
    schema: &str,
    table: &str,
    filters: &[crate::api::GridFilterCond],
    custom_where: Option<&String>,
    order_by: &[crate::api::OrderByCond],
    limit: Option<i64>,
    offset: Option<i64>,
    params: &mut Vec<Option<String>>,
) -> String {
    let where_sql = PgAdapter::where_clause(filters, custom_where, params);
    let order = if order_by.is_empty() {
        String::new()
    } else {
        format!(
            " ORDER BY {}",
            order_by
                .iter()
                .map(|o| {
                    let dir = if o.dir == "DESC" { "DESC" } else { "ASC" };
                    format!("{} {}", q(&o.column), dir)
                })
                .collect::<Vec<_>>()
                .join(", ")
        )
    };
    let lim = limit.map(|l| format!(" LIMIT {l}")).unwrap_or_default();
    let off = offset.map(|o| format!(" OFFSET {o}")).unwrap_or_default();
    format!(
        "SELECT * FROM {}.{}{where_sql}{order}{lim}{off}",
        q(schema),
        q(table)
    )
}
