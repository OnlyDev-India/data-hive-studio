//! SQL-subset → MongoDB `find()` translator (Phase 4 of the MONGODB_SUPPORT
//! plan). Understands a single-table `SELECT` with a `WHERE` clause built
//! from comparisons combined with `AND`/`OR` (with parenthesized grouping),
//! `ORDER BY`, `LIMIT`, and `OFFSET`. No JOINs, no schema required — this is
//! deliberately a subset, not a general SQL engine. Pure and unit-testable;
//! all MongoDB I/O happens in `mongodb.rs`, which executes the plan this
//! module produces.

use std::fmt;

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

// ---- Tokenizer -------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Ident(String),
    Str(String),
    Num(String),
    /// `,` `(` `)` `*` `;` `.`
    Punct(char),
    Op(String),
    Eof,
}

struct Lexer<'a> {
    chars: std::iter::Peekable<std::str::CharIndices<'a>>,
    src: &'a str,
}

impl<'a> Lexer<'a> {
    fn new(src: &'a str) -> Self {
        Self { chars: src.char_indices().peekable(), src }
    }

    fn tokenize(mut self) -> Result<Vec<Tok>, TranslateError> {
        let mut out = Vec::new();
        loop {
            self.skip_ws_and_comments();
            let Some(&(i, c)) = self.chars.peek() else {
                out.push(Tok::Eof);
                return Ok(out);
            };
            if c.is_alphabetic() || c == '_' {
                out.push(Tok::Ident(self.read_ident()));
                continue;
            }
            if c.is_ascii_digit() {
                out.push(Tok::Num(self.read_number()));
                continue;
            }
            if c == '\'' {
                out.push(Tok::Str(self.read_string('\'')?));
                continue;
            }
            if c == '"' {
                // Double-quoted identifier (Postgres-style quoting).
                out.push(Tok::Ident(self.read_string('"')?));
                continue;
            }
            match c {
                ',' | '(' | ')' | '*' | ';' | '.' => {
                    self.chars.next();
                    out.push(Tok::Punct(c));
                }
                '=' => {
                    self.chars.next();
                    out.push(Tok::Op("=".into()));
                }
                '!' => {
                    self.chars.next();
                    if let Some(&(_, '=')) = self.chars.peek() {
                        self.chars.next();
                        out.push(Tok::Op("!=".into()));
                    } else {
                        return Err(err(format!("unexpected '!' at position {i}")));
                    }
                }
                '<' => {
                    self.chars.next();
                    match self.chars.peek() {
                        Some(&(_, '=')) => {
                            self.chars.next();
                            out.push(Tok::Op("<=".into()));
                        }
                        Some(&(_, '>')) => {
                            self.chars.next();
                            out.push(Tok::Op("!=".into()));
                        }
                        _ => out.push(Tok::Op("<".into())),
                    }
                }
                '>' => {
                    self.chars.next();
                    if let Some(&(_, '=')) = self.chars.peek() {
                        self.chars.next();
                        out.push(Tok::Op(">=".into()));
                    } else {
                        out.push(Tok::Op(">".into()));
                    }
                }
                _ => return Err(err(format!("unexpected character '{c}' at position {i}"))),
            }
        }
    }

    fn skip_ws_and_comments(&mut self) {
        loop {
            while let Some(&(_, c)) = self.chars.peek() {
                if c.is_whitespace() {
                    self.chars.next();
                } else {
                    break;
                }
            }
            if let Some(&(i, '-')) = self.chars.peek() {
                if self.src[i..].starts_with("--") {
                    while let Some(&(_, c)) = self.chars.peek() {
                        self.chars.next();
                        if c == '\n' {
                            break;
                        }
                    }
                    continue;
                }
            }
            if let Some(&(i, '/')) = self.chars.peek() {
                if self.src[i..].starts_with("/*") {
                    self.chars.next();
                    self.chars.next();
                    while let Some(&(j, _)) = self.chars.peek() {
                        if self.src[j..].starts_with("*/") {
                            self.chars.next();
                            self.chars.next();
                            break;
                        }
                        self.chars.next();
                    }
                    continue;
                }
            }
            break;
        }
    }

