use std::time::Instant;
use crate::api::{FilterOp, GridFilterCond, QueryOp, QueryResult};
use crate::db::{BuiltQuery, DbError, DbResult};
use super::SqliteAdapter;
use super::schema_ops::quote_ident;

impl SqliteAdapter {
    /// The single place query creation happens: turn structured operation
    /// details into SQLite SQL with bound `?` parameters. Adding support for
    /// a new database means implementing this per adapter — UI code never
    /// writes SQL itself.
    pub fn build_query(&self, op: &QueryOp) -> DbResult<BuiltQuery> {
        self.build_query_inner(op)
    }

    fn build_query_inner(&self, op: &QueryOp) -> DbResult<BuiltQuery> {
        match op {
            QueryOp::Select { table, filters, custom_where, order_by, limit, offset } => {
                let mut sql = format!("SELECT * FROM {}", quote_ident(table));
                let params = apply_where(&mut sql, filters, custom_where.as_deref());
                if !order_by.is_empty() {
                    let clauses: Vec<String> = order_by
                        .iter()
                        .map(|o| {
                            format!(
                                "{} {}",
                                quote_ident(&o.column),
                                order_direction(Some(o.dir.as_str()))
                            )
                        })
                        .collect();
                    sql.push_str(&format!(" ORDER BY {}", clauses.join(", ")));
                }
                if let Some(l) = limit {
                    sql.push_str(&format!(" LIMIT {l}"));
                }
                if let Some(o) = offset {
                    sql.push_str(&format!(" OFFSET {o}"));
                }
                Ok(BuiltQuery { sql, params })
            }
            QueryOp::Count { table, filters, custom_where } => {
                let mut sql = format!("SELECT COUNT(*) FROM {}", quote_ident(table));
                let params = apply_where(&mut sql, filters, custom_where.as_deref());
                Ok(BuiltQuery { sql, params })
            }
            QueryOp::BulkUpdate { table, column, value, filters, custom_where } => {
                let mut sql = format!("UPDATE {} SET {} = ?", quote_ident(table), quote_ident(column));
                let mut params = vec![value.clone()];
                params.extend(apply_where(&mut sql, filters, custom_where.as_deref()));
                Ok(BuiltQuery { sql, params })
            }
            QueryOp::SelectDistinct { table, column, limit } => {
                let mut sql = format!(
                    "SELECT DISTINCT {c} FROM {t} WHERE {c} IS NOT NULL ORDER BY 1",
                    c = quote_ident(column),
                    t = quote_ident(table),
                );
                if let Some(l) = limit {
                    sql.push_str(&format!(" LIMIT {l}"));
                }
                Ok(BuiltQuery { sql, params: Vec::new() })
            }
            QueryOp::Insert { table, values, skip_empty } => {
                // BTreeMap iterates in sorted key order, keeping the column
                // list and the parameter vector aligned.
                let entries: Vec<(&String, &Option<String>)> = values
                    .iter()
                    .filter(|(_, v)| !skip_empty || v.as_deref().is_some_and(|s| !s.is_empty()))
                    .collect();
                if entries.is_empty() {
                    return Ok(BuiltQuery {
                        sql: format!("INSERT INTO {} DEFAULT VALUES", quote_ident(table)),
                        params: Vec::new(),
                    });
                }
                let cols = entries.iter().map(|(c, _)| quote_ident(c)).collect::<Vec<_>>().join(", ");
                let marks = entries.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
                Ok(BuiltQuery {
                    sql: format!(
                        "INSERT INTO {} ({}) VALUES ({})",
                        quote_ident(table),
                        cols,
                        marks
                    ),
                    params: entries.iter().map(|(_, v)| (*v).clone()).collect(),
                })
            }
            QueryOp::Update { table, set, match_row } => {
                let sets = set.iter().map(|(c, _)| format!("{} = ?", quote_ident(c)))
                    .collect::<Vec<_>>()
                    .join(", ");
                let mut sql = format!("UPDATE {} SET {}", quote_ident(table), sets);
                let mut params: Vec<Option<String>> = set.values().cloned().collect();
                append_match_row(&mut sql, match_row, &mut params)?;
                Ok(BuiltQuery { sql, params })
            }
            QueryOp::Delete { table, match_row } => {
                let mut sql = format!("DELETE FROM {}", quote_ident(table));
                let mut params = Vec::new();
                append_match_row(&mut sql, match_row, &mut params)?;
                Ok(BuiltQuery { sql, params })
            }
            QueryOp::DropTable { table } => Ok(BuiltQuery {
                sql: format!("DROP TABLE {}", quote_ident(table)),
                params: Vec::new(),
            }),
        }
    }

