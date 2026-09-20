use sqlx::Connection as _;
use crate::api::SchemaOp;
use crate::db::{DbError, DbResult};
use super::PgAdapter;
use super::sql_text::{q, tq};

impl PgAdapter {
    // Identifier safety: q() doubles embedded quotes, so interpolated names
    // cannot break out of the quoted identifier.
    pub(super) async fn create_database(&self, name: &str) -> DbResult<()> {
        self.guard.check_write("create database")?;
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::InvalidOperation(
                "database name must not be empty".into(),
            ));
        }
        let sql = format!("CREATE DATABASE {}", q(name));
        sqlx::query(&sql)
            .execute(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        Ok(())
    }

    pub(super) async fn drop_database(&self, name: &str) -> DbResult<()> {
        self.guard.check_write("drop database")?;
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::InvalidOperation(
                "database name must not be empty".into(),
            ));
        }
        if name == self.database {
            return Err(DbError::InvalidOperation(
                "cannot drop the database this connection is attached to — open a different database first".into(),
            ));
        }
        let sql = format!("DROP DATABASE IF EXISTS {} WITH (FORCE)", q(name));
        sqlx::query(&sql)
            .execute(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        Ok(())
    }

    pub(super) async fn create_schema(&self, name: &str) -> DbResult<()> {
        self.guard.check_write("create schema")?;
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::InvalidOperation(
                "schema name must not be empty".into(),
            ));
        }
        let sql = format!("CREATE SCHEMA IF NOT EXISTS {}", q(name));
        sqlx::query(&sql)
            .execute(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        Ok(())
    }

    pub(super) async fn drop_schema(&self, name: &str, cascade: bool) -> DbResult<()> {
        self.guard.check_write("drop schema")?;
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::InvalidOperation(
                "schema name must not be empty".into(),
            ));
        }
        if name.eq_ignore_ascii_case("public") {
            return Err(DbError::InvalidOperation(
                "the default 'public' schema cannot be dropped".into(),
            ));
        }
        let cascade_sql = if cascade { " CASCADE" } else { "" };
        let sql = format!("DROP SCHEMA IF EXISTS {}{cascade_sql}", q(name));
        sqlx::query(&sql)
            .execute(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        // If the user dropped the ACTIVE schema, fall back to public so
        // subsequent unqualified operations keep working.
        if self.cur_schema() == name {
            *self.schema.write().unwrap() = "public".to_string();
        }
        Ok(())
    }

    pub(super) async fn apply_schema_ops_batch(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        ops: &[SchemaOp],
    ) -> DbResult<Vec<String>> {
        if !ops.is_empty() {
            self.guard.check_write("schema changes")?;
        }
        let pool = self.pool_for(database).await?;
        let mut conn = pool.acquire().await.map_err(DbError::SqlEngine)?;
        let mut tx = conn.begin().await.map_err(DbError::SqlEngine)?;
        // Transaction-local search_path: every unqualified name in the DDL
        // batch resolves inside the active schema. SET LOCAL dies with the
        // transaction, so pooled connections stay clean (PgBouncer-safe).
        let schema = schema.map(str::to_string).unwrap_or_else(|| self.cur_schema());
        sqlx::query(&format!("SET LOCAL search_path = {}", q(&schema)))
            .execute(&mut *tx)
            .await
            .map_err(DbError::SqlEngine)?;
        let mut executed = vec![format!("SET LOCAL search_path = {}", q(&schema))];
        for op in ops {
            let stmts: Vec<String> = match op {
                SchemaOp::RenameTable { table, new_name } => {
                    vec![format!("ALTER TABLE {} RENAME TO {}", q(table), q(new_name))]
                }
                SchemaOp::AddColumn { table, name, data_type, not_null, default } => {
                    let nn = if *not_null && default.is_some() { " NOT NULL" } else { "" };
                    let dflt = default
                        .as_deref()
                        .map(|d| format!(" DEFAULT {d}"))
                        .unwrap_or_default();
                    vec![format!(
                        "ALTER TABLE {} ADD COLUMN {} {}{nn}{dflt}",
                        q(table),
                        q(name),
                        if data_type.trim().is_empty() { "TEXT" } else { data_type.trim() }
                    )]
                }
                SchemaOp::DropColumn { table, name } => {
                    vec![format!("ALTER TABLE {} DROP COLUMN {}", q(table), q(name))]
                }
                SchemaOp::AlterColumn { table, column, new_name, data_type, not_null, default_mode, default_value } => {
                    // Postgres handles every change IN PLACE — no rebuild
                    // needed (unlike SQLite). Rename is its own statement;
                    // the rest compose into one ALTER with clause list.
                    // NOTE: this arm ONLY builds statements — the batch loop
                    // below owns execution. Double-executing DDL here caused
                    // renames to fail with "column does not exist".
                    let mut ran: Vec<String> = Vec::new();
                    if let Some(n) = new_name {
                        let n = n.trim();
                        if n != column {
                            ran.push(format!(
                                "ALTER TABLE {} RENAME COLUMN {} TO {};",
                                q(table),
                                q(column),
                                q(n)
                            ));
                        }
                    }
                    let mut clauses: Vec<String> = Vec::new();
                    let ac = format!("ALTER COLUMN {}", q(column));
                    let new_type = data_type.as_deref().map(str::trim).filter(|t| !t.is_empty());
                    if let Some(t) = new_type {
                        clauses.push(format!("{ac} TYPE {t} USING {ac2}::{t}", ac2 = q(column)));
                    }
                    match not_null {
                        Some(true) => clauses.push(format!("{ac} SET NOT NULL")),
                        Some(false) => clauses.push(format!("{ac} DROP NOT NULL")),
                        None => {}
                    }
                    match default_mode {
                        Some(crate::api::DefaultMode::Set) => {
                            let v = default_value.clone().unwrap_or_default();
                            if v.trim().is_empty() {
                                clauses.push(format!("{ac} DROP DEFAULT"));
                            } else {
                                clauses.push(format!("{ac} SET DEFAULT {}", v));
                            }
                        }
                        Some(crate::api::DefaultMode::Drop) => {
                            clauses.push(format!("{ac} DROP DEFAULT"))
                        }
                        Some(crate::api::DefaultMode::Keep) | None => {}
                    }
                    if !clauses.is_empty() {
                        let s = format!(
                            "ALTER TABLE {} {};",
                            q(table),
                            clauses.join(", ")
                        );
                        sqlx::query(&s).execute(&mut *tx).await.map_err(DbError::SqlEngine)?;
                        ran.push(s);
                    }
                    if ran.is_empty() {
                        return Err(DbError::InvalidOperation(
                            "alter column: nothing to change".into(),
                        ));
                    }
                    ran
                }
                SchemaOp::CreateIndex { table, name, columns, unique, .. } => {
                    let u = if *unique { "UNIQUE " } else { "" };
                    let cols = columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
                    vec![format!(
                        "CREATE {u}INDEX {} ON {} ({cols})",
                        q(name),
                        q(table)
                    )]
                }
                SchemaOp::DropIndex { index, .. } => {
                    vec![format!("DROP INDEX {}", q(index))]
                }
                SchemaOp::DropTrigger { name } => {
                    vec![format!("DROP TRIGGER IF EXISTS {}", q(name))]
                }
                SchemaOp::CreateTrigger { sql } => {
                    let s = sql.trim();
                    if !s.to_uppercase().starts_with("CREATE TRIGGER") {
                        return Err(DbError::InvalidOperation(
                            "trigger SQL must start with CREATE TRIGGER".into(),
                        ));
                    }
                    vec![s.to_string()]
                }
                SchemaOp::SetPrimaryKey { table, columns } => {
                    let pkey = format!("{}_pkey", table);
                    if columns.is_empty() {
                        vec![format!(
                            "ALTER TABLE {} DROP CONSTRAINT IF EXISTS {};",
                            q(table),
                            q(&pkey)
                        )]
                    } else {
                        let cols = columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
                        vec![format!(
                            "ALTER TABLE {} DROP CONSTRAINT IF EXISTS {}, ADD PRIMARY KEY ({cols});",
                            q(table),
                            q(&pkey)
                        )]
                    }
                }
                SchemaOp::AddForeignKey {
                    table,
                    columns,
                    ref_table,
                    ref_columns,
                    on_delete,
                    on_update,
                } => {
                    // Whitelist the referential actions — they are interpolated.
                    const ACTIONS: [&str; 5] =
                        ["CASCADE", "SET NULL", "SET DEFAULT", "RESTRICT", "NO ACTION"];
                    let action = |v: &Option<String>| -> Option<&'static str> {
                        v.as_deref().map(str::trim).and_then(|a| {
                            ACTIONS.iter().find(|k| k.eq_ignore_ascii_case(a)).copied()
                        })
                    };
                    let cols = columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
                    let rcols = ref_columns.iter().map(|c| q(c)).collect::<Vec<_>>().join(", ");
                    let mut s = format!(
                        "ALTER TABLE {} ADD CONSTRAINT {} FOREIGN KEY ({cols}) REFERENCES {} ({rcols})",
                        q(table),
                        q(&format!("fk_{}_{}", table, columns.join("_"))),
                        q(ref_table)
                    );
                    if let Some(a) = action(on_delete) {
                        s.push_str(&format!(" ON DELETE {a}"));
                    }
                    if let Some(a) = action(on_update) {
                        s.push_str(&format!(" ON UPDATE {a}"));
                    }
                    s.push(';');
                    vec![s]
                }
                SchemaOp::DropConstraint { table, name } => {
                    vec![format!(
                        "ALTER TABLE {} DROP CONSTRAINT IF EXISTS {};",
                        q(table),
                        q(name)
                    )]
                }
            };
            for st in &stmts {
                sqlx::query(st).execute(&mut *tx).await.map_err(DbError::SqlEngine)?;
                executed.push(st.clone());
            }
        }
        tx.commit().await.map_err(DbError::SqlEngine)?;
        // DDL may have changed columns/types — drop every cached map so the
        // next write re-introspects.
        self.type_cache.lock().unwrap().clear();
        Ok(executed)
    }

    /// Duplicate a plain table: `LIKE … INCLUDING ALL` copies columns,
    /// defaults, NOT NULL, CHECKs and all indexes (PRIMARY KEY included).
    /// Postgres deliberately excludes FOREIGN KEY constraints from LIKE —
    /// documented limitation, same as pg_dump's --no-owner style copies.
    pub(super) async fn duplicate_table(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        source: &str,
        target: &str,
        _copy_data: bool,
    ) -> DbResult<Vec<String>> {
        self.guard.check_write("duplicate table")?;
        // TODO(postgres duplicate UI): honor copy_data once Postgres gets the
        // same copy-data checkbox as Mongo's "Duplicate collection" — for now
        // this always copies structure + indexes + data, matching prior
        // behavior before the flag existed.
        let pool = self.pool_for(database).await?;
        let schema = schema.map(str::to_string).unwrap_or_else(|| self.cur_schema());
        let kind: Option<String> = sqlx::query_scalar(
            "SELECT CASE c.relkind WHEN 'r' THEN 'table' ELSE NULL END \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relname = $2",
        )
        .bind(&schema)
        .bind(source)
        .fetch_optional(&pool)
        .await
        .map_err(DbError::SqlEngine)?;
        if kind.is_none() {
            return Err(DbError::InvalidOperation(format!(
                "\"{source}\" is not a plain table — only tables can be duplicated on Postgres"
            )));
        }
        let create = format!(
            "CREATE TABLE {} (LIKE {} INCLUDING ALL)",
            tq(&schema, target),
            tq(&schema, source)
        );
        let copy = format!(
            "INSERT INTO {} SELECT * FROM {}",
            tq(&schema, target),
            tq(&schema, source)
        );
        sqlx::query(&create)
            .execute(&pool)
            .await
            .map_err(DbError::SqlEngine)?;
        sqlx::query(&copy)
            .execute(&pool)
            .await
            .map_err(DbError::SqlEngine)?;
        Ok(vec![format!("{create};"), format!("{copy};")])
    }

    pub(super) async fn refresh_matview(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        name: &str,
    ) -> DbResult<()> {
        self.guard.check_write("refresh materialized view")?;
        let pool = self.pool_for(database).await?;
        let schema = schema.map(str::to_string).unwrap_or_else(|| self.cur_schema());
        let sql = format!("REFRESH MATERIALIZED VIEW {}", tq(&schema, name));
        sqlx::query(&sql)
            .execute(&pool)
            .await
            .map_err(DbError::SqlEngine)?;
        Ok(())
    }
}
