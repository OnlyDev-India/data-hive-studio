//! Type-aware MongoDB document text format (MQL "extended JSON").
//!
//! The JSON editor works with *strict JSON* whose value positions may also be
//! BSON constructor calls, mirroring Studio 3T / Mongo Compass, e.g.:
//!
//! ```text
//! {
//!   "_id": ObjectId("507f1f77bcf86cd799439011"),
//!   "name": "Alice",
//!   "createdAt": ISODate("2026-01-01T00:00:00Z"),
//!   "count": NumberLong("9223372036854775807"),
//!   "pi": Decimal128("3.141592653589793"),
//!   "blob": Binary("AAEC", "00"),
//!   "uid": UUID("a7f0..."),
//!   "pattern": /^foo$/i,
//!   "ts": Timestamp(1620000000, 1),
//!   "min": MinKey(),
//!   "max": MaxKey()
//! }
//! ```
//!
//! This module owns the two directions:
//!
//! * [`parse`] — hand-written recursive-descent parser turning that text back
//!   into a `bson::Document`. It is the authoritative parser used when saving
//!   / inserting documents.
//! * [`render`] — serializes a `bson::Document` to the same text so loaded
//!   documents display their real types and round-trip losslessly.

use std::str::FromStr;

use base64::Engine;
use bson::{Bson, DateTime, Decimal128, Document, Regex, Timestamp, oid::ObjectId};

/// Error produced while parsing MQL extended JSON.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError(pub String);

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// Parse MQL extended JSON into a BSON document.
pub fn parse(input: &str) -> Result<Document, ParseError> {
    let mut p = Parser { s: input.as_bytes(), i: 0 };
    p.skip_ws();
    let value = p.parse_value()?;
    p.skip_ws();
    if p.i < p.s.len() {
        return Err(p.err("unexpected trailing content"));
    }
    match value {
        Bson::Document(d) => Ok(d),
        _ => Err(ParseError("document must be an object ({ ... })".into())),
    }
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
}

