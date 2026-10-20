//! Catalog reads. MySQL has no schema level: a connection holds databases,
//! and a database holds tables, views and routines. `schema` arguments are
//! ignored and `list_schemas` is empty (spec 0025 data model).

use std::collections::HashMap;
use crate::api::{ColumnInfo, ForeignKeyInfo, IndexInfo, TableInfo, TableOptions, TableSchema, TriggerInfo};
use crate::db::{CatalogOverview, DbResult};
use super::MySqlAdapter;
use super::connect::Flavor;
use super::rows::fetch_text;

type Rows = Vec<Vec<Option<String>>>;

pub(super) fn col(row: &[Option<String>], i: usize) -> String {
    row.get(i).cloned().flatten().unwrap_or_default()
}

/// `enum('a','b')` or `set('x','y')` to its values; anything else is empty.
pub(super) fn enum_values(column_type: &str) -> Vec<String> {
    let lower = column_type.to_ascii_lowercase();
    let Some(body) = ["enum(", "set("]
        .iter()
        .find_map(|p| lower.starts_with(p).then(|| &column_type[p.len()..]))
    else {
        return Vec::new();
    };
    let body = body.strip_suffix(')').unwrap_or(body);
    let mut out = Vec::new();
    let mut chars = body.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\'' {
            continue;
        }
        let mut value = String::new();
        while let Some(c) = chars.next() {
            match c {
                '\'' if chars.peek() == Some(&'\'') => {
                    chars.next();
                    value.push('\'');
                }
                '\'' => break,
                '\\' => {
                    if let Some(n) = chars.next() {
                        value.push(n);
                    }
                }
                c => value.push(c),
            }
        }
        out.push(value);
    }
    out
}

/// MariaDB quotes string defaults (`'abc'`) and spells a NULL default as
/// the text `NULL`; MySQL gives the raw value. Bring MariaDB's in line.
fn column_default(flavor: Flavor, raw: Option<String>) -> Option<String> {
    let raw = raw?;
    if flavor == Flavor::Mysql {
        return Some(raw);
    }
    if raw == "NULL" {
        return None;
    }
    match raw.strip_prefix('\'').and_then(|r| r.strip_suffix('\'')) {
        Some(inner) => Some(inner.replace("''", "'")),
        None => Some(raw),
    }
}

impl MySqlAdapter {
    pub(super) async fn list_databases(&self) -> DbResult<Vec<String>> {
        // Every database, system ones included: the sidebar hides the four
        // system names unless "Show system databases" is on (AC-6).
        let rows = fetch_text(&self.pool, "SHOW DATABASES", &[]).await?;
        Ok(rows.iter().map(|r| col(r, 0)).collect())
    }

    pub(super) async fn catalog_overview(&self) -> DbResult<CatalogOverview> {
        Ok(CatalogOverview {
            schemas: Vec::new(),
            databases: self.list_databases().await?,
            active_schema: self.database.clone().unwrap_or_default(),
        })
    }

    pub(super) async fn list_tables(&self) -> DbResult<Vec<TableInfo>> {
        let Some(db) = self.database.as_deref() else {
            return Ok(Vec::new());
        };
        let rows = fetch_text(
            &self.pool,
            "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
            &[db],
        )
        .await?;
        Ok(rows
            .iter()
            .map(|r| TableInfo {
                name: col(r, 0),
                kind: if col(r, 1).contains("VIEW") { "view".into() } else { "table".into() },
            })
            .collect())
    }

