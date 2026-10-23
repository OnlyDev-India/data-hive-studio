use super::*;

fn col(column_type: &str, nullable: bool, default: Option<&str>, extra: &str, comment: &str, collation: Option<&str>) -> CurrentColumn {
    CurrentColumn {
        column_type: column_type.into(),
        nullable,
        default: default.map(str::to_string),
        extra: extra.into(),
        comment: comment.into(),
        collation: collation.map(str::to_string),
    }
}

fn items() -> HashMap<String, TableState> {
    let mut columns = HashMap::new();
    columns.insert("id".into(), col("int unsigned", false, None, "auto_increment", "", None));
    columns.insert("name".into(), col("varchar(40)", true, Some("anon"), "", "who", Some("utf8mb4_bin")));
    columns.insert(
        "changed".into(),
        col("timestamp", true, Some("CURRENT_TIMESTAMP"), "DEFAULT_GENERATED on update CURRENT_TIMESTAMP", "", None),
    );
    columns.insert("total".into(), col("int", true, None, "STORED GENERATED", "", None));
    let mut m = HashMap::new();
    m.insert("items".into(), TableState { columns, has_primary_key: true });
    m
}

fn alter(column: &str) -> SchemaOp {
    SchemaOp::AlterColumn {
        table: "items".into(),
        column: column.into(),
        new_name: None,
        data_type: None,
        not_null: None,
        default_mode: None,
        default_value: None,
        attrs: ColumnAttrs::default(),
    }
}

#[test]
fn every_change_to_one_table_folds_into_one_alter_with_the_rename_last() {
    let ops = vec![
        SchemaOp::RenameTable { table: "items".into(), new_name: "goods".into() },
        SchemaOp::DropColumn { table: "goods".into(), name: "old".into() },
        SchemaOp::AddColumn {
            table: "goods".into(),
            name: "qty".into(),
            data_type: "int unsigned".into(),
            not_null: true,
            default: Some("0".into()),
            attrs: ColumnAttrs { comment: Some("how many".into()), ..Default::default() },
        },
        SchemaOp::CreateIndex {
            table: "goods".into(),
            name: "ix_qty".into(),
            columns: vec!["qty".into()],
            unique: false,
            column_dirs: None,
            sparse: None,
            ttl_seconds: None,
            partial_filter: None,
        },
    ];
    assert_eq!(tables_to_read(&ops), vec!["items"]);
    let out = plan(Flavor::Mysql, Some("shop"), &ops, &items()).unwrap();
    assert_eq!(
        out,
        vec![
            "ALTER TABLE `shop`.`items` DROP COLUMN `old`, \
             ADD COLUMN `qty` int unsigned NOT NULL DEFAULT 0 COMMENT 'how many', \
             ADD INDEX `ix_qty` (`qty`), RENAME TO `shop`.`goods`"
        ]
    );
}

#[test]
fn two_tables_make_two_statements_and_triggers_run_in_place() {
    let ops = vec![
        SchemaOp::DropColumn { table: "a".into(), name: "x".into() },
        SchemaOp::DropTrigger { name: "tr".into() },
        SchemaOp::CreateTrigger { sql: "CREATE TRIGGER tr BEFORE INSERT ON a FOR EACH ROW BEGIN SET NEW.y = 1; END;".into() },
        SchemaOp::DropColumn { table: "b".into(), name: "y".into() },
        SchemaOp::DropColumn { table: "a".into(), name: "z".into() },
    ];
    let out = plan(Flavor::Mysql, Some("shop"), &ops, &HashMap::new()).unwrap();
    assert_eq!(
        out,
        vec![
            "ALTER TABLE `shop`.`a` DROP COLUMN `x`, DROP COLUMN `z`",
            "DROP TRIGGER `shop`.`tr`",
            "CREATE TRIGGER tr BEFORE INSERT ON a FOR EACH ROW BEGIN SET NEW.y = 1; END",
            "ALTER TABLE `shop`.`b` DROP COLUMN `y`",
        ]
    );
}

