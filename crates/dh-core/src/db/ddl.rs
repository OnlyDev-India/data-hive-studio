use crate::api::SchemaOp;
use super::types::DbResult;
use super::registry::with_connection;

named_ddl_op!(create_database, create_database, "ddl", "CREATE DATABASE {}");

named_ddl_op!(drop_database, drop_database, "drop_table", "DROP DATABASE {}");

named_ddl_op!(create_schema, create_schema, "ddl", "CREATE SCHEMA {}");

pub async fn save_database(conn_id: &str) -> DbResult<Vec<u8>> {
    let conn_id = conn_id.to_string();
    with_connection(&conn_id, |a| async move { a.save_bytes().await }).await
}

/// Duplicate a table/collection under a new name. `copy_data` controls
/// whether documents are copied too (MongoDB only for now — SQL adapters
/// always copy structure + indexes + data regardless of this flag, pending
/// the same UI for SQL tables). A sidebar action, never the editor —
/// app-initiated.
pub async fn duplicate_table(
    conn_id: &str,
    database: Option<&str>,
    schema: Option<&str>,
    source: &str,
    target: &str,
    copy_data: bool,
) -> DbResult<Vec<String>> {
    let t = std::time::Instant::now();
    let label = format!(
        "{source} → {target}{}",
        if copy_data { "" } else { " (structure only)" }
    );
    let source = source.to_string();
    let target = target.to_string();
    let database = database.map(str::to_string);
    let schema = schema.map(str::to_string);
    let res = with_connection(conn_id, move |a| async move {
        a.duplicate_table(database.as_deref(), schema.as_deref(), &source, &target, copy_data)
            .await
    })
    .await;
    match &res {
        // The adapter returns every statement it ran — one entry, its own SQL.
        Ok(stmts) if !stmts.is_empty() => {
            crate::activity::log_stmt_ok_origin(conn_id, "duplicate", &format!("{};", stmts.join("\n\n")), t, 0, "app")
        }
        Ok(_) => crate::activity::log_ok_origin(conn_id, "duplicate", &label, t, 0, "app"),
        Err(e) => crate::activity::log_err_origin(conn_id, "duplicate", &label, t, e, "app"),
    }
    res
}

/// Apply staged schema (DDL) ops as ONE transaction — all statements commit
/// together, or a failure on any op rolls the whole batch back. Returns every
/// statement that ran so the UI can show/copy what happened. The schema
/// designer's "Apply" button, never the editor — app-initiated.
pub async fn apply_schema_ops(
    conn_id: &str,
    database: Option<&str>,
    schema: Option<&str>,
    ops: &[SchemaOp],
) -> DbResult<Vec<String>> {
    let t = std::time::Instant::now();
    let target = format!("{} DDL statement(s)", ops.len());
    let ops = ops.to_vec();
    let database = database.map(str::to_string);
    let schema = schema.map(str::to_string);
    let res = with_connection(conn_id, move |a| async move {
        a.apply_schema_ops_batch(database.as_deref(), schema.as_deref(), &ops).await
    })
    .await;
    match &res {
        // The batch already returns every executed statement — log them all.
        Ok(stmts) if !stmts.is_empty() => {
            crate::activity::log_stmt_ok_origin(conn_id, "ddl", &format!("{};", stmts.join(";\n")), t, stmts.len() as i64, "app")
        }
        Ok(_) => crate::activity::log_ok_origin(conn_id, "ddl", &target, t, 0, "app"),
        Err(e) => crate::activity::log_err_origin(conn_id, "ddl", &target, t, e, "app"),
    }
    res
}
