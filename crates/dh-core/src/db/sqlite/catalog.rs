use crate::api::{ColumnInfo, ForeignKeyInfo, IndexInfo, TableInfo, TableSchema, TriggerInfo};
use crate::db::{DbError, DbResult};
use super::SqliteAdapter;
use super::schema_ops::escape_str;

impl SqliteAdapter {
    pub async fn list_tables(&self) -> DbResult<Vec<TableInfo>> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT name, type FROM sqlite_master \
             WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' \
             ORDER BY name",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows
            .into_iter()
            .map(|(name, kind)| TableInfo { name, kind })
            .collect())
    }

    pub async fn table_schema(&self, table: &str) -> DbResult<(TableSchema, Vec<String>)> {
        // Introspection statements ride back WITH the schema — per-call
        // ownership, so concurrent describes never interleave captures.
        let mut statements: Vec<String> = Vec::new();
        let mut columns = Vec::new();
        {
            let sql = format!("PRAGMA table_info('{}')", escape_str(table));
            statements.push(format!("{};", sql));
            let rows: Vec<(i64, String, String, i64, Option<String>, i64)> =
                sqlx::query_as(&sql).fetch_all(&self.pool).await.map_err(DbError::SqlEngine)?;
            for (_cid, name, data_type, not_null, default, pk) in rows {
                columns.push(ColumnInfo {
                    name,
                    data_type,
                    not_null: not_null != 0,
                    primary_key: pk > 0,
                    default,
                    enum_values: Vec::new(),
                    is_array: false,
                });
            }
        }

        let mut foreign_keys = Vec::new();
        {
            let sql = format!("PRAGMA foreign_key_list('{}')", escape_str(table));
            statements.push(format!("{};", sql));
            let rows: Vec<(i64, i64, String, String, String)> =
                sqlx::query_as(&sql).fetch_all(&self.pool).await.map_err(DbError::SqlEngine)?;
            for (_id, _seq, referenced_table, column, referenced_column) in rows {
                foreign_keys.push(ForeignKeyInfo {
                    column,
                    referenced_table,
                    referenced_column,
                    name: None,
                    on_delete: None,
                    on_update: None,
                });
            }
        }

        let mut indexes = Vec::new();
        {
            let sql = format!("PRAGMA index_list('{}')", escape_str(table));
            statements.push(format!("{};", sql));
            let rows: Vec<(i64, String, i64, String, i64)> =
                sqlx::query_as(&sql).fetch_all(&self.pool).await.map_err(DbError::SqlEngine)?;
            for (_seq, name, unique, origin, partial) in rows {
                if partial != 0 {
                    continue;
                }
                let isql = format!("PRAGMA index_info('{}')", escape_str(&name));
                statements.push(format!("{};", isql));
                let cols: Vec<(i64, i64, String)> =
                    sqlx::query_as(&isql).fetch_all(&self.pool).await.map_err(DbError::SqlEngine)?;
                indexes.push(IndexInfo {
                    name,
                    unique: unique != 0,
                    columns: cols.into_iter().map(|(_, _, c)| c).collect(),
                    origin: origin.to_string(),
                    column_dirs: None,
                    sparse: None,
                    ttl_seconds: None,
                    partial_filter: None,
                });
            }
        }

        let mut triggers = Vec::new();
        {
            let sql = format!(
                "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = '{}' ORDER BY name",
                escape_str(table)
            );
            statements.push(format!("{};", sql));
            let rows: Vec<(String, Option<String>)> =
                sqlx::query_as(&sql).fetch_all(&self.pool).await.map_err(DbError::SqlEngine)?;
            for (name, body) in rows {
                let sql_text = body.unwrap_or_default();
                if sql_text.trim().is_empty() {
                    continue;
                }
                let (timing, event) = Self::parse_trigger_meta(&sql_text);
                triggers.push(TriggerInfo { name, timing, event, sql: sql_text });
            }
        }

        Ok((
            TableSchema { kind: "table".into(), columns, foreign_keys, indexes, triggers },
            statements,
        ))
    }

    /// Extract the firing timing (BEFORE / AFTER / INSTEAD OF) and event
    /// (INSERT / UPDATE / DELETE) from a CREATE TRIGGER statement by scanning
    /// its keywords. Best-effort — used for display badges only.
    fn parse_trigger_meta(sql: &str) -> (String, String) {
        let lower = sql.to_lowercase();
        let mut timing = String::new();
        let mut words = lower.split_whitespace().peekable();
        while let Some(w) = words.next() {
            match w {
                "before" | "after" => timing = w.to_uppercase(),
                "instead" if words.peek() == Some(&"of") => {
                    timing = "INSTEAD OF".into();
                }
                "insert" | "update" | "delete" => return (timing, w.to_uppercase()),
                _ => {}
            }
        }
        (timing, String::new())
    }
}

