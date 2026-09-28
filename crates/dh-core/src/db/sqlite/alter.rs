use crate::api::DefaultMode;
use crate::db::{DbError, DbResult};
use super::catalog::{RawColumn, group_foreign_keys, read_raw_columns};
use super::SqliteAdapter;
use super::schema_ops::{escape_str, quote_ident};

impl SqliteAdapter {
    /// Resolve an `alter_column` request against the live schema: a pure
    /// rename becomes a cheap `ALTER TABLE ... RENAME COLUMN`; anything else
    /// (type / NOT NULL / DEFAULT) requires rebuilding the table because
    /// SQLite has no in-place ALTER for those.
    pub(super) async fn alter_column(
        conn: &mut sqlx::SqliteConnection,
        table: &str,
        column: &str,
        new_name: &Option<String>,
        data_type: Option<&str>,
        not_null: Option<bool>,
        default_mode: Option<DefaultMode>,
        default_value: Option<&str>,
    ) -> DbResult<Vec<String>> {
        let cols = read_raw_columns(conn, table).await?;
        let current = cols
            .iter()
            .find(|c| c.name == column)
            .ok_or_else(|| {
                DbError::InvalidOperation(format!("column '{}' not found", column))
            })?
            .clone();
        drop(cols);

        let target_name = new_name
            .clone()
            .map(|n| n.trim().to_string())
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| current.name.clone());
        let target_type = data_type
            .map(|t| t.trim().to_string())
            .unwrap_or_else(|| current.data_type.clone());
        let target_not_null = not_null.unwrap_or(current.not_null);
        let (target_default, default_changed) = match default_mode {
            None | Some(DefaultMode::Keep) => (current.default.clone(), false),
            Some(DefaultMode::Drop) => (None, current.default.is_some()),
            Some(DefaultMode::Set) => {
                let literal = default_value.map(normalize_default_literal);
                (literal.clone(), literal != current.default)
            }
        };

        let renamed = target_name != current.name;
        let changed = target_type != current.data_type
            || target_not_null != current.not_null
            || default_changed;
        if !renamed && !changed {
            return Ok(Vec::new()); // nothing to do
        }
        if !changed {
            let sql = format!(
                "ALTER TABLE {} RENAME COLUMN {} TO {}",
                quote_ident(table),
                quote_ident(&current.name),
                quote_ident(&target_name)
            );
            sqlx::query(&sql).execute(&mut *conn).await.map_err(DbError::SqlEngine)?;
            return Ok(vec![sql]);
        }

        let final_def = RawColumn {
            name: target_name,
            data_type: target_type,
            not_null: target_not_null,
            default: target_default,
            pk: current.pk,
        };
        Self::rebuild_table_column(conn, table, column, final_def).await
    }

    /// Rebuild a table with one column replaced by `final_def` (identified by
    /// its CURRENT name `current_name`). SQLite has no in-place ALTER for
    /// type/NOT NULL/DEFAULT changes, so this follows the classic procedure:
    /// create the new definition under a temp name, copy every row over,
    /// drop the original, rename the copy into place, and recreate the
    /// table's explicit indexes. Runs on the caller's connection inside its
    /// transaction; foreign keys are suspended by the batch wrapper because
    /// the intermediate DROP would otherwise be rejected while other tables
    /// still reference this one.
    ///
    /// Caveats: CHECK constraints, collations and inline UNIQUE clauses of
    /// the original CREATE TABLE are not carried over (the rebuild is built
    /// from live metadata), and triggers/views referencing the table are left
    /// untouched and may need manual fixing.
    async fn rebuild_table_column(
        conn: &mut sqlx::SqliteConnection,
        table: &str,
        current_name: &str,
        final_def: RawColumn,
    ) -> DbResult<Vec<String>> {
        let mut cols = read_raw_columns(conn, table).await?;
        let idx = cols
            .iter()
            .position(|c| c.name == current_name)
            .ok_or_else(|| {
                DbError::InvalidOperation(format!("column '{}' not found", current_name))
            })?;
        cols[idx] = final_def;

        let pk_cols: Vec<String> = cols
            .iter()
            .filter(|c| c.pk > 0)
            .collect::<Vec<_>>()
            .into_iter()
            .map(|c| c.name.clone())
            .collect();

        let fks = group_foreign_keys(conn, table).await?;
        let index_sql = recreate_index_statements(conn, table).await?;

        let tmp_ident = quote_ident(&format!("{}__dh_rebuild", table));
        let table_ident = quote_ident(table);

        let mut defs: Vec<String> = cols.iter().map(|c| col_definition(c, &pk_cols)).collect();
        if pk_cols.len() > 1 {
            let list = pk_cols.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", ");
            defs.push(format!("PRIMARY KEY ({})", list));
        }
        for fk in &fks {
            let from = fk.columns.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", ");
            match &fk.referenced_columns {
                Some(to) => {
                    let to_list =
                        to.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", ");
                    defs.push(format!(
                        "FOREIGN KEY ({}) REFERENCES {} ({})",
                        from,
                        quote_ident(&fk.referenced_table),
                        to_list
                    ));
                }
                None => {
                    defs.push(format!(
                        "FOREIGN KEY ({}) REFERENCES {}",
                        from,
                        quote_ident(&fk.referenced_table)
                    ));
                }
            }
        }

        let all_cols = cols.iter().map(|c| quote_ident(&c.name)).collect::<Vec<_>>().join(", ");
        let mut stmts = vec![
            format!("DROP TABLE IF EXISTS {}", tmp_ident),
            format!("CREATE TABLE {} ({})", tmp_ident, defs.join(", ")),
            format!(
                "INSERT INTO {} ({}) SELECT {} FROM {}",
                tmp_ident, all_cols, all_cols, table_ident
            ),
            format!("DROP TABLE {}", table_ident),
            format!("ALTER TABLE {} RENAME TO {}", tmp_ident, table_ident),
        ];
        stmts.extend(index_sql);

        for s in &stmts {
            sqlx::query(s).execute(&mut *conn).await.map_err(DbError::SqlEngine)?;
        }
        Ok(stmts)
    }
}