    fn read_ident(&mut self) -> String {
        let mut s = String::new();
        while let Some(&(_, c)) = self.chars.peek() {
            if c.is_alphanumeric() || c == '_' {
                s.push(c);
                self.chars.next();
            } else {
                break;
            }
        }
        s
    }

    fn read_number(&mut self) -> String {
        let mut s = String::new();
        let mut seen_dot = false;
        while let Some(&(_, c)) = self.chars.peek() {
            if c.is_ascii_digit() {
                s.push(c);
                self.chars.next();
            } else if c == '.' && !seen_dot {
                seen_dot = true;
                s.push(c);
                self.chars.next();
            } else {
                break;
            }
        }
        s
    }

    fn read_string(&mut self, quote: char) -> Result<String, TranslateError> {
        self.chars.next(); // opening quote
        let mut s = String::new();
        loop {
            match self.chars.next() {
                None => return Err(err("unterminated quoted literal")),
                Some((_, c)) if c == quote => {
                    // `''` inside a string is an escaped quote (SQL standard).
                    if let Some(&(_, next)) = self.chars.peek() {
                        if next == quote {
                            self.chars.next();
                            s.push(quote);
                            continue;
                        }
                    }
                    return Ok(s);
                }
                Some((_, c)) => s.push(c),
            }
        }
    }
}

// ---- Parser -----------------------------------------------------------

struct Parser {
    toks: Vec<Tok>,
    pos: usize,
}

/// Comparison operator between a field and a scalar value. `IN`/`LIKE`/`IS
/// NULL` are parsed as separate branches in [`Parser::parse_comparison`]
/// since their right-hand side shape differs from a plain scalar.
enum CmpOp {
    Eq,
    Ne,
    Lt,
    Lte,
    Gt,
    Gte,
}

enum Value {
    Str(String),
    Num(String),
    Bool(bool),
    Null,
}

impl Value {
    fn to_bson(&self) -> bson::Bson {
        match self {
            Value::Str(s) => bson::Bson::String(s.clone()),
            Value::Num(n) => {
                if n.contains('.') {
                    bson::Bson::Double(n.parse().unwrap_or(0.0))
                } else if let Ok(i) = n.parse::<i64>() {
                    bson::Bson::Int64(i)
                } else {
                    bson::Bson::Double(n.parse().unwrap_or(0.0))
                }
            }
            Value::Bool(b) => bson::Bson::Boolean(*b),
            Value::Null => bson::Bson::Null,
        }
    }
}

impl Parser {
    fn new(toks: Vec<Tok>) -> Self {
        Self { toks, pos: 0 }
    }

    fn peek(&self) -> &Tok {
        self.toks.get(self.pos).unwrap_or(&Tok::Eof)
    }

    fn advance(&mut self) -> Tok {
        let t = self.toks.get(self.pos).cloned().unwrap_or(Tok::Eof);
        if self.pos < self.toks.len() {
            self.pos += 1;
        }
        t
    }

    fn is_kw(&self, kw: &str) -> bool {
        matches!(self.peek(), Tok::Ident(s) if s.eq_ignore_ascii_case(kw))
    }

    fn eat_kw(&mut self, kw: &str) -> bool {
        if self.is_kw(kw) {
            self.advance();
            true
        } else {
            false
        }
    }

    fn expect_kw(&mut self, kw: &str) -> Result<(), TranslateError> {
        if self.eat_kw(kw) {
            Ok(())
        } else {
            Err(err(format!("expected `{}`, found {:?}", kw.to_ascii_uppercase(), self.peek())))
        }
    }

    fn expect_punct(&mut self, c: char) -> Result<(), TranslateError> {
        if matches!(self.peek(), Tok::Punct(p) if *p == c) {
            self.advance();
            Ok(())
        } else {
            Err(err(format!("expected '{c}', found {:?}", self.peek())))
        }
    }

    fn expect_ident(&mut self) -> Result<String, TranslateError> {
        match self.advance() {
            Tok::Ident(s) => Ok(s),
            other => Err(err(format!("expected an identifier, found {other:?}"))),
        }
    }