    /// Execute a structured operation: build the SQL via [`Self::build_query`]
    /// and run it. Reads return rows; writes return the affected count.
    pub async fn execute_op(&self, op: &QueryOp) -> DbResult<super::OpOutcome> {
        let start = Instant::now();
        let q = self.build_query(op)?;
        let sql = Some(super::inline_placeholders(&q.sql, &q.params, false) + ";");
        match op {
            QueryOp::Select { .. } | QueryOp::Count { .. } | QueryOp::SelectDistinct { .. } => {
                let result = self.run_sql_params(&q.sql, &q.params).await?;
                Ok(super::OpOutcome { result, sql })
            }
            _ => {
                let rows_affected = self.execute_params(&q.sql, &q.params).await?;
                Ok(super::OpOutcome {
                    result: QueryResult {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        rows_affected,
                        is_select: false,
                        error: None,
                        elapsed_ms: start.elapsed().as_millis(),
                        cancelled: false,
                    },
                    sql,
                })
            }
        }
    }
}

/// Bind value for an equality/comparison filter: the UI treats an empty
/// string as "no value", which binds NULL.
fn bind_value(v: &str) -> Option<String> {
    if v.is_empty() { None } else { Some(v.to_string()) }
}

/// Escape LIKE wildcards in user input; used with `ESCAPE '\'`.
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

/// ASC/DESC keyword from an optional direction string (defaults to ASC).
fn order_direction(dir: Option<&str>) -> &'static str {
    if dir.is_some_and(|d| d.eq_ignore_ascii_case("desc")) { "DESC" } else { "ASC" }
}

/// Append a WHERE clause matching every column of a stored row: `col = ?`
/// for values, `col IS NULL` for NULLs (plain `= NULL` never matches). The
/// full row is matched instead of just the primary key so the target stays
/// correct even when the user edits key columns, and tables without any
/// primary key remain editable.
fn append_match_row(
    sql: &mut String,
    row: &std::collections::BTreeMap<String, Option<String>>,
    params: &mut Vec<Option<String>>,
) -> DbResult<()> {
    if row.is_empty() {
        return Err(DbError::InvalidOperation(
            "operation needs at least one column to match".into(),
        ));
    }
    let parts = row
        .iter()
        .map(|(c, v)| match v {
            Some(_) => {
                params.push(v.clone());
                format!("{} = ?", quote_ident(c))
            }
            None => format!("{} IS NULL", quote_ident(c)),
        })
        .collect::<Vec<_>>()
        .join(" AND ");
    sql.push_str(" WHERE ");
    sql.push_str(&parts);
    Ok(())
}

/// Append the WHERE clause to `sql` from UI filters (or the user's raw WHERE
/// text, which wins when both are present) and return the bound parameters.
fn apply_where(
    sql: &mut String,
    filters: &[GridFilterCond],
    custom_where: Option<&str>,
) -> Vec<Option<String>> {
    let mut parts: Vec<String> = Vec::new();
    let mut params: Vec<Option<String>> = Vec::new();
    for f in filters {
        let col = quote_ident(&f.column);
        let part = match f.op {
            FilterOp::Eq => {
                params.push(bind_value(&f.value));
                format!("{col} = ?")
            }
            FilterOp::Neq => {
                params.push(bind_value(&f.value));
                format!("{col} != ?")
            }
            FilterOp::Contains => {
                params.push(Some(format!("%{}%", escape_like(&f.value))));
                format!("{col} LIKE ? ESCAPE '\\'")
            }
            FilterOp::StartsWith => {
                params.push(Some(format!("{}%", escape_like(&f.value))));
                format!("{col} LIKE ? ESCAPE '\\'")
            }
            FilterOp::EndsWith => {
                params.push(Some(format!("%{}", escape_like(&f.value))));
                format!("{col} LIKE ? ESCAPE '\\'")
            }
            FilterOp::Gt => {
                params.push(bind_value(&f.value));
                format!("{col} > ?")
            }
            FilterOp::Gte => {
                params.push(bind_value(&f.value));
                format!("{col} >= ?")
            }
            FilterOp::Lt => {
                params.push(bind_value(&f.value));
                format!("{col} < ?")
            }
            FilterOp::Lte => {
                params.push(bind_value(&f.value));
                format!("{col} <= ?")
            }
            FilterOp::IsNull => format!("{col} IS NULL"),
            FilterOp::IsNotNull => format!("{col} IS NOT NULL"),
            FilterOp::In => {
                if f.values.is_empty() {
                    "1 = 0".to_string()
                } else {
                    let placeholders = vec!["?"; f.values.len()].join(", ");
                    for v in &f.values {
                        params.push(bind_value(v));
                    }
                    format!("{col} IN ({placeholders})")
                }
            }
        };
        if parts.is_empty() {
            parts.push(part);
        } else {
            let conj = if f.conjunction.as_deref().is_some_and(|c| c.eq_ignore_ascii_case("OR")) {
                "OR"
            } else {
                "AND"
            };
            parts.push(format!("{conj} {part}"));
        }
    }
    if !parts.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&parts.join(" "));
    } else if let Some(w) = custom_where.map(str::trim).filter(|w| !w.is_empty()) {
        sql.push_str(" WHERE ");
        sql.push_str(w);
    }
    params
}