/// CREATE INDEX statements that re-create the table's explicit indexes
/// (`c` = user-created, `u` = UNIQUE constraint — both were dropped together
/// with the old table; auto PK indexes come back via the PRIMARY KEY clause).
async fn recreate_index_statements(
    conn: &mut sqlx::SqliteConnection,
    table: &str,
) -> DbResult<Vec<String>> {
    let list_sql = format!("PRAGMA index_list('{}')", escape_str(table));
    let rows: Vec<(i64, String, i64, String, i64)> =
        sqlx::query_as(&list_sql).fetch_all(&mut *conn).await.map_err(DbError::SqlEngine)?;
    let mut out = Vec::new();
    for (_seq, name, unique, origin, partial) in rows {
        // Partial indexes are not carried over by the rebuild, and pk/'u'
        // origins are implicit (constraint-owned, reserved sqlite_autoindex
        // names) — the fresh CREATE TABLE already reproduces them.
        if partial != 0 || origin != "c" {
            continue;
        }
        let info_sql = format!("PRAGMA index_info('{}')", escape_str(&name));
        let cols: Vec<(i64, i64, String)> = sqlx::query_as(&info_sql)
            .fetch_all(&mut *conn)
            .await
            .map_err(DbError::SqlEngine)?;
        let col_list = cols
            .into_iter()
            .map(|(_, _, c)| quote_ident(&c))
            .collect::<Vec<_>>()
            .join(", ");
        out.push(format!(
            "CREATE {}INDEX {} ON {} ({})",
            if unique != 0 { "UNIQUE " } else { "" },
            quote_ident(&name),
            quote_ident(table),
            col_list
        ));
    }
    Ok(out)
}

/// Render one column definition for CREATE TABLE / ADD COLUMN.
pub(super) fn col_definition(c: &RawColumn, pk_cols: &[String]) -> String {
    let mut s = quote_ident(&c.name);
    if !c.data_type.is_empty() {
        s.push(' ');
        s.push_str(&c.data_type);
    }
    if c.not_null {
        s.push_str(" NOT NULL");
    }
    if let Some(d) = &c.default {
        s.push_str(" DEFAULT ");
        s.push_str(d);
    }
    if pk_cols.len() == 1 && pk_cols[0] == c.name {
        s.push_str(" PRIMARY KEY");
    }
    s
}

/// Turn a user-typed DEFAULT value into safe literal text. Free text is
/// always treated as a string literal (quoted/escaped), numbers pass through,
/// and the NULL/CURRENT_* keywords are recognized so they keep their special
/// meaning. User input is never spliced into DDL unquoted.
pub(super) fn normalize_default_literal(input: &str) -> String {
    let t = input.trim();
    if t.is_empty() || t.eq_ignore_ascii_case("null") {
        return "NULL".to_string();
    }
    if matches!(
        t.to_ascii_lowercase().as_str(),
        "current_timestamp" | "current_time" | "current_date"
    ) {
        return t.to_ascii_uppercase();
    }
    let body = t.strip_prefix(['+', '-']).unwrap_or(t);
    let looks_numeric = !body.is_empty()
        && body.chars().all(|c| c.is_ascii_digit() || c == '.')
        && body.matches('.').count() <= 1;
    if looks_numeric {
        return t.to_string();
    }
    format!("'{}'", t.replace('\'', "''"))
}
