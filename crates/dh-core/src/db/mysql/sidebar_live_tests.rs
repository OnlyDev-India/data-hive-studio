//! The full sidebar against real servers (build plan slice 6), `#[ignore]`d
//! like `live_tests.rs` and run the same way:
//!
//! ```text
//! DH_TEST_MYSQL_URL=mysql://root:pw@127.0.0.1:3316/dh_test \
//! DH_TEST_MARIADB_URL=mysql://root:pw@127.0.0.1:3317/dh_test \
//!   cargo test -p dh-core -- --ignored mysql_live
//! ```

use crate::db::{DbError, SchemaObjectKind};
use super::live_tests::{connect, urls};
use super::MySqlAdapter;

fn suffix() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..10].to_string()
}

async fn names(a: &MySqlAdapter, db: &str, kind: SchemaObjectKind) -> Vec<String> {
    a.list_schema_objects(Some(db), kind).await.unwrap().into_iter().map(|o| o.name).collect()
}

/// AC-5, AC-7: every group lists its objects, and each object's definition
/// comes back from `SHOW CREATE`, ready to run.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_sidebar_groups_list_their_objects_and_definitions() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let s = suffix();
        let db = format!("dh_side_{s}");
        a.create_database_with(&db, Some("utf8mb4"), Some("utf8mb4_bin")).await.unwrap();
        let script = [
            "CREATE TABLE t (id INT PRIMARY KEY, n INT)".to_string(),
            "CREATE VIEW v AS SELECT id FROM t".to_string(),
            "CREATE PROCEDURE p() BEGIN SELECT 1; SELECT 2; END".to_string(),
            "CREATE FUNCTION f(x INT) RETURNS INT DETERMINISTIC RETURN x + 1".to_string(),
            "CREATE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW SET NEW.n = 1".to_string(),
            "CREATE EVENT ev ON SCHEDULE EVERY 1 DAY DISABLE DO SELECT 1".to_string(),
        ];
        for sql in &script {
            a.run_sql(Some(&db), sql).await.unwrap_or_else(|e| panic!("{key} {sql}: {e}"));
        }

        assert_eq!(names(&a, &db, SchemaObjectKind::Table).await, ["t"], "{key}");
        assert_eq!(names(&a, &db, SchemaObjectKind::View).await, ["v"], "{key}");
        assert_eq!(names(&a, &db, SchemaObjectKind::Procedure).await, ["p"], "{key}");
        assert_eq!(names(&a, &db, SchemaObjectKind::Function).await, ["f"], "{key}");
        assert_eq!(names(&a, &db, SchemaObjectKind::Trigger).await, ["tr"], "{key}");
        assert_eq!(names(&a, &db, SchemaObjectKind::Event).await, ["ev"], "{key}");
        assert!(names(&a, &db, SchemaObjectKind::Sequence).await.is_empty(), "{key}");
        let trig = a.list_schema_objects(Some(&db), SchemaObjectKind::Trigger).await.unwrap();
        assert_eq!(trig[0].extra.as_deref(), Some("BEFORE INSERT ON t"), "{key}");

        for (kind, name, needle) in [
            (SchemaObjectKind::View, "v", "VIEW"),
            (SchemaObjectKind::Procedure, "p", "PROCEDURE"),
            (SchemaObjectKind::Function, "f", "FUNCTION"),
            (SchemaObjectKind::Trigger, "tr", "TRIGGER"),
            (SchemaObjectKind::Event, "ev", "EVENT"),
        ] {
            let def = a.object_definition(Some(&db), kind, name).await.unwrap();
            assert!(def.contains(needle), "{key} {kind:?}: {def}");
        }
        let proc_def = a.object_definition(Some(&db), SchemaObjectKind::Procedure, "p").await.unwrap();
        assert!(proc_def.starts_with("DELIMITER ;;\n") && proc_def.ends_with("END;;\nDELIMITER ;\n"), "{key}: {proc_def}");

        // The new database got the collation it was created with.
        let coll = a
            .run_sql(None, &format!("SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '{db}'"))
            .await
            .unwrap();
        assert_eq!(coll.rows[0][0].as_deref(), Some("utf8mb4_bin"), "{key}");

        a.drop_database(&db).await.unwrap();
        assert!(!a.list_databases().await.unwrap().contains(&db), "{key}");
    }
}