    fn parse_select(&mut self) -> Result<SelectPlan, TranslateError> {
        self.expect_kw("select")?;
        let columns = self.parse_select_list()?;
        self.expect_kw("from")?;
        let table = self.expect_ident()?;

        let mut filter = None;
        if self.eat_kw("where") {
            filter = Some(self.parse_or_expr()?);
        }

        let mut sort = None;
        if self.eat_kw("order") {
            self.expect_kw("by")?;
            sort = Some(self.parse_order_list()?);
        }

        let mut limit = None;
        if self.eat_kw("limit") {
            limit = Some(self.parse_int()?);
        }

        let mut offset = None;
        if self.eat_kw("offset") {
            offset = Some(self.parse_int()?);
        }

        // Tolerate a trailing semicolon, then require end of input.
        if matches!(self.peek(), Tok::Punct(';')) {
            self.advance();
        }
        if !matches!(self.peek(), Tok::Eof) {
            return Err(err(format!("unexpected trailing input near {:?}", self.peek())));
        }

        Ok(SelectPlan { table, columns, filter, sort, limit, offset })
    }

    fn parse_select_list(&mut self) -> Result<Option<Vec<String>>, TranslateError> {
        if matches!(self.peek(), Tok::Punct('*')) {
            self.advance();
            return Ok(None);
        }
        let mut cols = vec![self.parse_column_ref()?];
        while matches!(self.peek(), Tok::Punct(',')) {
            self.advance();
            cols.push(self.parse_column_ref()?);
        }
        Ok(Some(cols))
    }

    /// A field reference: `name` or dotted `a.b.c` (nested field path).
    fn parse_column_ref(&mut self) -> Result<String, TranslateError> {
        let mut s = self.expect_ident()?;
        while matches!(self.peek(), Tok::Punct('.')) {
            self.advance();
            s.push('.');
            s.push_str(&self.expect_ident()?);
        }
        Ok(s)
    }

    fn parse_int(&mut self) -> Result<i64, TranslateError> {
        match self.advance() {
            Tok::Num(n) => n
                .parse::<i64>()
                .map_err(|_| err(format!("expected an integer, found `{n}`"))),
            other => Err(err(format!("expected a number, found {other:?}"))),
        }
    }

    fn parse_order_list(&mut self) -> Result<bson::Document, TranslateError> {
        let mut d = bson::Document::new();
        loop {
            let col = self.parse_column_ref()?;
            let mut dir = 1;
            if self.eat_kw("asc") {
                dir = 1;
            } else if self.eat_kw("desc") {
                dir = -1;
            }
            d.insert(col, dir);
            if matches!(self.peek(), Tok::Punct(',')) {
                self.advance();
                continue;
            }
            break;
        }
        Ok(d)
    }

    // expr := or_expr
    // or_expr := and_expr (OR and_expr)*
    // and_expr := term (AND term)*
    // term := '(' or_expr ')' | comparison
    fn parse_or_expr(&mut self) -> Result<bson::Document, TranslateError> {
        let mut parts = vec![self.parse_and_expr()?];
        while self.eat_kw("or") {
            parts.push(self.parse_and_expr()?);
        }
        Ok(if parts.len() == 1 {
            parts.into_iter().next().unwrap()
        } else {
            bson::doc! { "$or": parts }
        })
    }

    fn parse_and_expr(&mut self) -> Result<bson::Document, TranslateError> {
        let mut parts = vec![self.parse_term()?];
        while self.eat_kw("and") {
            parts.push(self.parse_term()?);
        }
        Ok(if parts.len() == 1 {
            parts.into_iter().next().unwrap()
        } else {
            bson::doc! { "$and": parts }
        })
    }

    fn parse_term(&mut self) -> Result<bson::Document, TranslateError> {
        if matches!(self.peek(), Tok::Punct('(')) {
            self.advance();
            let inner = self.parse_or_expr()?;
            self.expect_punct(')')?;
            return Ok(inner);
        }
        self.parse_comparison()
    }

