use super::{SelectPlan, TranslateError, err, like_to_regex};
use super::lexer::Tok;

// ---- Parser -----------------------------------------------------------
pub(super) struct Parser {
    pub(super) toks: Vec<Tok>,
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
    pub(super) fn new(toks: Vec<Tok>) -> Self {
        Self { toks, pos: 0 }
    }

    pub(super) fn peek(&self) -> &Tok {
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

    pub(super) fn parse_select(&mut self) -> Result<SelectPlan, TranslateError> {
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
