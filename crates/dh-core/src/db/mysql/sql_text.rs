/// Quote an identifier the MySQL way (backticks).
pub(super) fn q(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

/// `database`.`table` when a database is known, else just `table` (the
/// session's default database resolves it).
pub(super) fn tq(database: Option<&str>, table: &str) -> String {
    match database {
        Some(db) => format!("{}.{}", q(db), q(table)),
        None => q(table),
    }
}

/// Whether `trimmed` returns rows, by its first keyword (after any opening
/// parentheses). MySQL adds `DESCRIBE`/`DESC`, `HELP` and `CHECK`-style
/// admin statements that answer with a result set.
pub(super) fn is_select_statement(trimmed: &str) -> bool {
    let first = trimmed
        .trim_start_matches(|c: char| c == '(' || c.is_whitespace())
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        first.as_str(),
        "select" | "with" | "values" | "table" | "show" | "explain" | "describe" | "desc" | "help" | "analyze"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_use_backticks_and_double_inner_ones() {
        assert_eq!(q("order"), "`order`");
        assert_eq!(q("a`b"), "`a``b`");
        assert_eq!(tq(Some("shop"), "items"), "`shop`.`items`");
        assert_eq!(tq(None, "items"), "`items`");
    }

    #[test]
    fn row_returning_statements_are_recognised() {
        for sql in ["SELECT 1", "with x as (select 1) select * from x", "SHOW DATABASES", "DESC t", "describe t", "(SELECT 1) UNION (SELECT 2)", "EXPLAIN SELECT 1", "TABLE t", "VALUES ROW(1)"] {
            assert!(is_select_statement(sql), "{sql}");
        }
        for sql in ["UPDATE t SET a = 1", "INSERT INTO t VALUES (1)", "CREATE TABLE t (a int)", "USE shop", "SET @a = 1", ""] {
            assert!(!is_select_statement(sql), "{sql}");
        }
    }
}
