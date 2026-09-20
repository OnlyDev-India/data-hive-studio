//! SQL-subset → MongoDB `find()` translator (Phase 4 of the MONGODB_SUPPORT
//! plan). Understands a single-table `SELECT` with a `WHERE` clause built
//! from comparisons combined with `AND`/`OR` (with parenthesized grouping),
//! `ORDER BY`, `LIMIT`, and `OFFSET`. No JOINs, no schema required — this is
//! deliberately a subset, not a general SQL engine. Pure and unit-testable;
//! all MongoDB I/O happens in `mongodb.rs`, which executes the plan this
//! module produces.

mod lexer;
mod parser;
#[cfg(test)]
mod tests;

use std::fmt;
use self::lexer::Lexer;
use self::parser::Parser;

/// The result of translating a `SELECT` statement: everything needed to run
/// a `find()` against one collection.
#[derive(Debug, Clone, PartialEq)]
pub struct SelectPlan {
    pub table: String,
    /// `None` = no explicit column list (`SELECT *`) — the executor falls
    /// back to the union-of-fields grid projection.
    pub columns: Option<Vec<String>>,
    pub filter: Option<bson::Document>,
    pub sort: Option<bson::Document>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TranslateError(pub String);

impl fmt::Display for TranslateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for TranslateError {}

fn err(msg: impl Into<String>) -> TranslateError {
    TranslateError(msg.into())
}

/// True when `sql` (after trimming whitespace/comments) is a `SELECT`
/// statement this translator can attempt — the caller uses this to decide
/// whether to route through the translator at all vs. reject other DML/DDL.
pub fn is_select(sql: &str) -> bool {
    first_keyword(sql).eq_ignore_ascii_case("select")
}

fn first_keyword(sql: &str) -> &str {
    strip_leading_comments(sql)
        .trim()
        .split(|c: char| c.is_whitespace() || c == '(')
        .find(|s| !s.is_empty())
        .unwrap_or("")
}

fn strip_leading_comments(sql: &str) -> &str {
    let mut s = sql;
    loop {
        let t = s.trim_start();
        if let Some(rest) = t.strip_prefix("--") {
            s = rest.splitn(2, '\n').nth(1).unwrap_or("");
            continue;
        }
        if let Some(rest) = t.strip_prefix("/*") {
            if let Some(end) = rest.find("*/") {
                s = &rest[end + 2..];
                continue;
            }
        }
        return t;
    }
}

/// SQL `LIKE` pattern (`%` = any run, `_` = one char) → an anchored regex,
/// with regex metacharacters in the literal portions escaped.
fn like_to_regex(pat: &str) -> String {
    let mut out = String::with_capacity(pat.len() + 2);
    out.push('^');
    for c in pat.chars() {
        match c {
            '%' => out.push_str(".*"),
            '_' => out.push('.'),
            c if "\\.+*?()|[]{}^$".contains(c) => {
                out.push('\\');
                out.push(c);
            }
            c => out.push(c),
        }
    }
    out.push('$');
    out
}

/// Translate a `SELECT` statement into a [`SelectPlan`]. Returns an error
/// (never panics) for anything outside the supported subset.
pub fn translate_select(sql: &str) -> Result<SelectPlan, TranslateError> {
    let toks = Lexer::new(sql).tokenize()?;
    Parser::new(toks).parse_select()
}