/// AC-20: duplicate copies the structure, and the rows only when asked.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_duplicate_table_copies_rows_only_when_asked() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let s = suffix();
        let (src, full, empty) = (format!("dup_{s}"), format!("dup_{s}_full"), format!("dup_{s}_empty"));
        a.run_sql(None, &format!("CREATE TABLE {src} (id INT AUTO_INCREMENT PRIMARY KEY, n VARCHAR(5))")).await.unwrap();
        a.run_sql(None, &format!("INSERT INTO {src} (n) VALUES ('a'), ('b')")).await.unwrap();

        let ran = a.duplicate_table(None, &src, &full, true).await.unwrap();
        assert_eq!(ran.len(), 2, "{key}");
        a.duplicate_table(None, &src, &empty, false).await.unwrap();
        let count = |t: String| {
            let a = &a;
            async move { a.run_sql(None, &format!("SELECT COUNT(*) FROM {t}")).await.unwrap().rows[0][0].clone() }
        };
        assert_eq!(count(full.clone()).await.as_deref(), Some("2"), "{key}");
        assert_eq!(count(empty.clone()).await.as_deref(), Some("0"), "{key}");
        let (schema, _) = a.table_schema(None, &empty).await.unwrap();
        assert!(schema.columns[0].primary_key && schema.columns[0].extra.as_deref() == Some("auto_increment"), "{key}");

        let dup_again = a.duplicate_table(None, &src, &full, true).await.unwrap_err();
        assert!(matches!(dup_again, DbError::SqlEngine(_)), "{key}: {dup_again}");
        for t in [src, full, empty] {
            a.run_sql(None, &format!("DROP TABLE {t}")).await.unwrap();
        }
    }
}

/// AC-5: the admin sees every account with its grants; a user who can't
/// read `mysql.user` gets an empty list, not an error.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_users_list_with_grants_and_hide_without_privilege() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let user = format!("dh_u_{}", suffix());
        a.run_sql(None, &format!("CREATE USER '{user}'@'%' IDENTIFIED BY 'pw'")).await.unwrap();
        a.run_sql(None, &format!("GRANT SELECT ON dh_test.* TO '{user}'@'%'")).await.unwrap();

        let roles = a.list_roles().await.unwrap();
        assert!(roles.iter().any(|r| r.name == format!("{user}@%")), "{key}");
        let details = a.list_role_details().await.unwrap();
        let mine = details.iter().find(|r| r.name == format!("{user}@%")).unwrap();
        assert!(mine.grants.iter().any(|g| g.contains("SELECT ON")), "{key}: {:?}", mine.grants);
        assert!(details.iter().any(|r| r.superuser), "{key}");

        let base = url.split_once("://").unwrap().1.split_once('@').unwrap().1;
        let limited = connect(&format!("mysql://{user}:pw@{base}"), serde_json::json!({})).await;
        assert!(limited.list_roles().await.unwrap().is_empty(), "{key}");
        assert!(limited.list_role_details().await.unwrap().is_empty(), "{key}");
        limited.pool.close().await;
        a.run_sql(None, &format!("DROP USER '{user}'@'%'")).await.unwrap();
    }
}

/// AC-5: a locked account shows as Locked and can't log in; one unlocked
/// again shows as Login. MariaDB keeps the flag in `mysql.global_priv`'s
/// JSON, where `true` and `false` are JSON values, not text.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_a_locked_account_shows_as_locked() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let locked = format!("dh_l_{}", suffix());
        let unlocked = format!("dh_ul_{}", suffix());
        a.run_sql(None, &format!("CREATE USER '{locked}'@'%' IDENTIFIED BY 'pw' ACCOUNT LOCK")).await.unwrap();
        a.run_sql(None, &format!("CREATE USER '{unlocked}'@'%' IDENTIFIED BY 'pw' ACCOUNT LOCK")).await.unwrap();
        a.run_sql(None, &format!("ALTER USER '{unlocked}'@'%' ACCOUNT UNLOCK")).await.unwrap();

        let roles = a.list_roles().await.unwrap();
        let extra = |u: &str| roles.iter().find(|r| r.name == format!("{u}@%")).unwrap().extra.clone();
        assert_eq!(extra(&locked).as_deref(), Some("locked"), "{key}");
        assert_eq!(extra(&unlocked), None, "{key}");

        let details = a.list_role_details().await.unwrap();
        let detail = |u: &str| details.iter().find(|r| r.name == format!("{u}@%")).unwrap();
        assert!(!detail(&locked).can_login, "{key}");
        assert!(detail(&locked).attributes.iter().any(|x| x == "Locked"), "{key}");
        assert!(detail(&unlocked).can_login, "{key}");
        assert!(detail(&unlocked).attributes.iter().any(|x| x == "Login"), "{key}");

        for u in [locked, unlocked] {
            a.run_sql(None, &format!("DROP USER '{u}'@'%'")).await.unwrap();
        }
    }
}