/// One column of a table as read from `PRAGMA table_info`. `pk` is the
/// 1-based position of the column inside the primary key (0 = not part of it).
#[derive(Debug, Clone)]
pub(super) struct RawColumn {
    pub(super) name: String,
    pub(super) data_type: String,
    pub(super) not_null: bool,
    /// DEFAULT clause as raw literal text straight from the schema (e.g.
    /// `0`, `'x'`, `CURRENT_TIMESTAMP`) or normalized by
    /// [`normalize_default_literal`] for user-supplied values.
    pub(super) default: Option<String>,
    pub(super) pk: i64,
}

pub(super) async fn read_raw_columns(
    conn: &mut sqlx::SqliteConnection,
    table: &str,
) -> DbResult<Vec<RawColumn>> {
    let sql = format!("PRAGMA table_info('{}')", escape_str(table));
    let rows: Vec<(i64, String, String, i64, Option<String>, i64)> =
        sqlx::query_as(&sql).fetch_all(conn).await.map_err(DbError::SqlEngine)?;
    Ok(rows
        .into_iter()
        .map(|(_cid, name, data_type, not_null, default, pk)| RawColumn {
            name,
            data_type,
            not_null: not_null != 0,
            default,
            pk,
        })
        .collect())
}

/// A foreign key grouped back into one clause: `FOREIGN KEY (cols)
/// REFERENCES tbl (target_cols?)`.
pub(super) struct GroupedFk {
    pub(super) referenced_table: String,
    pub(super) columns: Vec<String>,
    pub(super) referenced_columns: Option<Vec<String>>,
}

pub(super) async fn group_foreign_keys(
    conn: &mut sqlx::SqliteConnection,
    table: &str,
) -> DbResult<Vec<GroupedFk>> {
    let sql = format!("PRAGMA foreign_key_list('{}')", escape_str(table));
    let rows: Vec<(i64, i64, String, String, Option<String>)> =
        sqlx::query_as(&sql).fetch_all(conn).await.map_err(DbError::SqlEngine)?;
    // Group rows by FK id; within a composite key SQLite lists the columns in
    // reverse declaration order, so sort each group's pairs by seq DESCENDING
    // to reconstruct the original clause.
    let mut groups: std::collections::BTreeMap<
        i64,
        (String, Vec<(i64, String)>, Option<Vec<(i64, String)>>),
    > = std::collections::BTreeMap::new();
    for (id, seq, referenced_table, column, referenced_column) in rows {
        let g = groups
            .entry(id)
            .or_insert_with(|| (referenced_table.clone(), Vec::new(), Some(Vec::new())));
        g.1.push((seq, column));
        match (g.2.as_mut(), referenced_column) {
            (Some(rc), Some(target)) => rc.push((seq, target)),
            _ => g.2 = None,
        }
    }
    Ok(groups
        .into_values()
        .map(|(table_name, mut cols, targets)| {
            cols.sort_by(|a, b| b.0.cmp(&a.0));
            let targets = targets.map(|mut t| {
                t.sort_by(|a, b| b.0.cmp(&a.0));
                t.into_iter().map(|(_, c)| c).collect::<Vec<_>>()
            });
            GroupedFk {
                referenced_table: table_name,
                columns: cols.into_iter().map(|(_, c)| c).collect(),
                referenced_columns: targets,
            }
        })
        .collect())
}

#[cfg(test)]
mod trigger_tests {
    use super::*;

    #[tokio::test]
    async fn table_schema_lists_triggers() {
        let dir = std::env::temp_dir().join("dh-studio-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("trig-{}.db", uuid::Uuid::new_v4()));
        let adapter = SqliteAdapter::connect(path).await.unwrap();

        sqlx::query("CREATE TABLE orders (id INTEGER PRIMARY KEY, qty INTEGER)")
            .execute(&adapter.pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE log (msg TEXT)")
            .execute(&adapter.pool)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TRIGGER audit_qty AFTER UPDATE OF qty ON orders\nBEGIN\n  INSERT INTO log VALUES ('changed');\nEND",
        )
        .execute(&adapter.pool)
        .await
        .unwrap();

        let (schema, _) = adapter.table_schema("orders").await.unwrap();
        assert_eq!(schema.triggers.len(), 1, "expected the audit_qty trigger");
        let t = &schema.triggers[0];
        assert_eq!(t.name, "audit_qty");
        assert_eq!(t.timing, "AFTER");
        assert_eq!(t.event, "UPDATE");
        assert!(t.sql.contains("INSERT INTO log"));
    }

    #[tokio::test]
    async fn table_schema_empty_triggers_when_none() {
        let dir = std::env::temp_dir().join("dh-studio-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("notrig-{}.db", uuid::Uuid::new_v4()));
        let adapter = SqliteAdapter::connect(path).await.unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY)")
            .execute(&adapter.pool)
            .await
            .unwrap();
        let (schema, _) = adapter.table_schema("t").await.unwrap();
        assert!(schema.triggers.is_empty());
    }
}
