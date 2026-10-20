//! The schema designer's apply loop against real servers (build plan slice
//! 7), `#[ignore]`d and run like `live_tests.rs`.

use crate::api::{ColumnAttrs, DefaultMode, SchemaOp, StatementStatus};
use super::live_tests::{connect, urls};

fn suffix() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..10].to_string()
}

fn drop_col(table: &str, name: &str) -> SchemaOp {
    SchemaOp::DropColumn { table: table.into(), name: name.into() }
}

/// AC-19: a two table batch whose second `ALTER` fails reports the first
/// applied, the second failed with the server's message, and the rest not
/// run; the first table really changed, the second did not.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_schema_apply_stops_at_the_first_failure() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let s = suffix();
        let (t1, t2, t3) = (format!("sa_{s}_1"), format!("sa_{s}_2"), format!("sa_{s}_3"));
        for t in [&t1, &t2, &t3] {
            a.run_sql(None, &format!("CREATE TABLE {t} (id INT PRIMARY KEY, a INT, b INT)")).await.unwrap();
        }
        let ops = vec![drop_col(&t1, "a"), drop_col(&t2, "nope"), drop_col(&t3, "a")];
        let planned = a.plan_schema_ops(None, &ops).await.unwrap();
        assert_eq!(planned.len(), 3, "{key}");

        let report = a.apply_schema_ops_report(None, &ops).await.unwrap();
        let status: Vec<_> = report.statements.iter().map(|s| s.status).collect();
        assert_eq!(status, [StatementStatus::Applied, StatementStatus::Failed, StatementStatus::NotRun], "{key}");
        assert_eq!(report.statements.iter().map(|s| s.sql.clone()).collect::<Vec<_>>(), planned, "{key}");
        let msg = report.statements[1].message.clone().unwrap();
        assert!(msg.contains("nope"), "{key}: {msg}");

        let cols = |t: String| {
            let a = &a;
            async move { a.table_schema(None, &t).await.unwrap().0.columns.len() }
        };
        assert_eq!(cols(t1.clone()).await, 2, "{key}");
        assert_eq!(cols(t3.clone()).await, 3, "{key}");

        // The older all or nothing shape says what already landed.
        let err = a.apply_schema_ops_batch(None, &[drop_col(&t3, "zzz")]).await.unwrap_err();
        assert!(err.to_string().contains("0 statements before it"), "{key}: {err}");
        for t in [t1, t2, t3] {
            a.run_sql(None, &format!("DROP TABLE {t}")).await.unwrap();
        }
    }
}

/// AC-18, AC-20: rename plus column changes land as one statement, and an
/// alter keeps the comment, `ON UPDATE` and collation it didn't touch.
#[tokio::test]
#[ignore = "requires DH_TEST_MYSQL_URL / DH_TEST_MARIADB_URL"]
async fn mysql_live_schema_apply_folds_a_table_and_keeps_untouched_attributes() {
    for (key, url) in urls() {
        let a = connect(&url, serde_json::json!({})).await;
        let s = suffix();
        let (from, to) = (format!("sf_{s}"), format!("sf_{s}_new"));
        a.run_sql(
            None,
            &format!(
                "CREATE TABLE {from} (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, \
                 name VARCHAR(20) COLLATE utf8mb4_bin DEFAULT 'anon' COMMENT 'who', \
                 changed TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)"
            ),
        )
        .await
        .unwrap();
        let ops = vec![
            SchemaOp::RenameTable { table: from.clone(), new_name: to.clone() },
            SchemaOp::AlterColumn {
                table: to.clone(),
                column: "name".into(),
                new_name: Some("label".into()),
                data_type: None,
                not_null: Some(true),
                default_mode: Some(DefaultMode::Keep),
                default_value: None,
                attrs: ColumnAttrs::default(),
            },
            SchemaOp::AddColumn {
                table: to.clone(),
                name: "kind".into(),
                data_type: "enum('a','b')".into(),
                not_null: true,
                default: Some("'a'".into()),
                attrs: ColumnAttrs { comment: Some("pick one".into()), ..Default::default() },
            },
            SchemaOp::SetTableOptions { table: to.clone(), charset: None, collation: None, comment: Some("renamed".into()) },
        ];
        let report = a.apply_schema_ops_report(None, &ops).await.unwrap();
        assert_eq!(report.statements.len(), 1, "{key}: {report:?}");
        assert_eq!(report.statements[0].status, StatementStatus::Applied, "{key}: {report:?}");

        let (schema, _) = a.table_schema(None, &to).await.unwrap();
        let opts = schema.table_options.clone().unwrap();
        assert!(opts.comment == "renamed" && opts.engine == "InnoDB" && opts.charset == "utf8mb4", "{key}: {opts:?}");
        assert!(opts.collation.starts_with("utf8mb4_"), "{key}: {opts:?}");
        let label = schema.columns.iter().find(|c| c.name == "label").unwrap();
        assert!(label.not_null && label.comment.as_deref() == Some("who") && label.default.as_deref() == Some("anon"), "{key}: {label:?}");
        let changed = schema.columns.iter().find(|c| c.name == "changed").unwrap();
        assert!(changed.extra.as_deref().unwrap_or("").to_lowercase().contains("on update"), "{key}: {changed:?}");
        let kind = schema.columns.iter().find(|c| c.name == "kind").unwrap();
        assert_eq!(kind.enum_values, ["a", "b"], "{key}");
        let coll = a
            .run_sql(None, &format!("SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '{to}' AND COLUMN_NAME = 'label'"))
            .await
            .unwrap();
        assert_eq!(coll.rows[0][0].as_deref(), Some("utf8mb4_bin"), "{key}");

        // Touching the auto increment key keeps it auto increment.
        let keep_auto = SchemaOp::AlterColumn {
            table: to.clone(),
            column: "id".into(),
            new_name: None,
            data_type: Some("bigint unsigned".into()),
            not_null: None,
            default_mode: None,
            default_value: None,
            attrs: ColumnAttrs::default(),
        };
        let report = a.apply_schema_ops_report(None, &[keep_auto]).await.unwrap();
        assert!(report.failed().is_none(), "{key}: {report:?}");
        let (schema, _) = a.table_schema(None, &to).await.unwrap();
        assert_eq!(schema.columns[0].extra.as_deref(), Some("auto_increment"), "{key}");
        a.run_sql(None, &format!("DROP TABLE {to}")).await.unwrap();
    }
}
