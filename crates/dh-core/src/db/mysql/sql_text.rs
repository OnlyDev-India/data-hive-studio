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

/// A string literal: quotes doubled and backslashes escaped, so the text
/// can't end the literal early under the server's default `sql_mode`.
pub(super) fn sql_string(text: &str) -> String {
    format!("'{}'", text.replace('\\', "\\\\").replace('\'', "''"))
}

/// A charset or collation name, which MySQL takes bare: letters, digits and
/// underscores only, so it can be written into DDL as is.
pub(super) fn charset_name(name: &str) -> Option<&str> {
    let name = name.trim();
    (!name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')).then_some(name)
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
    fn string_literals_escape_quotes_and_backslashes() {
        assert_eq!(sql_string("app"), "'app'");
        assert_eq!(sql_string("o'neil"), "'o''neil'");
        assert_eq!(sql_string("a\\b"), "'a\\\\b'");
    }

    #[test]
    fn charset_names_must_be_bare_words() {
        assert_eq!(charset_name(" utf8mb4 "), Some("utf8mb4"));
        assert_eq!(charset_name("utf8mb4_0900_ai_ci"), Some("utf8mb4_0900_ai_ci"));
        assert_eq!(charset_name("latin1; DROP"), None);
        assert_eq!(charset_name(""), None);
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
