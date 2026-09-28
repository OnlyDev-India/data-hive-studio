//! Which statements Explain accepts, decided before the database is touched
//!. Reuses the read only guard's statement splitter, so a
//! keyword hidden in a string or a comment never counts.

use super::super::read_only::{head, split_statements, Dialect, Head};

const POSTGRES_KINDS: &[&str] =
    &["select", "insert", "update", "delete", "merge", "values", "table", "with"];
const SQLITE_KINDS: &[&str] =
    &["select", "insert", "update", "delete", "replace", "with", "values"];

fn kinds(dialect: Dialect) -> &'static [&'static str] {
    match dialect {
        Dialect::Postgres => POSTGRES_KINDS,
        Dialect::Sqlite => SQLITE_KINDS,
    }
}

fn accepted_message(dialect: Dialect) -> String {
    let list: Vec<String> = kinds(dialect).iter().map(|k| k.to_ascii_uppercase()).collect();
    let (last, rest) = list.split_last().expect("every dialect accepts something");
    format!("Explain works on {} and {} statements.", rest.join(", "), last)
}

/// The statement to send after the keyword `EXPLAIN`: trimmed, without a
/// trailing semicolon. `Err` carries the message the Plan tab shows.
pub(crate) fn check(dialect: Dialect, sql: &str) -> Result<String, String> {
    let statements = split_statements(dialect, sql)
        .map_err(|why| format!("This statement could not be read: {why}. {}", accepted_message(dialect)))?;
    let statement = match statements.as_slice() {
        [] => return Err(format!("There is nothing to explain. {}", accepted_message(dialect))),
        [one] => one,
        _ => {
            return Err(format!(
                "Explain takes one statement at a time. {}",
                accepted_message(dialect)
            ))
        }
    };
    match head(&statement.masked) {
        Head::Word(word, _) if kinds(dialect).contains(&word.as_str()) => {
            Ok(sql.trim().trim_end_matches(';').trim_end().to_string())
        }
        _ => Err(accepted_message(dialect)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_reads_and_writes_and_strips_the_semicolon() {
        assert_eq!(check(Dialect::Postgres, " SELECT 1; ").unwrap(), "SELECT 1");
        assert!(check(Dialect::Postgres, "update t set a = 1").is_ok());
        assert!(check(Dialect::Postgres, "(select 1) union (select 2)").is_ok());
        assert!(check(Dialect::Sqlite, "WITH x AS (SELECT 1) SELECT * FROM x").is_ok());
    }

    #[test]
    fn refuses_everything_else_without_a_database() {
        for sql in ["CREATE TABLE t (a int)", "SET x = 1", "BEGIN", "COPY t TO STDOUT"] {
            assert!(check(Dialect::Postgres, sql).is_err(), "{sql}");
        }
        for sql in ["PRAGMA table_info(t)", "CREATE TABLE t (a)", "EXPLAIN SELECT 1"] {
            assert!(check(Dialect::Sqlite, sql).is_err(), "{sql}");
        }
        // MERGE and TABLE are Postgres only.
        assert!(check(Dialect::Sqlite, "MERGE INTO t USING s ON true").is_err());
    }

    #[test]
    fn names_the_accepted_kinds_and_refuses_scripts() {
        let msg = check(Dialect::Postgres, "DROP TABLE t").unwrap_err();
        assert!(msg.contains("SELECT") && msg.contains("and WITH"), "{msg}");
        assert!(check(Dialect::Postgres, "select 1; select 2").is_err());
        assert!(check(Dialect::Postgres, "   ").is_err());
    }

    #[test]
    fn a_keyword_inside_a_string_or_comment_does_not_count() {
        assert!(check(Dialect::Postgres, "/* select */ drop table t").is_err());
    }
}
