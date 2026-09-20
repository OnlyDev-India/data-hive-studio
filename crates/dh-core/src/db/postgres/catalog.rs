use crate::api::{TableInfo, TableSchema, ColumnInfo, IndexInfo, TriggerInfo};
use crate::db::{DbError, DbResult};
use super::PgAdapter;
use super::sql_text::qualify_regclass;

impl PgAdapter {
    pub(super) async fn list_tables(&self) -> DbResult<Vec<TableInfo>> {
        let schema = self.cur_schema();
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT c.relname, \
             CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' \
                            WHEN 'm' THEN 'matview' ELSE 'other' END \
             FROM pg_class c \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE c.relkind IN ('r','v','m') AND n.nspname = $1 \
             ORDER BY c.relname",
        )
        .bind(&schema)
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows
            .into_iter()
            .map(|(name, kind)| TableInfo { name, kind })
            .collect())
    }

    pub(super) async fn table_schema(
        &self,
        database: Option<&str>,
        schema: Option<&str>,
        table: &str,
    ) -> DbResult<(TableSchema, Vec<String>)> {
        let pool = self.pool_for(database).await?;
        let schema = schema.map(str::to_string).unwrap_or_else(|| self.cur_schema());
        let regclass = qualify_regclass(&schema, table);
        // Every introspection statement rides back WITH the schema — per-call
        // ownership, so concurrent describes never interleave captures.
        let mut statements: Vec<String> = Vec::new();

        // What kind of object this is — views open read-only in the UI.
        let sql_kind = "SELECT CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' \
                    WHEN 'm' THEN 'matview' ELSE 'other' END \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relname = $2";
        let sql_cols = "SELECT column_name, data_type, is_nullable, COALESCE(column_default, '') \
             FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 \
             ORDER BY ordinal_position";
        let sql_pk = "SELECT a.attname FROM pg_index i \
             JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum = ANY(i.indkey) \
             WHERE i.indrelid = $1::regclass AND i.indisprimary";
        // Native enum columns — including ARRAYS of a native enum (a column of
        // type `permission[]` has atttypid = the `_permission` array type, whose
        // typelem points back at the enum; we resolve through it so the column
        // surfaces the enum's labels and is flagged as an array).
        let sql_enums = "SELECT a.attname, \
                (CASE WHEN pt.typelem <> 0 THEN el.typname ELSE pt.typname END), \
                (pt.typelem <> 0) AS is_array, \
                e.enumlabel \
             FROM pg_attribute a \
             JOIN pg_type pt ON a.atttypid = pt.oid \
             LEFT JOIN pg_type el ON pt.typelem <> 0 AND pt.typelem = el.oid \
             JOIN pg_enum e ON e.enumtypid = \
                  CASE WHEN pt.typelem <> 0 THEN pt.typelem ELSE pt.oid END \
             WHERE a.attrelid = $1::regclass \
             ORDER BY a.attnum, e.enumsortorder";
        let sql_fks = "SELECT kcu.column_name, ccu.table_name, ccu.column_name, \
              tc.constraint_name, \
              CASE con.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' \
                   WHEN 'd' THEN 'SET DEFAULT' WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END, \
              CASE con.confupdtype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' \
                   WHEN 'd' THEN 'SET DEFAULT' WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu ON kcu.constraint_name=tc.constraint_name \
             JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name \
             JOIN pg_constraint con ON con.conname = tc.constraint_name \
                  AND con.conrelid = to_regclass(format('%I.%I', tc.table_schema, tc.table_name)) \
             WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_name=$1 AND tc.table_schema=$2";
        let sql_idx = "SELECT indexname, indexdef FROM pg_indexes \
             WHERE schemaname=$1 AND tablename=$2";
        let sql_trig = "SELECT t.tgname, pg_get_triggerdef(t.oid) \
             FROM pg_trigger t WHERE t.tgrelid=$1::regclass AND NOT t.tgisinternal ORDER BY t.tgname";

        // Display copies: real values inlined ($1 -> 'public', …) and a
        // trailing semicolon, so the activity log reads like runnable SQL.
        let st = [Some(schema.clone()), Some(table.to_string())];
        let ts = [Some(table.to_string()), Some(schema.clone())];
        let rg = [Some(regclass.clone())];
        statements.extend([
            super::inline_placeholders(sql_kind, &st, true) + ";",
            super::inline_placeholders(sql_cols, &st, true) + ";",
            super::inline_placeholders(sql_pk, &rg, true) + ";",
            super::inline_placeholders(sql_enums, &rg, true) + ";",
            super::inline_placeholders(sql_fks, &ts, true) + ";",
            super::inline_placeholders(sql_idx, &st, true) + ";",
            super::inline_placeholders(sql_trig, &rg, true) + ";",
        ]);

        // The seven lookups are mutually independent (each only needs the
        // qualified name, known upfront) — run them CONCURRENTLY so a remote
        // server costs one round trip of latency instead of seven.
        let f_kind = sqlx::query_scalar::<_, Option<String>>(sql_kind)
            .bind(&schema)
            .bind(table)
            .fetch_optional(&pool);
        let f_cols = sqlx::query_as::<_, (String, String, String, String)>(sql_cols)
            .bind(&schema)
            .bind(table)
            .fetch_all(&pool);
        let f_pk = sqlx::query_as::<_, (String,)>(sql_pk)
            .bind(&regclass)
            .fetch_all(&pool);
        let f_enums = sqlx::query_as::<_, (String, String, bool, String)>(sql_enums)
            .bind(&regclass)
            .fetch_all(&pool);
        let f_fks = sqlx::query_as::<_, (String, String, String, String, String, String)>(sql_fks)
            .bind(table)
            .bind(&schema)
            .fetch_all(&pool);
        let f_idx = sqlx::query_as::<_, (String, String)>(sql_idx)
            .bind(&schema)
            .bind(table)
            .fetch_all(&pool);
        let f_trig = sqlx::query_as::<_, (String, Option<String>)>(sql_trig)
            .bind(&regclass)
            .fetch_all(&pool);

        // Balanced binary join tree — every branch is polled concurrently.
        let (((r_kind, r_cols), (r_pk, r_enums)), ((r_fks, r_idx), r_trig)) =
            futures_util::future::join(
                futures_util::future::join(
                    futures_util::future::join(f_kind, f_cols),
                    futures_util::future::join(f_pk, f_enums),
                ),
                futures_util::future::join(futures_util::future::join(f_fks, f_idx), f_trig),
            )
            .await;

        let object_kind: Option<Option<String>> = r_kind.map_err(DbError::SqlEngine)?;
        let columns: Vec<(String, String, String, String)> = r_cols.map_err(DbError::SqlEngine)?;
        let pk_rows: Vec<(String,)> = r_pk.map_err(DbError::SqlEngine)?;
        let enum_rows: Vec<(String, String, bool, String)> = r_enums.map_err(DbError::SqlEngine)?;
        let fk_rows: Vec<(String, String, String, String, String, String)> = r_fks.map_err(DbError::SqlEngine)?;
        let idx_rows: Vec<(String, String)> = r_idx.map_err(DbError::SqlEngine)?;
        let trig_rows: Vec<(String, Option<String>)> = r_trig.map_err(DbError::SqlEngine)?;

        let pk_set: std::collections::HashSet<String> =
            pk_rows.into_iter().map(|(n,)| n).collect();

        let mut cols: Vec<ColumnInfo> = columns
            .into_iter()
            .map(|(name, data_type, nullable, default)| ColumnInfo {
                name,
                data_type,
                not_null: nullable == "NO",
                primary_key: false,
                default: if default.is_empty() { None } else { Some(default) },
                enum_values: Vec::new(),
                is_array: false,
            })
            .map(|mut c| {
                c.primary_key = pk_set.contains(&c.name);
                c
            })
            .collect();

        // Native enum columns: resolve the UDT name and its labels, then
        // surface them on the column (header shows the type name; editors
        // show the labels as a dropdown).
        let mut enum_labels: std::collections::HashMap<
            String,
            (String, bool, Vec<String>),
        > = std::collections::HashMap::new();
        for (col, typname, is_array, label) in enum_rows {
            let entry = enum_labels
                .entry(col)
                .or_insert_with(|| (typname.clone(), is_array, Vec::new()));
            entry.2.push(label);
        }
        for c in &mut cols {
            if let Some((typname, is_array, labels)) = enum_labels.get(&c.name) {
                c.data_type = if *is_array {
                    format!("{}[]", typname)
                } else {
                    typname.clone()
                };
                c.enum_values = labels.clone();
                c.is_array = *is_array;
            }
        }

        let foreign_keys: Vec<crate::api::ForeignKeyInfo> = fk_rows
            .into_iter()
            .filter(|(_c, rt, _rc, _n, _d, _u)| !rt.is_empty())
            .map(|(column, referenced_table, referenced_column, name, on_delete, on_update)| crate::api::ForeignKeyInfo {
                column,
                referenced_table,
                referenced_column,
                name: (!name.is_empty()).then_some(name),
                on_delete: Some(on_delete),
                on_update: Some(on_update),
            })
            .collect();

        let mut indexes = Vec::new();
        for (name, def) in idx_rows {
            let unique = def.to_uppercase().contains("UNIQUE");
            // Parse "(a, b)" tail of the definition for covered columns.
            let cols_part = def.split('(').nth(1).unwrap_or("").rsplit(')').next().unwrap_or("");
            let columns: Vec<String> = cols_part
                .split(',')
                .map(|c| c.trim().trim_matches('"').to_string())
                .filter(|c| !c.is_empty())
                .collect();
            if columns.is_empty() {
                continue;
            }
            indexes.push(IndexInfo {
                name,
                unique,
                columns,
                origin: "c".into(),
                column_dirs: None,
                sparse: None,
                ttl_seconds: None,
                partial_filter: None,
            });
        }

        let triggers = trig_rows
            .into_iter()
            .filter_map(|(name, sql)| {
                let sql = sql?;
                Some(TriggerInfo {
                    timing: String::new(),
                    event: String::new(),
                    name,
                    sql,
                })
            })
            .collect();

        Ok((
            TableSchema {
                kind: object_kind.flatten().unwrap_or_else(|| "table".to_string()),
                columns: cols,
                foreign_keys,
                indexes,
                triggers,
            },
            statements,
        ))
    }

    pub(super) async fn list_schemas(&self) -> DbResult<Vec<String>> {
        // User-facing schemas only: pg_* internals and information_schema
        // stay hidden (the SQL console can still reach them by hand).
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT nspname FROM pg_namespace \
             WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' \
             ORDER BY (nspname = 'public') DESC, nspname",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows.into_iter().map(|(n,)| n).collect())
    }

    pub(super) async fn list_databases(&self) -> DbResult<Vec<String>> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows.into_iter().map(|(n,)| n).collect())
    }

    pub(super) async fn list_schemas_in(&self, database: Option<&str>) -> DbResult<Vec<String>> {
        let pool = self.pool_for(database).await?;
        // Same query as `list_schemas`, just against a possibly-secondary pool.
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT nspname FROM pg_namespace \
             WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' \
             ORDER BY (nspname = 'public') DESC, nspname",
        )
        .fetch_all(&pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows.into_iter().map(|(n,)| n).collect())
    }

    pub(super) async fn disconnect_database(&self, database: &str) -> DbResult<()> {
        if database == self.database {
            return Err(DbError::InvalidOperation(
                "cannot disconnect this connection's own primary database this way — \
                 disconnect the whole connection instead"
                    .into(),
            ));
        }
        // A no-op (Ok, not an error) if nothing was ever opened for it —
        // browsing it just never got that far, nothing to close.
        let pool = self.secondary_pools.lock().unwrap().remove(database).map(|(p, _)| p);
        if let Some(pool) = pool {
            pool.close().await;
        }
        Ok(())
    }

    pub(super) async fn set_active_schema(&self, schema: &str) -> DbResult<()> {
        let exists: Option<i32> = sqlx::query_scalar(
            "SELECT 1 FROM pg_namespace WHERE nspname = $1",
        )
        .bind(schema)
        .fetch_optional(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        if exists.is_none() {
            return Err(DbError::InvalidOperation(format!(
                "schema \"{schema}\" does not exist on this server"
            )));
        }
        *self.schema.write().unwrap() = schema.to_string();
        Ok(())
    }

    pub(super) async fn active_schema(&self) -> DbResult<String> {
        Ok(self.cur_schema())
    }
}
