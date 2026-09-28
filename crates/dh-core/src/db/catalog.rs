use crate::api::{FieldShape, TableInfo, TableSchema};
use super::types::{CatalogOverview, DbResult, RoleDetail, SchemaObject, SchemaObjectKind};
use super::registry::with_connection;

pub async fn list_tables(conn_id: &str) -> DbResult<Vec<TableInfo>> {
    with_connection(conn_id, |a| async move { a.list_tables().await }).await
}

/// Schemas the user can switch between on this connection.
pub async fn list_schemas(conn_id: &str) -> DbResult<Vec<String>> {
    with_connection(conn_id, |a| async move { a.list_schemas().await }).await
}

/// Databases reachable with this connection's server credentials.
pub async fn list_databases(conn_id: &str) -> DbResult<Vec<String>> {
    with_connection(conn_id, |a| async move { a.list_databases().await }).await
}

/// Schemas within `database` (`None` = this connection's own database) —
/// the sidebar catalog tree's per-database schema list.
pub async fn list_schemas_in(conn_id: &str, database: Option<&str>) -> DbResult<Vec<String>> {
    let database = database.map(str::to_string);
    with_connection(conn_id, |a| async move {
        a.list_schemas_in(database.as_deref()).await
    })
    .await
}

/// Objects of one kind (table/view/matview/procedure/function/sequence/type)
/// in one schema of `database` (`None` = this connection's own database) —
/// the sidebar catalog tree's per-schema category rows.
pub async fn list_schema_objects(
    conn_id: &str,
    database: Option<&str>,
    schema: &str,
    kind: SchemaObjectKind,
) -> DbResult<Vec<SchemaObject>> {
    let database = database.map(str::to_string);
    let schema = schema.to_string();
    with_connection(conn_id, |a| async move {
        a.list_schema_objects(database.as_deref(), &schema, kind)
            .await
    })
    .await
}

/// Server-wide roles (Postgres) — the sidebar catalog tree's "Users &
/// Privileges" row, shown once per connection regardless of which database
/// node it's rendered under.
pub async fn list_roles(conn_id: &str) -> DbResult<Vec<SchemaObject>> {
    with_connection(conn_id, |a| async move { a.list_roles().await }).await
}

/// Full role attribute set — the Users & Privileges tab.
pub async fn list_role_details(conn_id: &str) -> DbResult<Vec<RoleDetail>> {
    with_connection(conn_id, |a| async move { a.list_role_details().await }).await
}

/// Installed extensions (Postgres) — the sidebar catalog tree's "Extensions"
/// row, shown once per database node (`database` = `None` for this
/// connection's own).
pub async fn list_extensions(
    conn_id: &str,
    database: Option<&str>,
) -> DbResult<Vec<SchemaObject>> {
    let database = database.map(str::to_string);
    with_connection(conn_id, |a| async move {
        a.list_extensions(database.as_deref()).await
    })
    .await
}

/// Close ONE sibling database's own connection right now — the sidebar's
/// per-database "Disconnect".
pub async fn disconnect_database(conn_id: &str, database: &str) -> DbResult<()> {
    let database = database.to_string();
    with_connection(conn_id, |a| async move { a.disconnect_database(&database).await }).await
}

/// Schemas + databases + active schema in ONE catalog round trip.
pub async fn catalog_overview(conn_id: &str) -> DbResult<CatalogOverview> {
    with_connection(conn_id, |a| async move { a.catalog_overview().await }).await
}

/// The recursively inferred nested field shape for a MongoDB collection
/// (spec 0001's "Fields" view). Logged like `table_schema` (kind "schema",
/// origin "app") since it's an app-driven schema read, not something typed
/// into a console.
pub async fn field_tree(
    conn_id: &str,
    database: &str,
    collection: &str,
) -> DbResult<Vec<FieldShape>> {
    let t = std::time::Instant::now();
    let target = format!("field tree {collection}");
    let res = with_connection(conn_id, |a| async move {
        a.field_tree(database, collection).await
    })
    .await;
    match &res {
        Ok(_) => crate::activity::log_ok_origin(conn_id, "schema", &target, t, 0, "app"),
        Err(e) => crate::activity::log_err_origin(conn_id, "schema", &target, t, e, "app"),
    }
    res
}

named_ddl_op!(set_active_schema, set_active_schema, "schema", "SET SCHEMA {}");