    pub(super) async fn table_schema(
        &self,
        database: Option<&str>,
        table: &str,
    ) -> DbResult<(TableSchema, Vec<String>)> {
        let db = self.require_target(database)?;
        let sql_kind = "SELECT TABLE_TYPE, ENGINE, TABLE_COLLATION, TABLE_COMMENT FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?";
        let sql_cols = "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, \
             EXTRA, COLUMN_COMMENT FROM information_schema.COLUMNS \
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION";
        let sql_idx = "SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME FROM information_schema.STATISTICS \
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX";
        let sql_fks = "SELECT k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, \
             k.CONSTRAINT_NAME, r.DELETE_RULE, r.UPDATE_RULE \
             FROM information_schema.KEY_COLUMN_USAGE k \
             JOIN information_schema.REFERENTIAL_CONSTRAINTS r \
               ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME \
              AND r.TABLE_NAME = k.TABLE_NAME \
             WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL \
             ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION";
        let sql_trig = "SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT \
             FROM information_schema.TRIGGERS \
             WHERE EVENT_OBJECT_SCHEMA = ? AND EVENT_OBJECT_TABLE = ? ORDER BY TRIGGER_NAME";
        let args = [db, table];
        let shown = [Some(db.to_string()), Some(table.to_string())];
        let statements = [sql_kind, sql_cols, sql_idx, sql_fks, sql_trig]
            .iter()
            .map(|s| crate::db::inline_placeholders(s, &shown, false) + ";")
            .collect();

        // Independent lookups, run concurrently: one round trip of latency.
        let (r_kind, r_cols, r_idx, r_fks, r_trig) = futures_util::future::join5(
            fetch_text(&self.pool, sql_kind, &args),
            fetch_text(&self.pool, sql_cols, &args),
            fetch_text(&self.pool, sql_idx, &args),
            fetch_text(&self.pool, sql_fks, &args),
            fetch_text(&self.pool, sql_trig, &args),
        )
        .await;
        let (kind, cols, idx, fks, trig): (Rows, Rows, Rows, Rows, Rows) = (r_kind?, r_cols?, r_idx?, r_fks?, r_trig?);

        let flavor = self.server.flavor;
        let columns = cols
            .iter()
            .map(|r| {
                let column_type = col(r, 1);
                let extra = col(r, 5);
                let comment = col(r, 6);
                ColumnInfo {
                    name: col(r, 0),
                    enum_values: enum_values(&column_type),
                    data_type: column_type,
                    not_null: col(r, 2) == "NO",
                    primary_key: col(r, 4) == "PRI",
                    default: column_default(flavor, r.get(3).cloned().flatten()),
                    is_array: false,
                    extra: (!extra.is_empty()).then_some(extra),
                    comment: (!comment.is_empty()).then_some(comment),
                }
            })
            .collect();

        let mut indexes: Vec<IndexInfo> = Vec::new();
        let mut by_name: HashMap<String, usize> = HashMap::new();
        for r in &idx {
            let name = col(r, 0);
            let at = *by_name.entry(name.clone()).or_insert_with(|| {
                indexes.push(IndexInfo {
                    origin: if name == "PRIMARY" { "pk".into() } else { "c".into() },
                    unique: col(r, 1) == "0",
                    name,
                    columns: Vec::new(),
                    column_dirs: None,
                    sparse: None,
                    ttl_seconds: None,
                    partial_filter: None,
                });
                indexes.len() - 1
            });
            indexes[at].columns.push(col(r, 2));
        }

        let foreign_keys = fks
            .iter()
            .map(|r| ForeignKeyInfo {
                column: col(r, 0),
                referenced_table: col(r, 1),
                referenced_column: col(r, 2),
                name: Some(col(r, 3)).filter(|n| !n.is_empty()),
                on_delete: Some(col(r, 4)),
                on_update: Some(col(r, 5)),
            })
            .collect();

        let triggers = trig
            .iter()
            .map(|r| TriggerInfo { name: col(r, 0), timing: col(r, 1), event: col(r, 2), sql: col(r, 3) })
            .collect();

        let table_type = kind.first().map(|r| col(r, 0)).unwrap_or_default();
        let table_options = kind.first().filter(|_| !table_type.contains("VIEW")).map(|r| {
            let collation = col(r, 2);
            TableOptions {
                engine: col(r, 1),
                // A collation's name starts with its charset's (no charset
                // name has an underscore), which avoids MariaDB's charset
                // agnostic collations matching several rows in a join.
                charset: collation.split('_').next().unwrap_or_default().to_string(),
                collation,
                comment: col(r, 3),
            }
        });
        Ok((
            TableSchema {
                kind: if table_type.contains("VIEW") { "view".into() } else { "table".into() },
                columns,
                foreign_keys,
                indexes,
                triggers,
                table_options,
            },
            statements,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enum_and_set_values_are_parsed_from_the_column_type() {
        assert_eq!(enum_values("enum('a','b')"), vec!["a", "b"]);
        assert_eq!(enum_values("set('x','it''s','c\\'d')"), vec!["x", "it's", "c'd"]);
        assert!(enum_values("varchar(255)").is_empty());
        assert!(enum_values("int unsigned").is_empty());
    }

    #[test]
    fn mariadb_defaults_are_unquoted_and_its_null_text_is_null() {
        assert_eq!(column_default(Flavor::Mariadb, Some("'it''s'".into())).as_deref(), Some("it's"));
        assert_eq!(column_default(Flavor::Mariadb, Some("NULL".into())), None);
        assert_eq!(column_default(Flavor::Mariadb, Some("current_timestamp()".into())).as_deref(), Some("current_timestamp()"));
        assert_eq!(column_default(Flavor::Mysql, Some("abc".into())).as_deref(), Some("abc"));
        assert_eq!(column_default(Flavor::Mysql, None), None);
    }
}