    fn parse_comparison(&mut self) -> Result<bson::Document, TranslateError> {
        let field = self.parse_column_ref()?;

        if self.eat_kw("is") {
            let negate = self.eat_kw("not");
            self.expect_kw("null")?;
            return Ok(if negate {
                bson::doc! { field: { "$ne": bson::Bson::Null } }
            } else {
                bson::doc! { field: bson::Bson::Null }
            });
        }

        let negate_list = self.eat_kw("not");
        if self.eat_kw("in") {
            let values = self.parse_value_list()?;
            let op = if negate_list { "$nin" } else { "$in" };
            return Ok(bson::doc! { field: { op: values } });
        }
        if self.eat_kw("like") {
            let pat = self.parse_string_value()?;
            let regex = like_to_regex(&pat);
            let cond = bson::doc! { "$regex": regex };
            return Ok(if negate_list {
                bson::doc! { field: { "$not": cond } }
            } else {
                bson::doc! { field: cond }
            });
        }
        if negate_list {
            return Err(err("expected IN or LIKE after NOT"));
        }

        let op = self.parse_cmp_op()?;
        let value = self.parse_value()?.to_bson();
        Ok(match op {
            CmpOp::Eq => bson::doc! { field: value },
            CmpOp::Ne => bson::doc! { field: { "$ne": value } },
            CmpOp::Lt => bson::doc! { field: { "$lt": value } },
            CmpOp::Lte => bson::doc! { field: { "$lte": value } },
            CmpOp::Gt => bson::doc! { field: { "$gt": value } },
            CmpOp::Gte => bson::doc! { field: { "$gte": value } },
        })
    }

    fn parse_cmp_op(&mut self) -> Result<CmpOp, TranslateError> {
        match self.advance() {
            Tok::Op(o) => match o.as_str() {
                "=" => Ok(CmpOp::Eq),
                "!=" => Ok(CmpOp::Ne),
                "<" => Ok(CmpOp::Lt),
                "<=" => Ok(CmpOp::Lte),
                ">" => Ok(CmpOp::Gt),
                ">=" => Ok(CmpOp::Gte),
                other => Err(err(format!("unknown operator `{other}`"))),
            },
            other => Err(err(format!(
                "expected a comparison operator (=, !=, <, <=, >, >=), IN, LIKE, or IS, found {other:?}"
            ))),
        }
    }

    fn parse_value(&mut self) -> Result<Value, TranslateError> {
        match self.advance() {
            Tok::Str(s) => Ok(Value::Str(s)),
            Tok::Num(n) => Ok(Value::Num(n)),
            Tok::Ident(id) if id.eq_ignore_ascii_case("true") => Ok(Value::Bool(true)),
            Tok::Ident(id) if id.eq_ignore_ascii_case("false") => Ok(Value::Bool(false)),
            Tok::Ident(id) if id.eq_ignore_ascii_case("null") => Ok(Value::Null),
            other => Err(err(format!("expected a value, found {other:?}"))),
        }
    }

    fn parse_string_value(&mut self) -> Result<String, TranslateError> {
        match self.advance() {
            Tok::Str(s) => Ok(s),
            other => Err(err(format!("expected a string literal, found {other:?}"))),
        }
    }

