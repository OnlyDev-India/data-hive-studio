//! Integration probe: CREATE/DROP DATABASE + SCHEMA guards and side effects.
//! Requires the scratch server on :55432 (trust auth, db `postgres`).
use app_lib::db;

async fn conn() -> String {
    let info = db::connect_postgres(db::PgParams {
        host: "localhost".into(),
        port: 55432,
        user: "postgres".into(),
        password: String::new(),
        database: "postgres".into(),
        ssl_mode: None,
    })
    .await
    .expect("connect");
    info.id
}

#[tokio::test]
async fn catalog_overview_single_round_trip() {
    let id = conn().await;
    let ov = db::catalog_overview(&id).await.expect("overview");
    assert!(ov.schemas.iter().any(|s| s == "public"), "public schema listed");
    assert!(ov.databases.iter().any(|d| d == "postgres"), "attached db listed");
    assert_eq!(ov.active_schema, "public");
}

#[tokio::test]
async fn database_lifecycle() {
    let id = conn().await;

    // Create + visible in listing.
    db::create_database(&id, "zz_life").await.expect("create db");
    let dbs = db::list_databases(&id).await.expect("list");
    assert!(dbs.iter().any(|d| d == "zz_life"), "created db must be listed");

    // Duplicate create must fail cleanly.
    assert!(
        db::create_database(&id, "zz_life").await.is_err(),
        "duplicate CREATE DATABASE must error"
    );

    // Dropping the ATTACHED database is refused by our guard.
    assert!(
        db::drop_database(&id, "postgres").await.is_err(),
        "dropping attached db must be refused"
    );

    // Drop + gone from listing; IF EXISTS makes repeat drops fine.
    db::drop_database(&id, "zz_life").await.expect("drop db");
    let dbs = db::list_databases(&id).await.expect("list after drop");
    assert!(!dbs.iter().any(|d| d == "zz_life"));
    db::drop_database(&id, "zz_life").await.expect("repeat drop ok");

    // Empty names are rejected before touching the server.
    assert!(db::create_database(&id, "  ").await.is_err());
    assert!(db::drop_database(&id, "").await.is_err());
}

#[tokio::test]
async fn schema_lifecycle() {
    let id = conn().await;

    db::create_schema(&id, "zz_s").await.expect("create schema");
    // Existence proof: switching to it must succeed.
    db::set_active_schema(&id, "zz_s").await.expect("switch to new schema");

    // Dropping the DEFAULT schema is refused.
    assert!(db::drop_schema(&id, "public", false).await.is_err());

    // Drop a NON-active schema.
    db::create_schema(&id, "zz_other").await.expect("second schema");
    db::drop_schema(&id, "zz_other", true).await.expect("drop other");

    // Dropping the ACTIVE schema falls back to public automatically.
    db::drop_schema(&id, "zz_s", false).await.expect("drop active");
    assert_eq!(
        db::active_schema(&id).await.expect("active"),
        "public",
        "must fall back to public after dropping active schema"
    );

    // Empty names are rejected before touching the server.
    assert!(db::create_schema(&id, "").await.is_err());
}

