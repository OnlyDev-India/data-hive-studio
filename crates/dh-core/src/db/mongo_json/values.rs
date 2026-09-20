use bson::{Bson, Document, Regex};
use super::{ParseError, Parser, utf8_len};

impl<'a> Parser<'a> {
    /// Parse a JSON string literal, handling escapes incl. surrogate pairs
    /// for non-BMP characters (e.g. emoji).
    pub(super) fn parse_string(&mut self) -> Result<String, ParseError> {
        self.expect(b'"', "\"")?;
        let mut out = String::new();
        loop {
            let Some(c) = self.peek() else {
                return Err(self.err("unterminated string"));
            };
            self.i += 1;
            match c {
                b'"' => break,
                b'\\' => {
                    let Some(e) = self.peek() else {
                        return Err(self.err("unterminated escape"));
                    };
                    self.i += 1;
                    match e {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{0008}'),
                        b'f' => out.push('\u{000C}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let hi = self.hex4()?;
                            if (0xD800..=0xDBFF).contains(&hi) {
                                // High surrogate: expect a following \uXXXX low
                                // surrogate to assemble the code point.
                                let lo = if self.peek() == Some(b'\\') {
                                    self.i += 1;
                                    if self.peek() == Some(b'u') {
                                        self.i += 1;
                                        Some(self.hex4()?)
                                    } else {
                                        None
                                    }
                                } else {
                                    None
                                };
                                if let Some(lo) = lo {
                                    if (0xDC00..=0xDFFF).contains(&lo) {
                                        let cp =
                                            0x10000 + (((hi as u32 - 0xD800) << 10) | (lo as u32 - 0xDC00));
                                        out.push(char::from_u32(cp).unwrap_or('\u{FFFD}'));
                                    } else {
                                        out.push('\u{FFFD}');
                                        out.push(char::from_u32(lo.into()).unwrap_or('\u{FFFD}'));
                                    }
                                } else {
                                    out.push('\u{FFFD}');
                                }
                            } else if (0xDC00..=0xDFFF).contains(&hi) {
                                out.push('\u{FFFD}');
                            } else {
                                out.push(char::from_u32(hi as u32).unwrap_or('\u{FFFD}'));
                            }
                        }
                        _ => return Err(self.err("invalid escape sequence")),
                    }
                }
                _ => {
                    // Raw (non-escape) byte: copy the whole UTF-8 code point.
                    let ch = self.s[self.i - 1] as char;
                    let len = utf8_len(self.s[self.i - 1]);
                    // Determine how many continuation bytes follow.
                    let cont = if len > 1 {
                        self.s[self.i..]
                            .iter()
                            .take(len - 1)
                            .take_while(|&&b| b & 0xC0 == 0x80)
                            .count()
                    } else {
                        0
                    };
                    let end = (self.i - 1 + 1 + cont).min(self.s.len());
                    if let Ok(s) = std::str::from_utf8(&self.s[self.i - 1..end]) {
                        out.push_str(s);
                    } else {
                        out.push(ch);
                    }
                    self.i = end;
                }
            }
        }
        Ok(out)
    }

    fn hex4(&mut self) -> Result<u16, ParseError> {
        if self.i + 4 > self.s.len() {
            return Err(self.err("bad \\u escape"));
        }
        let digits = &self.s[self.i..self.i + 4];
        let mut v: u16 = 0;
        for &d in digits {
            let n = match d {
                b'0'..=b'9' => d - b'0',
                b'a'..=b'f' => d - b'a' + 10,
                b'A'..=b'F' => d - b'A' + 10,
                _ => return Err(self.err("bad \\u escape digit")),
            };
            v = v * 16 + n as u16;
        }
        self.i += 4;
        Ok(v)
    }

    pub(super) fn parse_value(&mut self) -> Result<Bson, ParseError> {
        self.skip_ws();
        let c = self.peek().ok_or_else(|| self.err("expected a value"))?;
        match c {
            b'{' => self.parse_object().map(Bson::Document),
            b'[' => self.parse_array().map(Bson::Array),
            b'"' => self.parse_string().map(Bson::String),
            b'-' | b'0'..=b'9' => self.parse_number(),
            b't' => {
                self.expect_word("true")?;
                Ok(Bson::Boolean(true))
            }
            b'f' => {
                self.expect_word("false")?;
                Ok(Bson::Boolean(false))
            }
            b'n' => {
                self.expect_word("null")?;
                Ok(Bson::Null)
            }
            b'/' => self.parse_regex_literal(),
            _ => {
                // Constructor call, e.g. ObjectId("...").
                self.parse_constructor()
            }
        }
    }

    fn parse_object(&mut self) -> Result<Document, ParseError> {
        let mut doc = Document::new();
        self.expect(b'{', "{")?;
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.i += 1;
            return Ok(doc);
        }
        loop {
            self.skip_ws();
            let key = self.parse_string()?;
            self.expect(b':', ":")?;
            let value = self.parse_value()?;
            doc.insert(key, value);
            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.i += 1;
                }
                Some(b'}') => {
                    self.i += 1;
                    break;
                }
                _ => return Err(self.err("expected `,` or `}`")),
            }
        }
        Ok(doc)
    }

    fn parse_array(&mut self) -> Result<Vec<Bson>, ParseError> {
        let mut arr = Vec::new();
        self.expect(b'[', "[")?;
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.i += 1;
            return Ok(arr);
        }
        loop {
            let value = self.parse_value()?;
            arr.push(value);
            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.i += 1;
                }
                Some(b']') => {
                    self.i += 1;
                    break;
                }
                _ => return Err(self.err("expected `,` or `]`")),
            }
        }
        Ok(arr)
    }

    pub(super) fn parse_number(&mut self) -> Result<Bson, ParseError> {
        let start = self.i;
        let mut is_float = false;
        if self.peek() == Some(b'-') {
            self.i += 1;
        }
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.i += 1;
        }
        if matches!(self.peek(), Some(b'.')) {
            is_float = true;
            self.i += 1;
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.i += 1;
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            is_float = true;
            self.i += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.i += 1;
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.i += 1;
            }
        }
        let text = std::str::from_utf8(&self.s[start..self.i])
            .map_err(|_| self.err("invalid number"))?;
        if is_float {
            text.parse::<f64>()
                .map(Bson::Double)
                .map_err(|_| self.err("invalid number"))
        } else {
            text.parse::<i64>()
                .map(Bson::Int64)
                .or_else(|_| text.parse::<f64>().map(Bson::Double))
                .map_err(|_| self.err("invalid number"))
        }
    }

    fn parse_regex_literal(&mut self) -> Result<Bson, ParseError> {
        // Starts at '/'. Pattern runs to the next unescaped '/'.
        self.i += 1;
        let mut pattern = String::new();
        let mut closed = false;
        while let Some(c) = self.peek() {
            self.i += 1;
            match c {
                b'\\' => {
                    let Some(n) = self.peek() else { break };
                    self.i += 1;
                    pattern.push('\\');
                    pattern.push(n as char);
                }
                b'/' => {
                    closed = true;
                    break;
                }
                _ => pattern.push(c as char),
            }
        }
        if !closed {
            return Err(self.err("unterminated regex literal"));
        }
        let mut options = String::new();
        while let Some(c) = self.peek() {
            if c.is_ascii_alphanumeric() {
                self.i += 1;
                options.push(c as char);
            } else {
                break;
            }
        }
        Ok(Bson::RegularExpression(Regex { pattern, options }))
    }
}
