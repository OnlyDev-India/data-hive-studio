//! Server and table DDL from the sidebar (spec 0025 AC-20): create and drop
//! database, duplicate table. Each is its own statement; MySQL commits DDL
//! as it runs, so there is no transaction to wrap them in.

use sqlx::Executor as _;
use crate::db::{DbError, DbResult};
use super::MySqlAdapter;
use super::sql_text::{charset_name, q, tq};

/// `CREATE DATABASE` with the options MySQL takes. A charset or collation
/// that isn't a bare name is refused before it reaches the server.
pub(super) fn create_database_sql(name: &str, charset: Option<&str>, collation: Option<&str>) -> DbResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(DbError::InvalidOperation("database name must not be empty".into()));
    }
    let mut sql = format!("CREATE DATABASE {}", q(name));
    for (word, value) in [("CHARACTER SET", charset), ("COLLATE", collation)] {
        let Some(value) = value.filter(|v| !v.trim().is_empty()) else { continue };
        let value = charset_name(value)
            .ok_or_else(|| DbError::InvalidOperation(format!("{value:?} is not a charset or collation name")))?;
        sql.push_str(&format!(" {word} {value}"));
    }
    Ok(sql)
}

/// The statements that copy `source` to `target` in one database: the
/// structure (columns, keys, indexes) with `LIKE`, then the rows when asked.
/// `LIKE` leaves foreign keys behind, as MySQL documents.
pub(super) fn duplicate_sql(db: Option<&str>, source: &str, target: &str, copy_data: bool) -> Vec<String> {
    let mut out = vec![format!("CREATE TABLE {} LIKE {}", tq(db, target), tq(db, source))];
    if copy_data {
        out.push(format!("INSERT INTO {} SELECT * FROM {}", tq(db, target), tq(db, source)));
    }
    out
}

impl MySqlAdapter {
    pub(super) async fn create_database_with(
        &self,
        name: &str,
        charset: Option<&str>,
        collation: Option<&str>,
    ) -> DbResult<()> {
        self.guard.check_write("create database")?;
        let sql = create_database_sql(name, charset, collation)?;
        self.pool.execute(sql.as_str()).await.map_err(DbError::SqlEngine)?;
        Ok(())
    }

    pub(super) async fn drop_database(&self, name: &str) -> DbResult<()> {
        self.guard.check_write("drop database")?;
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::InvalidOperation("database name must not be empty".into()));
        }
        let sql = format!("DROP DATABASE {}", q(name));
        self.pool.execute(sql.as_str()).await.map_err(DbError::SqlEngine)?;
        Ok(())
    }

    /// Returns the statements that ran. If the copy of the rows fails, the
    /// new empty table stays, and the error says so.
    pub(super) async fn duplicate_table(
        &self,
        database: Option<&str>,
        source: &str,
        target: &str,
        copy_data: bool,
    ) -> DbResult<Vec<String>> {
        self.guard.check_write("duplicate table")?;
        let target = target.trim();
        if target.is_empty() {
            return Err(DbError::InvalidOperation("the new table needs a name".into()));
        }
        let db = self.target(database);
        let statements = duplicate_sql(db, source, target, copy_data);
        let mut conn = self.pool.acquire().await.map_err(DbError::SqlEngine)?;
        for (i, sql) in statements.iter().enumerate() {
            if let Err(e) = (&mut *conn).execute(sql.as_str()).await {
                if i == 0 {
                    return Err(DbError::SqlEngine(e));
                }
                return Err(DbError::InvalidOperation(format!(
                    "{target} was created, but copying the rows failed: {e}. The new table is empty."
                )));
            }
        }
        Ok(statements)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_database_writes_the_charset_and_collation_it_was_given() {
        assert_eq!(create_database_sql("shop", None, None).unwrap(), "CREATE DATABASE `shop`");
        assert_eq!(
            create_database_sql("shop", Some("utf8mb4"), Some("utf8mb4_bin")).unwrap(),
            "CREATE DATABASE `shop` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"
        );
        assert_eq!(create_database_sql("shop", Some(" "), None).unwrap(), "CREATE DATABASE `shop`");
        assert!(create_database_sql("shop", Some("utf8; DROP"), None).is_err());
        assert!(create_database_sql("  ", None, None).is_err());
    }

    #[test]
    fn duplicate_copies_the_structure_then_the_rows_when_asked() {
        assert_eq!(
            duplicate_sql(Some("shop"), "items", "items_copy", true),
            vec![
                "CREATE TABLE `shop`.`items_copy` LIKE `shop`.`items`",
                "INSERT INTO `shop`.`items_copy` SELECT * FROM `shop`.`items`",
            ]
        );
        assert_eq!(duplicate_sql(None, "a", "b", false), vec!["CREATE TABLE `b` LIKE `a`"]);
    }
}