/// Create a new collection (MongoDB). `database` (`None` = this
/// connection's own primary database) targets a sibling database's catalog
/// tree row — hand-written instead of `named_ddl_op!` for the extra param,
/// same owned-to-borrowed conversion reason as `list_schema_objects`.
pub async fn create_collection(
    conn_id: &str,
    database: Option<&str>,
    name: &str,
) -> DbResult<()> {
    let t = std::time::Instant::now();
    let target = format!("db.createCollection(\"{name}\")");
    let database = database.map(str::to_string);
    let name = name.to_string();
    let res = with_connection(conn_id, move |a| async move {
        a.create_collection(database.as_deref(), &name).await
    })
    .await;
    match &res {
        Ok(()) => crate::activity::log_ok_origin(conn_id, "ddl", &target, t, 0, "app"),
        Err(e) => crate::activity::log_err_origin(conn_id, "ddl", &target, t, e, "app"),
    }
    res
}

/// Refresh a materialized view. `database`/`schema`: `None` = this
/// connection's own primary database / active schema — see
/// `DbAdapter::table_schema`'s doc comment for the general semantics. A
/// sidebar action, never the editor — app-initiated.
pub async fn refresh_matview(
    conn_id: &str,
    database: Option<&str>,
    schema: Option<&str>,
    name: &str,
) -> DbResult<()> {
    let t = std::time::Instant::now();
    let target = format!("REFRESH MATERIALIZED VIEW {name}");
    let name = name.to_string();
    let database = database.map(str::to_string);
    let schema = schema.map(str::to_string);
    let res = with_connection(conn_id, move |a| async move {
        a.refresh_matview(database.as_deref(), schema.as_deref(), &name).await
    })
    .await;
    match &res {
        Ok(()) => crate::activity::log_ok_origin(conn_id, "ddl", &target, t, 0, "app"),
        Err(e) => crate::activity::log_err_origin(conn_id, "ddl", &target, t, e, "app"),
    }
    res
}

/// Drop a schema; `cascade` also drops every object inside it. A
/// sidebar/schema-designer action, never the editor — app-initiated.
pub async fn drop_schema(conn_id: &str, name: &str, cascade: bool) -> DbResult<()> {
    let t = std::time::Instant::now();
    let target = format!("DROP SCHEMA {}{}", name, if cascade { " CASCADE" } else { "" });
    let name = name.to_string();
    let res = with_connection(conn_id, move |a| async move {
        a.drop_schema(&name, cascade).await
    })
    .await;
    match &res {
        Ok(()) => crate::activity::log_ok_origin(conn_id, "drop_table", &target, t, 0, "app"),
        Err(e) => crate::activity::log_err_origin(conn_id, "drop_table", &target, t, e, "app"),
    }
    res
}

/// The schema unqualified operations currently target.
pub async fn active_schema(conn_id: &str) -> DbResult<String> {
    with_connection(conn_id, |a| async move { a.active_schema().await }).await
}

/// Schema introspection — the Schema tab, the sidebar tree, and autocomplete
/// prefetching all funnel through here, and none of them are the SQL/Mongo
/// editor, so this always logs as app-initiated (see `run_sql`/`run_mongo`
/// for the only "user" sources).
pub async fn table_schema(
    conn_id: &str,
    database: Option<&str>,
    schema: Option<&str>,
    table: &str,
) -> DbResult<TableSchema> {
    let t = std::time::Instant::now();
    let target = format!("describe {table}");
    let table = table.to_string();
    let database = database.map(str::to_string);
    let schema = schema.map(str::to_string);
    // The adapter hands back its introspection statements with the schema —
    // per-call ownership, so concurrent describes can't interleave captures.
    let res = with_connection(conn_id, move |a| async move {
        a.table_schema(database.as_deref(), schema.as_deref(), &table).await
    })
    .await;
    match &res {
        Ok((_, stmts)) if !stmts.is_empty() => {
            crate::activity::log_stmt_ok_origin(conn_id, "schema", &stmts.join("\n\n"), t, 0, "app")
        }
        Ok(_) => crate::activity::log_ok_origin(conn_id, "schema", &target, t, 0, "app"),
        Err(e) => crate::activity::log_err_origin(conn_id, "schema", &target, t, e, "app"),
    }
    res.map(|(schema, _)| schema)
}