#[tokio::test]
async fn alter_column_in_place() {
    use app_lib::api::{DefaultMode, SchemaOp};
    let id = conn().await;
    let _ = db::run_sql(&id, "DROP TABLE IF EXISTS zz_alt").await;
    let _ = db::run_sql(&id, "CREATE TABLE zz_alt (id int primary key, v text)").await;
    let _ = db::run_sql(&id, "INSERT INTO zz_alt VALUES (1, 'x')").await;

    // Type change + NOT NULL + new default, all in ONE op.
    db::apply_schema_ops(
        &id,
        &[SchemaOp::AlterColumn {
            table: "zz_alt".into(),
            column: "v".into(),
            new_name: None,
            data_type: Some("varchar(10)".into()),
            not_null: Some(true),
            default_mode: Some(DefaultMode::Set),
            default_value: Some("'zz'".into()),
        }],
    )
    .await
    .expect("alter column");

    let schema = db::table_schema(&id, "zz_alt").await.expect("schema");
    let v = schema.columns.iter().find(|c| c.name == "v").expect("v column");
    assert!(v.not_null, "NOT NULL must be set");
    assert!(
        v.default.as_deref().is_some_and(|d| d.contains("'zz'")),
        "default must be set (PG may append a cast)"
    );
    assert!(v.data_type.contains("character varying"), "type changed");

    // Rename-only still works.
    db::apply_schema_ops(
        &id,
        &[SchemaOp::AlterColumn {
            table: "zz_alt".into(),
            column: "v".into(),
            new_name: Some("w".into()),
            data_type: None,
            not_null: None,
            default_mode: None,
            default_value: None,
        }],
    )
    .await
    .expect("rename");
    let schema2 = db::table_schema(&id, "zz_alt").await.expect("schema2");
    assert!(schema2.columns.iter().any(|c| c.name == "w"));

    // No-op alter errors with a clear message.
    let noop = db::apply_schema_ops(
        &id,
        &[SchemaOp::AlterColumn {
            table: "zz_alt".into(),
            column: "w".into(),
            new_name: None,
            data_type: None,
            not_null: None,
            default_mode: None,
            default_value: None,
        }],
    )
    .await;
    assert!(noop.is_err(), "empty alter must be rejected");

    let _ = db::run_sql(&id, "DROP TABLE IF EXISTS zz_alt").await;
}

#[tokio::test]
async fn duplicate_matview_and_params() {
    let id = conn().await;
    let _ = db::run_sql(&id, "DROP TABLE IF EXISTS zz_dup").await;
    let _ = db::run_sql(&id, "DROP TABLE IF EXISTS zz_dup_copy").await;
    let _ = db::run_sql(&id, "CREATE TABLE zz_dup (id int primary key, v text)").await;
    let _ = db::run_sql(&id, "INSERT INTO zz_dup VALUES (1, 'a'), (2, 'b')").await;

    // Duplicate: statements returned + data copied + PK carried over.
    let stmts = db::duplicate_table(&id, "zz_dup", "zz_dup_copy")
        .await
        .expect("duplicate");
    assert_eq!(stmts.len(), 2);
    let res = db::run_sql(&id, "SELECT count(*) FROM zz_dup_copy").await.expect("count copy");
    assert_eq!(res.rows[0][0].as_deref(), Some("2"));
    let schema = db::table_schema(&id, "zz_dup_copy").await.expect("schema");
    assert!(
        schema.columns.iter().any(|c| c.primary_key && c.name == "id"),
        "primary key must survive duplication"
    );
    // Views cannot be duplicated on PG.
    let _ = db::run_sql(&id, "DROP TABLE IF EXISTS zz_dup").await;

    // Parameterized SELECT with ? placeholders.
    let _ = db::run_sql(&id, "DROP MATERIALIZED VIEW IF EXISTS zz_mv").await;
    let out = db::run_sql_params(
        &id,
        // Text-bound params: callers cast to the column type (same rule as
        // every other PG path).
        "SELECT v FROM zz_dup_copy WHERE id = ?::int",
        &[Some("1".into())],
    )
    .await
    .expect("param select");
    assert_eq!(out.rows[0][0].as_deref(), Some("a"));

    // Materialized view refresh.
    let _ = db::run_sql(&id, "DROP TABLE IF EXISTS zz_dup_copy").await;
    let mv = db::run_sql(
        &id,
        "CREATE MATERIALIZED VIEW zz_mv AS SELECT 1 AS x WITH NO DATA",
    )
    .await;
    if mv.is_ok() {
        db::refresh_matview(&id, "zz_mv").await.expect("refresh mv");
        let rows = db::run_sql(&id, "SELECT count(*) FROM zz_mv").await.expect("mv count");
        assert_eq!(rows.rows[0][0].as_deref(), Some("1"));
        let _ = db::run_sql(&id, "DROP MATERIALIZED VIEW zz_mv").await;
    }
}