#[test]
fn an_alter_restates_the_whole_column_and_keeps_what_did_not_change() {
    let mut rename = alter("name");
    if let SchemaOp::AlterColumn { new_name, .. } = &mut rename {
        *new_name = Some("label".into());
    }
    let out = plan(Flavor::Mysql, None, &[rename], &items()).unwrap();
    assert_eq!(
        out,
        vec!["ALTER TABLE `items` CHANGE COLUMN `name` `label` varchar(40) COLLATE utf8mb4_bin NULL DEFAULT 'anon' COMMENT 'who'"]
    );

    let out = plan(Flavor::Mysql, None, &[alter("changed")], &items()).unwrap();
    assert_eq!(
        out,
        vec!["ALTER TABLE `items` CHANGE COLUMN `changed` `changed` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
    );

    let out = plan(Flavor::Mysql, None, &[alter("id")], &items()).unwrap();
    assert_eq!(out, vec!["ALTER TABLE `items` CHANGE COLUMN `id` `id` int unsigned NOT NULL AUTO_INCREMENT"]);
}

#[test]
fn an_alter_applies_the_new_type_default_and_attributes() {
    let op = SchemaOp::AlterColumn {
        table: "items".into(),
        column: "name".into(),
        new_name: None,
        data_type: Some("enum('a','b')".into()),
        not_null: Some(true),
        default_mode: Some(DefaultMode::Set),
        default_value: Some("'a'".into()),
        attrs: ColumnAttrs { comment: Some(String::new()), ..Default::default() },
    };
    let out = plan(Flavor::Mysql, None, &[op], &items()).unwrap();
    // A new type takes the table's collation; an empty comment removes it.
    assert_eq!(out, vec!["ALTER TABLE `items` CHANGE COLUMN `name` `name` enum('a','b') NOT NULL DEFAULT 'a'"]);

    let mut drop_update = alter("changed");
    if let SchemaOp::AlterColumn { attrs, default_mode, .. } = &mut drop_update {
        attrs.on_update = Some(String::new());
        *default_mode = Some(DefaultMode::Drop);
    }
    let out = plan(Flavor::Mysql, None, &[drop_update], &items()).unwrap();
    assert_eq!(out, vec!["ALTER TABLE `items` CHANGE COLUMN `changed` `changed` timestamp NULL"]);
}

#[test]
fn mariadb_defaults_are_already_sql() {
    let mut states = items();
    let t = states.get_mut("items").unwrap();
    t.columns.insert("name".into(), col("varchar(40)", true, Some("'anon'"), "", "", None));
    t.columns.insert("note".into(), col("text", true, Some("NULL"), "", "", None));
    let out = plan(Flavor::Mariadb, None, &[alter("name"), alter("note")], &states).unwrap();
    assert_eq!(
        out,
        vec!["ALTER TABLE `items` CHANGE COLUMN `name` `name` varchar(40) NULL DEFAULT 'anon', CHANGE COLUMN `note` `note` text NULL"]
    );
}

#[test]
fn a_generated_column_or_a_missing_one_is_refused_before_anything_runs() {
    assert!(plan(Flavor::Mysql, None, &[alter("total")], &items()).unwrap_err().to_string().contains("generated column"));
    assert!(plan(Flavor::Mysql, None, &[alter("nope")], &items()).unwrap_err().to_string().contains("not found"));
}

#[test]
fn primary_key_foreign_keys_and_table_options() {
    let ops = vec![
        SchemaOp::SetPrimaryKey { table: "items".into(), columns: vec!["id".into(), "name".into()] },
        SchemaOp::DropConstraint { table: "items".into(), name: "fk_old".into() },
        SchemaOp::AddForeignKey {
            table: "items".into(),
            columns: vec!["name".into()],
            ref_table: "people".into(),
            ref_columns: vec!["name".into()],
            on_delete: Some("cascade".into()),
            on_update: None,
        },
        SchemaOp::SetTableOptions {
            table: "items".into(),
            charset: Some("utf8mb4".into()),
            collation: Some("utf8mb4_bin".into()),
            comment: Some("it's here".into()),
        },
    ];
    let out = plan(Flavor::Mysql, None, &ops, &items()).unwrap();
    assert_eq!(
        out,
        vec![
            "ALTER TABLE `items` DROP PRIMARY KEY, ADD PRIMARY KEY (`id`, `name`), DROP FOREIGN KEY `fk_old`, \
             ADD FOREIGN KEY (`name`) REFERENCES `people` (`name`) ON DELETE CASCADE, \
             CHARACTER SET utf8mb4, COLLATE utf8mb4_bin, COMMENT = 'it''s here'"
        ]
    );
    let bad = SchemaOp::SetTableOptions { table: "items".into(), charset: Some("x;y".into()), collation: None, comment: None };
    assert!(plan(Flavor::Mysql, None, &[bad], &items()).is_err());
}

#[test]
fn a_rename_alone_is_one_statement() {
    let ops = vec![SchemaOp::RenameTable { table: "a".into(), new_name: "b".into() }];
    assert_eq!(plan(Flavor::Mysql, Some("d"), &ops, &HashMap::new()).unwrap(), vec!["ALTER TABLE `d`.`a` RENAME TO `d`.`b`"]);
}