    fn parse_value_list(&mut self) -> Result<Vec<bson::Bson>, TranslateError> {
        self.expect_punct('(')?;
        let mut out = vec![self.parse_value()?.to_bson()];
        while matches!(self.peek(), Tok::Punct(',')) {
            self.advance();
            out.push(self.parse_value()?.to_bson());
        }
        self.expect_punct(')')?;
        Ok(out)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(sql: &str) -> SelectPlan {
        translate_select(sql).unwrap_or_else(|e| panic!("translate failed for `{sql}`: {e}"))
    }

    #[test]
    fn select_star_no_where() {
        let p = plan("SELECT * FROM users");
        assert_eq!(p.table, "users");
        assert_eq!(p.columns, None);
        assert_eq!(p.filter, None);
    }

    #[test]
    fn select_columns() {
        let p = plan("SELECT name, age FROM users");
        assert_eq!(p.columns, Some(vec!["name".into(), "age".into()]));
    }

    #[test]
    fn simple_equality_where() {
        let p = plan("SELECT * FROM users WHERE status = 'active'");
        assert_eq!(p.filter, Some(bson::doc! { "status": "active" }));
    }

    #[test]
    fn numeric_comparison() {
        let p = plan("SELECT * FROM users WHERE age > 18");
        assert_eq!(p.filter, Some(bson::doc! { "age": { "$gt": 18i64 } }));
    }

    #[test]
    fn and_combines_into_and_array() {
        let p = plan("SELECT * FROM users WHERE age > 18 AND status = 'active'");
        assert_eq!(
            p.filter,
            Some(bson::doc! { "$and": [
                { "age": { "$gt": 18i64 } },
                { "status": "active" },
            ] })
        );
    }

    #[test]
    fn or_has_lower_precedence_than_and() {
        // a AND b OR c  ==  (a AND b) OR c
        let p = plan("SELECT * FROM t WHERE a = 1 AND b = 2 OR c = 3");
        assert_eq!(
            p.filter,
            Some(bson::doc! { "$or": [
                { "$and": [ { "a": 1i64 }, { "b": 2i64 } ] },
                { "c": 3i64 },
            ] })
        );
    }

    #[test]
    fn parens_group_explicitly() {
        let p = plan("SELECT * FROM t WHERE a = 1 AND (b = 2 OR c = 3)");
        assert_eq!(
            p.filter,
            Some(bson::doc! { "$and": [
                { "a": 1i64 },
                { "$or": [ { "b": 2i64 }, { "c": 3i64 } ] },
            ] })
        );
    }

    #[test]
    fn is_null_and_is_not_null() {
        assert_eq!(
            plan("SELECT * FROM t WHERE a IS NULL").filter,
            Some(bson::doc! { "a": bson::Bson::Null })
        );
        assert_eq!(
            plan("SELECT * FROM t WHERE a IS NOT NULL").filter,
            Some(bson::doc! { "a": { "$ne": bson::Bson::Null } })
        );
    }

    #[test]
    fn in_and_not_in() {
        assert_eq!(
            plan("SELECT * FROM t WHERE a IN (1, 2, 3)").filter,
            Some(bson::doc! { "a": { "$in": [1i64, 2i64, 3i64] } })
        );
        assert_eq!(
            plan("SELECT * FROM t WHERE a NOT IN ('x', 'y')").filter,
            Some(bson::doc! { "a": { "$nin": ["x", "y"] } })
        );
    }

    #[test]
    fn like_translates_to_anchored_regex() {
        let p = plan("SELECT * FROM t WHERE name LIKE 'Jo%'");
        assert_eq!(
            p.filter,
            Some(bson::doc! { "name": { "$regex": "^Jo.*$" } })
        );
    }

    #[test]
    fn escaped_quote_in_string_literal() {
        let p = plan("SELECT * FROM t WHERE name = 'O''Brien'");
        assert_eq!(p.filter, Some(bson::doc! { "name": "O'Brien" }));
    }

    #[test]
    fn order_by_limit_offset() {
        let p = plan("SELECT * FROM users ORDER BY age DESC, name LIMIT 10 OFFSET 5");
        assert_eq!(p.sort, Some(bson::doc! { "age": -1, "name": 1 }));
        assert_eq!(p.limit, Some(10));
        assert_eq!(p.offset, Some(5));
    }

    #[test]
    fn dotted_nested_field_path() {
        let p = plan("SELECT * FROM users WHERE address.city = 'NYC'");
        assert_eq!(p.filter, Some(bson::doc! { "address.city": "NYC" }));
    }

    #[test]
    fn boolean_and_null_literals() {
        let p = plan("SELECT * FROM t WHERE active = true");
        assert_eq!(p.filter, Some(bson::doc! { "active": true }));
    }

    #[test]
    fn semicolon_and_trailing_whitespace_tolerated() {
        let p = plan("SELECT * FROM users ;  ");
        assert_eq!(p.table, "users");
    }

    #[test]
    fn rejects_non_select() {
        assert!(translate_select("UPDATE users SET a = 1").is_err());
        assert!(translate_select("DELETE FROM users").is_err());
    }

    #[test]
    fn is_select_detects_select_statements() {
        assert!(is_select("  SELECT * FROM t"));
        assert!(is_select("-- comment\nSELECT * FROM t"));
        assert!(!is_select("UPDATE t SET a = 1"));
        assert!(!is_select("INSERT INTO t VALUES (1)"));
    }

    #[test]
    fn rejects_join() {
        // JOINs are explicitly out of scope for this translator.
        assert!(translate_select("SELECT * FROM a JOIN b ON a.id = b.id").is_err());
    }

    #[test]
    fn rejects_malformed_where() {
        assert!(translate_select("SELECT * FROM t WHERE").is_err());
        assert!(translate_select("SELECT * FROM t WHERE a =").is_err());
    }
}
