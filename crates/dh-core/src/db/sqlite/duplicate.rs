use crate::db::{DbError, DbResult};
use super::SqliteAdapter;
use super::schema_ops::quote_ident;

impl SqliteAdapter {
    /// Duplicate a table including its structure (column types, primary/foreign
    /// keys, constraints, indexes) and all of its data. Views fall back to a
    /// plain `CREATE TABLE AS SELECT` copy.
    pub async fn duplicate_table(
        &self,
        source: &str,
        target: &str,
        _copy_data: bool,
    ) -> DbResult<Vec<String>> {
        // TODO(postgres/sqlite duplicate UI): honor copy_data once SQL
        // tables get the same copy-data checkbox as Mongo's "Duplicate
        // collection" — always copies data for now.
        let mut ran: Vec<String> = Vec::new();
        const LOOKUP: &str = "SELECT type, sql FROM sqlite_master WHERE name = ?";
        let row: Option<(String, Option<String>)> = sqlx::query_as(LOOKUP)
            .bind(source)
            .fetch_optional(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        ran.push(format!("{LOOKUP};"));

        match row {
            Some((kind, Some(ddl))) if kind == "table" && !ddl.trim().is_empty() => {
                let rewritten = rewrite_table_name(&ddl, source, target);
                ran.push(format!("{rewritten};"));
                sqlx::query(&rewritten)
                    .execute(&self.pool)
                    .await
                    .map_err(DbError::SqlEngine)?;
                ran.append(&mut self.duplicate_indexes(source, target).await?);
            }
            _ => {
                let fallback = format!(
                    "CREATE TABLE {} AS SELECT * FROM {}",
                    quote_ident(target),
                    quote_ident(source),
                );
                ran.push(format!("{fallback};"));
                sqlx::query(&fallback)
                    .execute(&self.pool)
                    .await
                    .map_err(DbError::SqlEngine)?;
            }
        }

        let copy = format!(
            "INSERT INTO {} SELECT * FROM {}",
            quote_ident(target),
            quote_ident(source),
        );
        ran.push(format!("{copy};"));
        sqlx::query(&copy)
            .execute(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        Ok(ran)
    }

    /// Re-create every user index of `source` under `target`, returning the
    /// statements that ran.
    async fn duplicate_indexes(&self, source: &str, target: &str) -> DbResult<Vec<String>> {
        let mut ran = Vec::new();
        let indexes: Vec<(String, Option<String>)> = sqlx::query_as(
            "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name = ?",
        )
        .bind(source)
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        for (name, ddl) in indexes {
            if name.starts_with("sqlite_autoindex") {
                continue;
            }
            if let Some(sql) = ddl {
                if sql.trim().is_empty() {
                    continue;
                }
                let new_name = format!("{}_{}", target, name);
                let rewritten = rewrite_index(&sql, &new_name, source, target);
                ran.push(format!("{rewritten};"));
                sqlx::query(&rewritten)
                    .execute(&self.pool)
                    .await
                    .map_err(DbError::SqlEngine)?;
            }
        }
        Ok(ran)
    }
}

fn unquote(tok: &str) -> &str {
    if tok.len() >= 2 && tok.starts_with('"') && tok.ends_with('"') {
        &tok[1..tok.len() - 1]
    } else {
        tok
    }
}

/// Rewrite a `CREATE TABLE` statement so it targets `target` instead of
/// `source`. Only the identifier after `CREATE TABLE [IF NOT EXISTS]
/// [schema.]` is replaced — the column definitions (types, keys, constraints)
/// are preserved verbatim.
fn rewrite_table_name(ddl: &str, source: &str, target: &str) -> String {
    let Some(open) = ddl.find('(') else {
        return ddl.to_string();
    };
    let header = &ddl[..open];
    let body = &ddl[open..];
    let new_header = header
        .split_whitespace()
        .map(|tok| {
            let (prefix, name) = match tok.rfind('.') {
                Some(i) => (&tok[..=i], &tok[i + 1..]),
                None => ("", tok),
            };
            if unquote(name) == source {
                format!("{prefix}{}", quote_ident(target))
            } else {
                tok.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    format!("{new_header}{body}")
}

/// Rewrite a `CREATE [UNIQUE] INDEX` statement so it uses `new_index_name` and
/// targets `target` instead of `source`.
fn rewrite_index(ddl: &str, new_index_name: &str, source: &str, target: &str) -> String {
    let mut out = String::new();
    let mut sep = "";
    let mut replaced_name = false;
    let mut seen_on = false;
    for tok in ddl.split_whitespace() {
        let lower = tok.to_ascii_lowercase();
        let piece = if lower == "on" {
            seen_on = true;
            tok.to_string()
        } else if !replaced_name && !matches!(lower.as_str(), "create" | "index" | "unique" | "if" | "not" | "exists") {
            replaced_name = true;
            quote_ident(new_index_name)
        } else if seen_on {
            let (prefix, name) = match tok.rfind('.') {
                Some(i) => (&tok[..=i], &tok[i + 1..]),
                None => ("", tok),
            };
            seen_on = false;
            if unquote(name) == source {
                format!("{prefix}{}", quote_ident(target))
            } else {
                tok.to_string()
            }
        } else {
            tok.to_string()
        };
        out.push_str(sep);
        out.push_str(&piece);
        sep = " ";
    }
    out
}
