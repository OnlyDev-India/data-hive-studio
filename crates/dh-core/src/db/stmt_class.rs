//! What a hand typed statement needs (spec 0013): the team server's gateway
//! turns this into a connection role. `Read` needs a viewer, `RowWrite` an
//! editor, and `Other` an admin. The classifier fails closed: anything it
//! cannot read or does not recognise is `Other`, so an editor is sometimes
//! refused a harmless statement but never let through a harmful one.
//!
//! SQL reuses the splitter and the read allowlist from the read only guard
//! (spec 0007), so a script that the guard would allow is exactly a `Read`
//! script. A script takes the highest class of any of its statements.

use super::read_only::{head, judge, split_statements, tokens, Dialect, Head, LOCK_BREAKERS};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum StmtClass {
    /// Only reads.
    Read,
    /// Inserts, updates or deletes rows.
    RowWrite,
    /// Schema changes, anything with side effects beyond rows, and anything
    /// not recognised.
    Other,
}

/// Transaction control keeps the class of the statements inside it, so a
/// wrapper around row writes stays an editor's script.
const TRANSACTION_WORDS: &[&str] =
    &["begin", "start", "commit", "end", "rollback", "savepoint", "release"];

/// Words that turn an otherwise plain statement into one with effects beyond
/// the rows it names: a data changing CTE, `SELECT INTO`, `COPY`, `MERGE`.
const EFFECT_WORDS: &[&str] = &["into", "copy", "merge"];
const DML_WORDS: &[&str] = &["insert", "update", "delete"];

/// Class of a hand typed SQL script.
pub fn sql_class(dialect: Dialect, sql: &str) -> StmtClass {
    let statements = match split_statements(dialect, sql) {
        Ok(s) => s,
        Err(_) => return StmtClass::Other,
    };
    statements
        .iter()
        .map(|s| statement_class(dialect, &s.masked))
        .max()
        .unwrap_or(StmtClass::Read)
}

fn statement_class(dialect: Dialect, masked: &str) -> StmtClass {
    let Head::Word(word, _) = head(masked) else {
        return match head(masked) {
            Head::Empty => StmtClass::Read,
            _ => StmtClass::Other,
        };
    };
    let toks: Vec<String> = tokens(masked).collect();
    let has = |set: &[&str]| toks.iter().any(|t| set.contains(&t.as_str()));
    // A lock breaker never rides along, whatever the statement is.
    if has(LOCK_BREAKERS) {
        return StmtClass::Other;
    }
    if judge(dialect, masked).is_ok() {
        // On the read list. `WITH` may hide a data changing statement, and
        // `SELECT ... INTO` creates a table.
        let writes_inside = (word == "with" && has(DML_WORDS)) || has(EFFECT_WORDS);
        return if writes_inside { StmtClass::Other } else { StmtClass::Read };
    }
    match word.as_str() {
        "insert" | "update" | "delete" => StmtClass::RowWrite,
        w if TRANSACTION_WORDS.contains(&w) => StmtClass::RowWrite,
        _ => StmtClass::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use StmtClass::*;

    const PG: Dialect = Dialect::Postgres;

    fn pg(sql: &str) -> StmtClass {
        sql_class(PG, sql)
    }

    #[test]
    fn reads_are_reads() {
        for sql in [
            "SELECT 1",
            "select count(*) from t where a = 'x; DROP TABLE t'",
            "WITH x AS (SELECT 1) SELECT * FROM x",
            "VALUES (1)",
            "SHOW search_path",
            "EXPLAIN SELECT 1",
            "EXPLAIN ANALYZE SELECT 1",
            "-- note\nSELECT 1; SELECT 2;",
            "",
        ] {
            assert_eq!(pg(sql), Read, "{sql}");
        }
    }

    #[test]
    fn row_writes_are_editor_work() {
        for sql in [
            "INSERT INTO t (a) VALUES (1)",
            "UPDATE t SET a = 1 WHERE id = 2",
            "DELETE FROM t WHERE id = 2",
            "BEGIN; UPDATE t SET a = 1; COMMIT;",
            "insert into t select * from u",
        ] {
            assert_eq!(pg(sql), RowWrite, "{sql}");
        }
    }

    #[test]
    fn everything_else_needs_an_admin() {
        for sql in [
            "ALTER TABLE t ADD COLUMN b int",
            "DROP TABLE t",
            "TRUNCATE t",
            "CREATE INDEX i ON t (a)",
            "GRANT SELECT ON t TO x",
            "VACUUM t",
            "CALL do_things()",
            "DO $$ BEGIN DELETE FROM t; END $$",
            "COPY t FROM '/etc/passwd'",
            "MERGE INTO t USING u ON t.id = u.id WHEN MATCHED THEN DELETE",
            "SELECT * INTO backup FROM t",
            "WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
            "SELECT set_config('default_transaction_read_only', 'off', false)",
            "UPDATE t SET a = set_config('x', 'y', false)",
            "EXPLAIN ANALYZE DELETE FROM t",
            "SET search_path TO other",
            "'unclosed",
            "/* unclosed",
            "42",
        ] {
            assert_eq!(pg(sql), Other, "{sql}");
        }
    }

    #[test]
    fn a_script_takes_the_highest_statement() {
        assert_eq!(pg("SELECT 1; UPDATE t SET a = 1"), RowWrite);
        assert_eq!(pg("UPDATE t SET a = 1; DROP TABLE t"), Other);
        assert_eq!(pg("SELECT 1; DROP TABLE t; SELECT 2"), Other);
    }

    #[test]
    fn comments_and_strings_cannot_hide_or_fake_a_statement() {
        assert_eq!(pg("SELECT 'DROP TABLE t'"), Read);
        assert_eq!(pg("/* DROP TABLE t */ SELECT 1"), Read);
        assert_eq!(pg("SELECT 1; /* x */ DROP TABLE t"), Other);
        assert_eq!(pg("SELECT $$; DROP TABLE t$$"), Read);
        assert_eq!(pg("SELECT \"update\" FROM t"), Read);
    }

    #[test]
    fn sqlite_pragmas_follow_the_read_list() {
        assert_eq!(sql_class(Dialect::Sqlite, "PRAGMA table_info(t)"), Read);
        assert_eq!(sql_class(Dialect::Sqlite, "PRAGMA journal_mode = off"), Other);
    }
}
