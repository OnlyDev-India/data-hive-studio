use crate::api::{QueryOp, QueryResult};
use crate::db::{DbError, DbResult};
use super::PgAdapter;
use super::exec::{bind_str, null_error, run_sql_prebound};
use super::filters::build_select;
use super::sql_text::{dollar_placeholders, q, tq};

impl PgAdapter {
    pub(super) async fn execute_op(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        op: &QueryOp,
    ) -> DbResult<super::OpOutcome> {
        self.guard.check_op(op)?;
        let pool = self.pool_for(database).await?;
        let database_key = self.resolve_database(database).to_string();
        let schema = schema.map(str::to_string).unwrap_or_else(|| self.cur_schema());
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
                cancelled: false,
            }
        };
        match op {
            QueryOp::Select { table, filters, custom_where, order_by, limit, offset } => {
                let mut params = Vec::new();
                let sql = build_select(
                    &schema,
                    table,
                    filters,
                    custom_where.as_ref(),
                    order_by,
                    *limit,
                    *offset,
                    &mut params,
                );
                let converted = dollar_placeholders(&sql);
                let display = super::inline_placeholders(&converted, &params, true) + ";";
                Ok(super::OpOutcome {
                    result: run_sql_prebound(&pool, &sql, params).await?,
                    sql: Some(display),
                })
            }
            QueryOp::Count { table, filters, custom_where } => {
                let mut params = Vec::new();
                let where_sql =
                    Self::where_clause(filters, custom_where.as_ref(), &mut params);
                let sql =
                    format!("SELECT COUNT(*) FROM {}{}", tq(&schema, table), where_sql);
                let converted = dollar_placeholders(&sql);
                let mut cq = sqlx::query_scalar::<_, i64>(&converted);
                for p in &params {
                    cq = match p {
                        Some(v) => cq.bind(v.clone()),
                        None => cq.bind(None::<String>),
                    };
                }
                // One scalar round trip — no row shaping, no column metadata.
                let count = cq.fetch_one(&pool).await.map_err(DbError::SqlEngine)? as u64;
                Ok(super::OpOutcome {
                    result: mk(vec!["count".into()], vec![vec![Some(count.to_string())]], count, true),
                    sql: Some(super::inline_placeholders(&converted, &params, true) + ";"),
                })
            }
            QueryOp::SelectDistinct { table, column, limit } => {
                let mut sql =
                    format!("SELECT DISTINCT {} FROM {}", q(column), tq(&schema, table));
                if let Some(l) = limit {
                    sql.push_str(&format!(" LIMIT {l}"));
                }
                let result = self.run_sql(database, None, &sql).await?;
                Ok(super::OpOutcome { result, sql: Some(format!("{};", sql)) })
            }
            QueryOp::Insert { table, values, skip_empty } => {
                let types = self.column_types_for(&pool, &database_key, &schema, table).await?;
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
                    tq(&schema, table),
                    names.join(", "),
                    phs.join(", ")
                );
                log::debug!("pg insert: {sql}");
                let mut ins = sqlx::query(&sql);
                for val in &bound {
                    ins = bind_str(ins, val);
                }
                let res = ins.execute(&pool).await.map_err(DbError::SqlEngine)?;
                // Display copy: bound values inlined so the log is readable.
                let display = format!(
                    // (trailing semicolon appended below)
                    "INSERT INTO {} ({}) VALUES ({})",
                    tq(&schema, table),
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
            QueryOp::BulkUpdate { table, column, value, filters, custom_where } => {
                let types = self.column_types_for(&pool, &database_key, &schema, table).await?;
                let cast = types.get(column.as_str()).map(|t| format!("::{t}")).unwrap_or_default();
                let mut params: Vec<Option<String>> = vec![value.clone()];
                let where_sql = Self::where_clause(filters, custom_where.as_ref(), &mut params);
                let sql = format!(
                    "UPDATE {} SET {} = ?{cast}{where_sql}",
                    tq(&schema, table),
                    q(column),
                );
                let converted = dollar_placeholders(&sql);
                let mut final_q = sqlx::query(&converted);
                for p in &params {
                    final_q = bind_str(final_q, p);
                }
                log::debug!("pg bulk update: {sql}");
                let res = final_q.execute(&pool).await.map_err(DbError::SqlEngine)?;
                let display = format!(
                    "UPDATE {} SET {} = {}{where_sql};",
                    tq(&schema, table),
                    q(column),
                    super::sql_literal(value.as_deref()),
                );
                Ok(super::OpOutcome {
                    result: mk(vec![], vec![], res.rows_affected(), false),
                    sql: Some(display),
                })
            }
            QueryOp::Update { table, set, match_row } => {
                if set.is_empty() {
                    return Ok(super::OpOutcome { result: mk(vec![], vec![], 0, false), sql: None });
                }
                let types = self.column_types_for(&pool, &database_key, &schema, table).await?;
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
                    tq(&schema, table),
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
                let res = final_q.execute(&pool).await.map_err(DbError::SqlEngine)?;
                // Display copy with values inlined (log only).
                let display = format!(
                    // (trailing semicolon appended below)
                    "UPDATE {} SET {} WHERE {}",
                    tq(&schema, table),
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
                let types = self.column_types_for(&pool, &database_key, &schema, table).await?;
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
                    tq(&schema, table),
                    if wheres.is_empty() { String::new() } else { format!(" WHERE {}", wheres.join(" AND ")) }
                );
                log::debug!("pg delete: {sql}");
                let mut real_q = sqlx::query(&sql);
                for (_, val) in match_row.iter() {
                    if !val.is_none() { real_q = bind_str(real_q, val); }
                }
                let res = real_q.execute(&pool).await.map_err(DbError::SqlEngine)?;
                let display = format!(
                    // (trailing semicolon appended below)
                    "DELETE FROM {}{}",
                    tq(&schema, table),
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
                let sql = format!("DROP TABLE IF EXISTS {}", tq(&schema, table));
                let res = sqlx::query(&sql).execute(&pool).await.map_err(DbError::SqlEngine)?;
                self.type_cache
                    .lock()
                    .unwrap()
                    .remove(&(database_key.clone(), schema.clone(), table.to_string()));
                Ok(super::OpOutcome {
                    result: mk(vec![], vec![], res.rows_affected(), false),
                    sql: Some(format!("{sql};")),
                })
            }
        }
    }
}
