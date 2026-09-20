use crate::db::{DbError, DbResult, RoleDetail, SchemaObject, SchemaObjectKind};
use super::PgAdapter;

impl PgAdapter {
    pub(super) async fn list_roles(&self) -> DbResult<Vec<SchemaObject>> {
        // Cluster-wide — roles aren't owned by any one database, so this
        // always runs on the primary pool regardless of which database's
        // tree node it's rendered under in the sidebar.
        let rows: Vec<(String, bool, bool)> = sqlx::query_as(
            "SELECT rolname, rolsuper, rolcanlogin FROM pg_roles ORDER BY rolname",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows
            .into_iter()
            .map(|(name, superuser, can_login)| {
                let bits: Vec<&str> = [
                    superuser.then_some("superuser"),
                    can_login.then_some("login"),
                ]
                .into_iter()
                .flatten()
                .collect();
                let extra = (!bits.is_empty()).then(|| bits.join(", "));
                SchemaObject { name, extra }
            })
            .collect())
    }

    pub(super) async fn list_extensions(&self, database: Option<&str>) -> DbResult<Vec<SchemaObject>> {
        let pool = self.pool_for(database).await?;
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT extname, extversion FROM pg_extension ORDER BY extname",
        )
        .fetch_all(&pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows
            .into_iter()
            .map(|(name, version)| SchemaObject {
                name,
                extra: Some(version),
            })
            .collect())
    }

    pub(super) async fn list_role_details(&self) -> DbResult<Vec<RoleDetail>> {
        #[allow(clippy::type_complexity)]
        let rows: Vec<(
            String,
            bool,
            bool,
            bool,
            bool,
            bool,
            bool,
            i32,
            Option<String>,
            Option<String>,
            Option<Vec<String>>,
        )> = sqlx::query_as(
            "SELECT r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole, \
                    r.rolcanlogin, r.rolreplication, r.rolbypassrls, r.rolconnlimit, \
                    r.rolvaliduntil::text, \
                    pg_catalog.shobj_description(r.oid, 'pg_authid'), \
                    (SELECT array_agg(m.rolname ORDER BY m.rolname) \
                     FROM pg_auth_members am JOIN pg_roles m ON m.oid = am.roleid \
                     WHERE am.member = r.oid) \
             FROM pg_roles r ORDER BY r.rolname",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(DbError::SqlEngine)?;
        Ok(rows
            .into_iter()
            .map(
                |(
                    name,
                    superuser,
                    createdb,
                    createrole,
                    can_login,
                    replication,
                    bypassrls,
                    conn_limit,
                    valid_until,
                    comment,
                    member_of,
                )| {
                    let attributes: Vec<String> = [
                        superuser.then_some("Superuser"),
                        createdb.then_some("Create DB"),
                        createrole.then_some("Create Role"),
                        can_login.then_some("Login"),
                        replication.then_some("Replication"),
                        bypassrls.then_some("Bypass RLS"),
                    ]
                    .into_iter()
                    .flatten()
                    .map(String::from)
                    .collect();
                    RoleDetail {
                        name,
                        attributes,
                        can_login,
                        superuser,
                        conn_limit,
                        valid_until,
                        comment,
                        member_of: member_of.unwrap_or_default(),
                    }
                },
            )
            .collect())
    }

    /// Tables/Views/Materialized Views/Procedures/Functions/Sequences/Types
    /// in one schema — the sidebar catalog tree's per-schema category rows.
    /// `database` targets a sibling database via `pool_for` when set.
    pub(super) async fn list_schema_objects(
        &self,
        database: Option<&str>,
        schema: &str,
        kind: SchemaObjectKind,
    ) -> DbResult<Vec<SchemaObject>> {
        let pool = self.pool_for(database).await?;
        match kind {
            SchemaObjectKind::Table | SchemaObjectKind::View | SchemaObjectKind::MaterializedView => {
                let relkind = match kind {
                    SchemaObjectKind::Table => "r",
                    SchemaObjectKind::View => "v",
                    SchemaObjectKind::MaterializedView => "m",
                    _ => unreachable!(),
                };
                let rows: Vec<(String,)> = sqlx::query_as(
                    "SELECT c.relname FROM pg_class c \
                     JOIN pg_namespace n ON n.oid = c.relnamespace \
                     WHERE c.relkind = $1 AND n.nspname = $2 \
                     ORDER BY c.relname",
                )
                .bind(relkind)
                .bind(schema)
                .fetch_all(&pool)
                .await
                .map_err(DbError::SqlEngine)?;
                Ok(rows
                    .into_iter()
                    .map(|(name,)| SchemaObject { name, extra: None })
                    .collect())
            }
            SchemaObjectKind::Procedure | SchemaObjectKind::Function => {
                // `prokind`: 'f' = function, 'p' = procedure. Excludes 'c'/
                // 'internal' language routines (built-ins, not user-defined).
                let prokind = if kind == SchemaObjectKind::Procedure {
                    "p"
                } else {
                    "f"
                };
                let rows: Vec<(String, String)> = sqlx::query_as(
                    "SELECT p.proname, \
                            p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' \
                     FROM pg_proc p \
                     JOIN pg_namespace n ON n.oid = p.pronamespace \
                     JOIN pg_language l ON l.oid = p.prolang \
                     WHERE p.prokind = $1 AND n.nspname = $2 \
                       AND l.lanname NOT IN ('c', 'internal') \
                     ORDER BY p.proname LIMIT 500",
                )
                .bind(prokind)
                .bind(schema)
                .fetch_all(&pool)
                .await
                .map_err(DbError::SqlEngine)?;
                Ok(rows
                    .into_iter()
                    .map(|(name, signature)| SchemaObject {
                        name,
                        extra: Some(signature),
                    })
                    .collect())
            }
            SchemaObjectKind::Sequence => {
                let rows: Vec<(String, Option<String>)> = sqlx::query_as(
                    "SELECT sequencename, COALESCE(last_value::text, '-') \
                     FROM pg_sequences WHERE schemaname = $1 ORDER BY sequencename",
                )
                .bind(schema)
                .fetch_all(&pool)
                .await
                .map_err(DbError::SqlEngine)?;
                Ok(rows
                    .into_iter()
                    .map(|(name, last)| SchemaObject { name, extra: last })
                    .collect())
            }
            SchemaObjectKind::Type => {
                // Same shape psql's own `\dT` uses: base/enum/composite/range/
                // domain types actually defined in this schema — excludes
                // array types (typcategory 'A', auto-created alongside every
                // other type) and table row types (typrelid pointing at an
                // ordinary table rather than a standalone composite type).
                // `extra` is what's actually INSIDE the type — an enum's
                // labels, a composite's field list, or a domain's base type
                // — so the sidebar shows more than just a bare name.
                let rows: Vec<(String, Option<String>)> = sqlx::query_as(
                    "SELECT t.typname, \
                            CASE t.typtype \
                                WHEN 'e' THEN ( \
                                    SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) \
                                    FROM pg_enum e WHERE e.enumtypid = t.oid \
                                ) \
                                WHEN 'c' THEN ( \
                                    SELECT string_agg( \
                                        a.attname || ' ' || format_type(a.atttypid, a.atttypmod), \
                                        ', ' ORDER BY a.attnum \
                                    ) \
                                    FROM pg_attribute a \
                                    WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped \
                                ) \
                                WHEN 'd' THEN format_type(t.typbasetype, t.typtypmod) \
                                ELSE NULL \
                            END \
                     FROM pg_type t \
                     JOIN pg_namespace n ON n.oid = t.typnamespace \
                     WHERE n.nspname = $1 AND t.typcategory <> 'A' \
                       AND (t.typrelid = 0 \
                            OR (SELECT c.relkind FROM pg_class c WHERE c.oid = t.typrelid) = 'c') \
                     ORDER BY t.typname",
                )
                .bind(schema)
                .fetch_all(&pool)
                .await
                .map_err(DbError::SqlEngine)?;
                Ok(rows
                    .into_iter()
                    .map(|(name, extra)| SchemaObject { name, extra })
                    .collect())
            }
        }
    }

    /// Schemas + databases + active schema, ONE round trip. The three lists
    /// used to be separate queries; on remote servers (Neon) they serialized
    /// behind the pool and delayed every query that followed.
    pub(super) async fn catalog_overview(&self) -> DbResult<super::CatalogOverview> {
        let sql = "\
            SELECT COALESCE((\
                SELECT json_agg(nspname ORDER BY nspname) FROM pg_namespace \
                WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'\
            ), '[]'), \
            COALESCE((\
                SELECT json_agg(datname ORDER BY datname) FROM pg_database \
                WHERE datistemplate = false\
            ), '[]'), \
            current_schema()::text";
        let (schemas_v, databases_v, active): (
            serde_json::Value,
            serde_json::Value,
            String,
        ) = sqlx::query_as(sql)
            .fetch_one(&self.pool)
            .await
            .map_err(DbError::SqlEngine)?;
        let to_vec = |v: &serde_json::Value| -> Vec<String> {
            v.as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default()
        };
        Ok(super::CatalogOverview {
            schemas: to_vec(&schemas_v),
            databases: to_vec(&databases_v),
            active_schema: active,
        })
    }
}
