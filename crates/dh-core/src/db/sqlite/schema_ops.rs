use sqlx::Acquire;
use crate::api::SchemaOp;
use crate::db::{DbError, DbResult};
use super::catalog::RawColumn;
use super::SqliteAdapter;
use super::alter::{col_definition, normalize_default_literal};

impl SqliteAdapter {
    /// Apply a whole batch of structured schema (DDL) operations as ONE
    /// transaction: either every statement commits, or a failure on any op
    /// rolls everything back and the schema is left exactly as before. This
    /// matters because several ops are pairs by design — e.g. editing an
    /// index runs `DROP INDEX` + `CREATE INDEX`; without the transaction a
    /// failed CREATE would leave the index deleted.
    ///
    /// FK enforcement is suspended for the duration (outside the transaction
    /// — SQLite ignores the pragma inside one) because intermediate batch
    /// states (dropped/rebuilt tables) can transiently violate foreign keys.
    /// Returns every statement that ran so the UI can show/copy it.
    pub async fn apply_schema_ops_batch(&self, ops: &[SchemaOp]) -> DbResult<Vec<String>> {
        let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
        sqlx::query("PRAGMA foreign_keys = OFF")
            .execute(&mut *conn)
            .await
            .map_err(DbError::SqlEngine)?;

        // The whole batch runs inside one scoped block so the transaction's
        // borrow of `conn` ends before the FK pragma is restored, whatever
        // the outcome. Any `Err` path has already rolled the tx back (or the
        // drop of a live transaction does it implicitly).
        let batch = async {
            let mut tx = conn.begin().await.map_err(DbError::SqlEngine)?;
            let mut executed: Vec<String> = Vec::new();
            for op in ops {
                match Self::apply_op(&mut *tx, op).await {
                    Ok(mut ran) => executed.append(&mut ran),
                    Err(e) => {
                        let _ = tx.rollback().await;
                        return Err(e);
                    }
                }
            }
            tx.commit().await.map_err(DbError::SqlEngine)?;
            Ok(executed)
        }
        .await;

        Self::restore_foreign_keys(&mut conn).await;
        batch
    }

    async fn restore_foreign_keys(conn: &mut sqlx::SqliteConnection) {
        let _ = sqlx::query("PRAGMA foreign_keys = ON").execute(&mut *conn).await;
    }

    /// Execute one operation on an existing connection (inside the caller's
    /// transaction) and return every SQL statement that ran. See [`SchemaOp`]
    /// for the semantics of each variant.
    async fn apply_op(conn: &mut sqlx::SqliteConnection, op: &SchemaOp) -> DbResult<Vec<String>> {
        match op {
            SchemaOp::AlterColumn {
                table,
                column,
                new_name,
                data_type,
                not_null,
                default_mode,
                default_value,
            } => {
                // Plans AND executes internally (rename-only or full rebuild).
                Self::alter_column(
                    conn,
                    table,
                    column,
                    new_name,
                    data_type.as_deref(),
                    *not_null,
                    *default_mode,
                    default_value.as_deref(),
                )
                .await
            }
            other => {
                // Guard against SQLite's double-quoted-string fallback: a
                // quoted identifier that matches no column silently degrades
                // to a string literal, so `CREATE INDEX ... ("typo")` would
                // build a constant-expression index instead of failing. Check
                // the columns up front and reject unknown ones.
                if let SchemaOp::CreateIndex { table, columns, .. } = other {
                    let known: Vec<(String,)> = sqlx::query_as(&format!(
                        "SELECT name FROM pragma_table_info('{}')",
                        escape_str(table)
                    ))
                    .fetch_all(&mut *conn)
                    .await
                    .map_err(DbError::SqlEngine)?;
                    let names: std::collections::HashSet<&str> =
                        known.iter().map(|(n,)| n.as_str()).collect();
                    for c in columns {
                        if !names.contains(c.as_str()) {
                            return Err(DbError::InvalidOperation(format!(
                                "column '{}' not found on table '{}'",
                                c, table
                            )));
                        }
                    }
                }
                let stmts = Self::plan_schema_sql(other)?;
                let mut executed = Vec::with_capacity(stmts.len());
                for s in &stmts {
                    sqlx::query(s).execute(&mut *conn).await.map_err(DbError::SqlEngine)?;
                    executed.push(s.clone());
                }
                Ok(executed)
            }
        }
    }