/// Byte length of the UTF-8 sequence whose leading byte is `b`.
fn utf8_len(b: u8) -> usize {
    if b < 0x80 {
        1
    } else if b >> 5 == 0b110 {
        2
    } else if b >> 4 == 0b1110 {
        3
    } else if b >> 3 == 0b11110 {
        4
    } else {
        1
    }
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<u8> {
        self.s.get(self.i).copied()
    }

    fn err(&self, msg: &str) -> ParseError {
        ParseError(format!("{msg} at byte {}", self.i))
    }

    fn skip_ws(&mut self) {
        while let Some(c) = self.peek() {
            if c == b' ' || c == b'\t' || c == b'\n' || c == b'\r' {
                self.i += 1;
            } else {
                break;
            }
        }
    }

    fn expect(&mut self, c: u8, what: &str) -> Result<(), ParseError> {
        self.skip_ws();
        if self.peek() == Some(c) {
            self.i += 1;
            Ok(())
        } else {
            Err(self.err(&format!("expected {what}")))
        }
    }

    /// Read a bare identifier (constructor name).
    fn parse_ident(&mut self) -> Result<String, ParseError> {
        self.skip_ws();
        let start = self.i;
        while let Some(c) = self.peek() {
            if c.is_ascii_alphanumeric() || c == b'_' || c == b'$' {
                self.i += 1;
            } else {
                break;
            }
        }
        if self.i == start {
            return Err(self.err("expected a name"));
        }
        Ok(String::from_utf8_lossy(&self.s[start..self.i]).into_owned())
    }

    /// Parse a JSON string literal, handling escapes incl. surrogate pairs
    /// for non-BMP characters (e.g. emoji).
    fn parse_string(&mut self) -> Result<String, ParseError> {
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

    fn parse_value(&mut self) -> Result<Bson, ParseError> {
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

    fn expect_word(&mut self, w: &str) -> Result<(), ParseError> {
        if self.s[self.i..].starts_with(w.as_bytes()) {
            self.i += w.len();
            Ok(())
        } else {
            Err(self.err(&format!("expected `{w}`")))
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

    fn parse_number(&mut self) -> Result<Bson, ParseError> {
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

    fn parse_constructor(&mut self) -> Result<Bson, ParseError> {
        let name = self.parse_ident()?;
        self.expect(b'(', "(")?;
        match name.as_str() {
            "ObjectId" => {
                let hex = self.parse_string()?;
                let oid = ObjectId::parse_str(&hex)
                    .map_err(|_| self.err("ObjectId(): invalid 24-char hex id"))?;
                self.expect(b')', ")")?;
                Ok(Bson::ObjectId(oid))
            }
            "ISODate" | "Date" => {
                let s = self.parse_string()?;
                let dt = DateTime::parse_rfc3339_str(&s)
                    .map_err(|_| self.err("ISODate(): expected an RFC3339 date-time"))?;
                self.expect(b')', ")")?;
                Ok(Bson::DateTime(dt))
            }
            "NumberLong" => {
                let v = self.parse_i64_arg()?;
                self.expect(b')', ")")?;
                Ok(Bson::Int64(v))
            }
            "Int32" => {
                let v = self.parse_i64_arg()?;
                self.expect(b')', ")")?;
                Ok(Bson::Int32(v as i32))
            }
            "Double" => {
                let v = self.parse_f64_arg()?;
                self.expect(b')', ")")?;
                Ok(Bson::Double(v))
            }
            "NumberDecimal" | "Decimal128" => {
                let s = self.parse_string()?;
                let d = Decimal128::from_str(&s).map_err(|_| self.err("NumberDecimal(): invalid decimal"))?;
                self.expect(b')', ")")?;
                Ok(Bson::Decimal128(d))
            }
            "Binary" => {
                let base64 = self.parse_string()?;
                self.skip_ws();
                self.expect(b',', ",")?;
                let sub = self.parse_string()?;
                let subtype = u8::from_str_radix(&sub, 16)
                    .map_err(|_| self.err("Binary(): subtype must be hex, e.g. \"00\""))?;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(&base64)
                    .map_err(|_| self.err("Binary(): invalid base64 payload"))?;
                self.expect(b')', ")")?;
                Ok(Bson::Binary(bson::Binary { subtype: subtype.into(), bytes }))
            }
            "BinData" => {
                let sub = self.parse_i64_arg()? as u8;
                self.skip_ws();
                self.expect(b',', ",")?;
                let base64 = self.parse_string()?;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(&base64)
                    .map_err(|_| self.err("BinData(): invalid base64 payload"))?;
                self.expect(b')', ")")?;
                Ok(Bson::Binary(bson::Binary { subtype: (sub as u8).into(), bytes }))
            }
            "UUID" => {
                let s = self.parse_string()?;
                let raw = s.replace('-', "");
                let bytes = (0..raw.len() / 2)
                    .map(|i| u8::from_str_radix(&raw[i * 2..i * 2 + 2], 16))
                    .collect::<Result<Vec<u8>, _>>()
                    .map_err(|_| self.err("UUID(): invalid uuid"))?;
                if bytes.len() != 16 {
                    return Err(self.err("UUID(): expected 16 bytes (32 hex chars)"));
                }
                self.expect(b')', ")")?;
                Ok(Bson::Binary(bson::Binary { subtype: bson::spec::BinarySubtype::Uuid, bytes }))
            }
            "RegExp" => {
                let pattern = self.parse_string()?;
                self.skip_ws();
                self.expect(b',', ",")?;
                let options = self.parse_string()?;
                self.expect(b')', ")")?;
                Ok(Bson::RegularExpression(Regex { pattern, options }))
            }
            "Timestamp" => {
                let t = self.parse_i64_arg()? as u32;
                self.skip_ws();
                self.expect(b',', ",")?;
                let i = self.parse_i64_arg()? as u32;
                self.expect(b')', ")")?;
                Ok(Bson::Timestamp(Timestamp { time: t, increment: i }))
            }
            "MinKey" => {
                self.expect(b')', ")")?;
                Ok(Bson::MinKey)
            }
            "MaxKey" => {
                self.expect(b')', ")")?;
                Ok(Bson::MaxKey)
            }
            "Symbol" => {
                let s = self.parse_string()?;
                self.expect(b')', ")")?;
                Ok(Bson::Symbol(s))
            }
            _ => Err(self.err(&format!("unknown BSON constructor `{name}()`"))),
        }
    }

    /// Argument for NumberLong/Int32/Timestamp: either a bare number or a
    /// quoted decimal string (to handle values beyond i64 text precision).
    fn parse_i64_arg(&mut self) -> Result<i64, ParseError> {
        self.skip_ws();
        if self.peek() == Some(b'"') {
            let s = self.parse_string()?;
            s.trim().parse::<i64>().map_err(|_| self.err("expected an integer"))
        } else {
            // Reuse number parsing but require an integer (no float).
            let start = self.i;
            self.parse_number()?;
            let text = std::str::from_utf8(&self.s[start..self.i]).map_err(|_| self.err("bad number"))?;
            text.parse::<i64>().map_err(|_| self.err("expected an integer"))
        }
    }

    fn parse_f64_arg(&mut self) -> Result<f64, ParseError> {
        self.skip_ws();
        let start = self.i;
        self.parse_number()?;
        let text = std::str::from_utf8(&self.s[start..self.i]).map_err(|_| self.err("bad number"))?;
        text.parse::<f64>().map_err(|_| self.err("expected a number"))
    }
}

/// Quote unquoted (Mongo-shell-style) object keys so `serde_json::from_str`
/// accepts relaxed filter/query text like `{name: "test"}` the same way
/// `mongosh` does. Left untouched inside double-quoted strings. A bare
/// identifier is only quoted when followed (modulo whitespace) by `:` — the
/// one position a JS/JSON object key can occur — so it never mistakes a bare
/// value, `true`/`false`/`null`, or a BSON constructor call for a key.
pub fn quote_bare_keys(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len() + 8);
    let mut i = 0usize;
    while i < chars.len() {
        let c = chars[i];
        if c == '"' {
            let start = i;
            i += 1;
            while i < chars.len() {
                if chars[i] == '\\' && i + 1 < chars.len() {
                    i += 2;
                    continue;
                }
                if chars[i] == '"' {
                    i += 1;
                    break;
                }
                i += 1;
            }
            out.extend(chars[start..i.min(chars.len())].iter());
            continue;
        }
        if c.is_alphabetic() || c == '_' || c == '$' {
            let start = i;
            let mut j = i;
            while j < chars.len()
                && (chars[j].is_alphanumeric() || chars[j] == '_' || chars[j] == '$')
            {
                j += 1;
            }
            let mut k = j;
            while k < chars.len() && chars[k].is_whitespace() {
                k += 1;
            }
            if k < chars.len() && chars[k] == ':' {
                out.push('"');
                out.extend(chars[start..j].iter());
                out.push('"');
            } else {
                out.extend(chars[start..j].iter());
            }
            i = j;
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}

/// Render a BSON document to MQL extended JSON text.
pub fn render(doc: &Document) -> String {
    let mut out = String::new();
    render_document(doc, &mut out, 0);
    out
}

fn render_document(doc: &Document, out: &mut String, depth: usize) {
    out.push('{');
    let mut first = true;
    for (k, v) in doc.iter() {
        if !first {
            out.push(',');
        }
        push_indent(out, depth + 1);
        out.push_str(&json_encode(k));
        out.push_str(": ");
        render_value(v, out, depth + 1);
        first = false;
    }
    if !first {
        out.push('\n');
        push_indent(out, depth);
    }
    out.push('}');
}

fn render_array(arr: &[Bson], out: &mut String, depth: usize) {
    out.push('[');
    let mut first = true;
    for v in arr {
        if !first {
            out.push(',');
        }
        push_indent(out, depth + 1);
        render_value(v, out, depth + 1);
        first = false;
    }
    if !first {
        out.push('\n');
        push_indent(out, depth);
    }
    out.push(']');
}

fn render_value(v: &Bson, out: &mut String, depth: usize) {
    use bson::Bson::*;
    match v {
        Double(f) => out.push_str(&format!("Double({f})")),
        String(s) => out.push_str(&json_encode(s)),
        Array(a) => render_array(a, out, depth),
        Document(d) => render_document(d, out, depth),
        Boolean(b) => out.push_str(if *b { "true" } else { "false" }),
        Int32(i) => out.push_str(&format!("Int32({i})")),
        Int64(i) => out.push_str(&format!("NumberLong({i})")),
        Decimal128(d) => out.push_str(&format!("NumberDecimal(\"{}\")", d.to_string())),
        DateTime(dt) => out.push_str(&format!("ISODate(\"{}\")", dt.try_to_rfc3339_string().unwrap_or_default())),
        Null | Undefined => out.push_str("null"),
        ObjectId(oid) => out.push_str(&format!("ObjectId(\"{}\")", oid.to_hex())),
        Binary(bin) => {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bin.bytes);
            let sub = format!("{:02X}", u8::from(bin.subtype));
            out.push_str(&format!("Binary(\"{b64}\", \"{sub}\")"));
        }
        RegularExpression(rx) => {
            out.push('/');
            out.push_str(&rx.pattern);
            out.push('/');
            out.push_str(&rx.options);
        }
        Timestamp(ts) => out.push_str(&format!("Timestamp({}, {})", ts.time, ts.increment)),
        MinKey => out.push_str("MinKey()"),
        MaxKey => out.push_str("MaxKey()"),
        Symbol(s) => out.push_str(&format!("Symbol(\"{}\")", json_encode(s))),
        other => out.push_str(&json_encode(&other.to_string())),
    }
}

fn push_indent(out: &mut String, depth: usize) {
    out.push('\n');
    for _ in 0..depth {
        out.push_str("  ");
    }
}

/// JSON-encode a string value (quoted, with escapes).
fn json_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000C}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04X}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render_ok(input: &str) -> String {
        let d = parse(input).expect("parse should succeed");
        render(&d)
    }

    #[test]
    fn parses_basic_document() {
        let d = parse(r#"{ "a": 1, "b": "x", "c": true, "d": null, "e": [1, 2] }"#).unwrap();
        assert_eq!(d.get_i64("a"), Ok(1));
        assert_eq!(d.get_str("b"), Ok("x"));
        assert_eq!(d.get_bool("c"), Ok(true));
        assert!(matches!(d.get("d"), Some(Bson::Null)));
        assert!(d.get_array("e").is_ok());
    }

    #[test]
    fn parses_constructors() {
        let d = parse(
            r#"{
                "_id": ObjectId("507f1f77bcf86cd799439011"),
                "when": ISODate("2026-01-01T00:00:00Z"),
                "big": NumberLong("9223372036854775807"),
                "n": Int32(5),
                "pi": NumberDecimal("3.14"),
                "rx": /^foo$/i,
                "ts": Timestamp(1620000000, 1),
                "min": MinKey()
            }"#,
        )
        .unwrap();
        assert!(matches!(d.get("_id"), Some(Bson::ObjectId(_))));
        assert!(matches!(d.get("when"), Some(Bson::DateTime(_))));
        assert!(matches!(d.get("big"), Some(Bson::Int64(_))));
        assert!(matches!(d.get("n"), Some(Bson::Int32(_))));
        assert!(matches!(d.get("pi"), Some(Bson::Decimal128(_))));
        assert!(matches!(d.get("rx"), Some(Bson::RegularExpression(r)) if r.options == "i"));
        assert!(matches!(d.get("ts"), Some(Bson::Timestamp(_))));
        assert!(matches!(d.get("min"), Some(Bson::MinKey)));
    }

    #[test]
    fn round_trip_preserves_types() {
        let input = r#"{ "x": ObjectId("507f1f77bcf86cd799439011"), "y": NumberLong(42) }"#;
        let rendered = render_ok(input);
        // Re-parse must keep the ObjectId (not degrade to string).
        let again = parse(&rendered).unwrap();
        assert!(matches!(again.get("x"), Some(Bson::ObjectId(_))));
        assert!(matches!(again.get("y"), Some(Bson::Int64(_))));
    }

    #[test]
    fn rejects_bad_input() {
        assert!(parse("{").is_err());
        assert!(parse(r#"{ "a": ObjectId("nope") }"#).is_err());
        assert!(parse(r#"{ "a": UnknownCtor(1) }"#).is_err());
        assert!(parse("not a document").is_err());
    }

    #[test]
    fn parses_nested_and_arrays() {
        let d = parse(r#"{ "a": { "b": [ObjectId("507f1f77bcf86cd799439011"), "s"] } }"#).unwrap();
        let a = d.get_document("a").unwrap();
        let arr = a.get_array("b").unwrap();
        assert_eq!(arr.len(), 2);
        assert!(matches!(arr[0], Bson::ObjectId(_)));
    }

    #[test]
    fn quotes_bare_keys() {
        assert_eq!(quote_bare_keys(r#"{name:"test"}"#), r#"{"name":"test"}"#);
        assert_eq!(
            quote_bare_keys(r#"{ name : "test", age: 5 }"#),
            r#"{ "name" : "test", "age": 5 }"#
        );
        // Already-quoted keys and string contents (incl. a colon inside a
        // string) are left untouched.
        assert_eq!(
            quote_bare_keys(r#"{"a": "b:c", $or: [{x:1}]}"#),
            r#"{"a": "b:c", "$or": [{"x":1}]}"#
        );
        // No trailing `:` — not a key position, must not be quoted.
        assert_eq!(quote_bare_keys("true"), "true");
    }
}
