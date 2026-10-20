//! The sidebar's object groups under a database: tables, views, routines,
//! triggers and events, all from `information_schema` (spec 0025 value
//! sourcing).

use crate::db::{DbError, DbResult, SchemaObject, SchemaObjectKind};
use super::MySqlAdapter;
use super::catalog::col;
use super::rows::fetch_text;
use super::sql_text::tq;

/// The catalog read for one group. Every query takes the database as its one
/// parameter and returns the name, then the extra text the row shows.
fn group_sql(kind: SchemaObjectKind) -> Option<&'static str> {
    Some(match kind {
        SchemaObjectKind::Table => {
            "SELECT TABLE_NAME, NULL FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN ('BASE TABLE', 'SYSTEM VERSIONED') ORDER BY TABLE_NAME"
        }
        SchemaObjectKind::View => {
            "SELECT TABLE_NAME, NULL FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'VIEW' ORDER BY TABLE_NAME"
        }
        SchemaObjectKind::Procedure => {
            "SELECT ROUTINE_NAME, NULL FROM information_schema.ROUTINES \
             WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE' ORDER BY ROUTINE_NAME"
        }
        // The return type rides along, as a Postgres function shows its
        // signature.
        SchemaObjectKind::Function => {
            "SELECT ROUTINE_NAME, DTD_IDENTIFIER FROM information_schema.ROUTINES \
             WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION' ORDER BY ROUTINE_NAME"
        }
        SchemaObjectKind::Trigger => {
            "SELECT TRIGGER_NAME, CONCAT(ACTION_TIMING, ' ', EVENT_MANIPULATION, ' ON ', EVENT_OBJECT_TABLE) \
             FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME"
        }
        SchemaObjectKind::Event => {
            "SELECT EVENT_NAME, STATUS FROM information_schema.EVENTS \
             WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME"
        }
        SchemaObjectKind::MaterializedView | SchemaObjectKind::Sequence | SchemaObjectKind::Type => return None,
    })
}

/// The `SHOW CREATE` statement for one kind, and the column of its answer
/// that holds the definition. The same columns on MySQL and MariaDB.
fn show_create(kind: SchemaObjectKind) -> Option<(&'static str, usize)> {
    Some(match kind {
        SchemaObjectKind::Table => ("TABLE", 1),
        SchemaObjectKind::View => ("VIEW", 1),
        SchemaObjectKind::Procedure => ("PROCEDURE", 2),
        SchemaObjectKind::Function => ("FUNCTION", 2),
        SchemaObjectKind::Trigger => ("TRIGGER", 2),
        SchemaObjectKind::Event => ("EVENT", 3),
        SchemaObjectKind::MaterializedView | SchemaObjectKind::Sequence | SchemaObjectKind::Type => return None,
    })
}

/// A body with its own `;` inside (a `BEGIN ... END` block) is wrapped in
/// `DELIMITER ;;` lines, so running the tab as a script sends it whole
/// (AC-10). A plain one statement definition just gets its `;`.
fn runnable(definition: &str) -> String {
    let body = definition.trim_end().trim_end_matches(';');
    if body.contains(';') {
        format!("DELIMITER ;;\n{body};;\nDELIMITER ;\n")
    } else {
        format!("{body};\n")
    }
}

impl MySqlAdapter {
    /// What `SHOW CREATE` says for one object, ready to run as a script.
    pub(super) async fn object_definition(
        &self,
        database: Option<&str>,
        kind: SchemaObjectKind,
        name: &str,
    ) -> DbResult<String> {
        let Some((word, at)) = show_create(kind) else {
            return Err(DbError::InvalidOperation(format!("MySQL has no {kind:?} objects")));
        };
        let db = self.require_target(database)?;
        let sql = format!("SHOW CREATE {word} {}", tq(Some(db), name));
        let rows = fetch_text(&self.pool, &sql, &[]).await?;
        // The server leaves a routine's text NULL for a user who neither
        // owns it nor holds a privilege that shows it.
        match rows.first().and_then(|r| r.get(at).cloned().flatten()) {
            Some(text) => Ok(runnable(&text)),
            None => Err(DbError::InvalidOperation(format!(
                "The server didn't return the definition of {name}. You may need SHOW_ROUTINE or SELECT on mysql.proc to see it."
            ))),
        }
    }

    /// One group of the database's tree. Kinds MySQL doesn't have
    /// (materialized views, sequences, types) are empty, not an error.
    pub(super) async fn list_schema_objects(
        &self,
        database: Option<&str>,
        kind: SchemaObjectKind,
    ) -> DbResult<Vec<SchemaObject>> {
        let Some(sql) = group_sql(kind) else {
            return Ok(Vec::new());
        };
        let db = self.require_target(database)?;
        let rows = fetch_text(&self.pool, sql, &[db]).await?;
        Ok(rows
            .iter()
            .map(|r| SchemaObject { name: col(r, 0), extra: r.get(1).cloned().flatten().filter(|e| !e.is_empty()) })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_mysql_kind_has_a_show_create_and_bodies_with_semicolons_get_a_delimiter() {
        assert_eq!(show_create(SchemaObjectKind::Event), Some(("EVENT", 3)));
        assert!(show_create(SchemaObjectKind::Sequence).is_none());
        assert_eq!(runnable("CREATE VIEW `v` AS select 1"), "CREATE VIEW `v` AS select 1;\n");
        assert_eq!(
            runnable("CREATE PROCEDURE `p`() BEGIN SELECT 1; END"),
            "DELIMITER ;;\nCREATE PROCEDURE `p`() BEGIN SELECT 1; END;;\nDELIMITER ;\n"
        );
    }

    #[test]
    fn mysql_groups_have_a_catalog_read_and_the_postgres_only_ones_are_empty() {
        for kind in [
            SchemaObjectKind::Table,
            SchemaObjectKind::View,
            SchemaObjectKind::Procedure,
            SchemaObjectKind::Function,
            SchemaObjectKind::Trigger,
            SchemaObjectKind::Event,
        ] {
            let sql = group_sql(kind).unwrap();
            assert_eq!(sql.matches('?').count(), 1, "{kind:?}");
        }
        for kind in [SchemaObjectKind::MaterializedView, SchemaObjectKind::Sequence, SchemaObjectKind::Type] {
            assert!(group_sql(kind).is_none(), "{kind:?}");
        }
    }
}