    /// Build the dialect SQL for every simple [`SchemaOp`] (everything whose
    /// change SQLite supports natively). `AlterColumn` is handled separately
    /// because it may need the full rebuild procedure instead.
    fn plan_schema_sql(op: &SchemaOp) -> DbResult<Vec<String>> {
        Ok(match op {
            SchemaOp::RenameTable { table, new_name } => {
                let new_name = new_name.trim();
                if new_name.is_empty() {
                    return Err(DbError::InvalidOperation("table name is empty".into()));
                }
                vec![format!(
                    "ALTER TABLE {} RENAME TO {}",
                    quote_ident(table),
                    quote_ident(new_name)
                )]
            }
            SchemaOp::AddColumn {
                table,
                name,
                data_type,
                not_null,
                default,
            } => {
                let def = RawColumn {
                    name: name.clone(),
                    data_type: data_type.trim().to_string(),
                    not_null: *not_null,
                    default: default.as_deref().map(normalize_default_literal),
                    pk: 0,
                };
                vec![format!(
                    "ALTER TABLE {} ADD COLUMN {}",
                    quote_ident(table),
                    col_definition(&def, &[])
                )]
            }
            SchemaOp::DropColumn { table, name } => vec![format!(
                "ALTER TABLE {} DROP COLUMN {}",
                quote_ident(table),
                quote_ident(name)
            )],
            SchemaOp::CreateIndex {
                table,
                name,
                columns,
                unique,
                ..
            } => {
                if columns.is_empty() {
                    return Err(DbError::InvalidOperation(
                        "an index needs at least one column".into(),
                    ));
                }
                let cols = columns
                    .iter()
                    .map(|c| quote_ident(c))
                    .collect::<Vec<_>>()
                    .join(", ");
                vec![format!(
                    "CREATE {}INDEX {} ON {} ({})",
                    if *unique { "UNIQUE " } else { "" },
                    quote_ident(name),
                    quote_ident(table),
                    cols
                )]
            }
            SchemaOp::DropIndex { index, .. } => {
                vec![format!("DROP INDEX {}", quote_ident(index))]
            }
            SchemaOp::DropTrigger { name } => {
                vec![format!("DROP TRIGGER {}", quote_ident(name))]
            }
            SchemaOp::SetPrimaryKey { .. }
            | SchemaOp::AddForeignKey { .. }
            | SchemaOp::DropConstraint { .. } => {
                return Err(DbError::InvalidOperation(
                    "primary-key / foreign-key editing requires a table rebuild and is \
                     currently supported on PostgreSQL connections only"
                        .into(),
                ));
            }
            SchemaOp::CreateTrigger { sql } => {
                let sql = sql.trim();
                if sql.is_empty() {
                    return Err(DbError::InvalidOperation(
                        "trigger SQL is empty".into(),
                    ));
                }
                if !sql.to_lowercase().starts_with("create trigger")
                    && !sql.to_lowercase().starts_with("create or replace trigger")
                {
                    return Err(DbError::InvalidOperation(
                        "trigger SQL must start with CREATE TRIGGER".into(),
                    ));
                }
                vec![sql.to_string()]
            }
            SchemaOp::AlterColumn { .. } => unreachable!("handled by the caller"),
        })
    }
}

/// Escape a single-quoted SQL string literal (identifier-safe for PRAGMA name args).
pub(super) fn escape_str(s: &str) -> String {
    s.replace('\'', "''")
}

/// Quote an identifier for use inside a DDL/DML statement.
pub(super) fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

#[cfg(test)]
mod trigger_op_tests {
    use super::*;

    #[tokio::test]
    async fn trigger_edit_drop_create_pair_is_atomic() {
        let dir = std::env::temp_dir().join("dh-studio-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("trigop-{}.db", uuid::Uuid::new_v4()));
        let adapter = SqliteAdapter::connect(path).await.unwrap();

        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, qty INTEGER)")
            .execute(&adapter.pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE log (msg TEXT)")
            .execute(&adapter.pool)
            .await
            .unwrap();
        let old_sql = "CREATE TRIGGER audit_qty AFTER UPDATE ON t BEGIN INSERT INTO log VALUES ('u'); END";
        sqlx::query(old_sql).execute(&adapter.pool).await.unwrap();

        // Edit = drop old + create rewritten SQL, in ONE batch.
        let new_sql = "CREATE TRIGGER audit_qty AFTER INSERT ON t BEGIN INSERT INTO log VALUES ('i'); END";
        let ops = vec![
            SchemaOp::DropTrigger { name: "audit_qty".into() },
            SchemaOp::CreateTrigger { sql: new_sql.into() },
        ];
        adapter.apply_schema_ops_batch(&ops).await.unwrap();

        let (schema, _) = adapter.table_schema("t").await.unwrap();
        assert_eq!(schema.triggers.len(), 1);
        assert!(schema.triggers[0].sql.contains("AFTER INSERT"), "trigger was updated");
    }

    #[tokio::test]
    async fn failed_trigger_create_rolls_back_the_drop() {
        let dir = std::env::temp_dir().join("dh-studio-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("trigbad-{}.db", uuid::Uuid::new_v4()));
        let adapter = SqliteAdapter::connect(path).await.unwrap();

        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY)")
            .execute(&adapter.pool)
            .await
            .unwrap();
        let old_sql = "CREATE TRIGGER keep_me AFTER DELETE ON t BEGIN SELECT 1; END";
        sqlx::query(old_sql).execute(&adapter.pool).await.unwrap();

        // The replacement SQL is invalid (missing ON clause) → whole batch
        // must roll back and the original trigger must survive.
        let ops = vec![
            SchemaOp::DropTrigger { name: "keep_me".into() },
            SchemaOp::CreateTrigger { sql: "CREATE TRIGGER broken AFTER ON t BEGIN SELECT 1; END".into() },
        ];
        assert!(adapter.apply_schema_ops_batch(&ops).await.is_err());

        let (schema, _) = adapter.table_schema("t").await.unwrap();
        assert_eq!(schema.triggers.len(), 1, "original trigger must survive");
        assert_eq!(schema.triggers[0].name, "keep_me");
    }
}
