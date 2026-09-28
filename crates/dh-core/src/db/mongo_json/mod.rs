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

mod values;
mod constructors;
mod render;
#[cfg(test)]
mod tests;

pub use render::render;

use bson::{Bson, Document};

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
    pub(super) fn peek(&self) -> Option<u8> {
        self.s.get(self.i).copied()
    }

    pub(super) fn err(&self, msg: &str) -> ParseError {
        ParseError(format!("{msg} at byte {}", self.i))
    }

    pub(super) fn skip_ws(&mut self) {
        while let Some(c) = self.peek() {
            if c == b' ' || c == b'\t' || c == b'\n' || c == b'\r' {
                self.i += 1;
            } else {
                break;
            }
        }
    }

    pub(super) fn expect(&mut self, c: u8, what: &str) -> Result<(), ParseError> {
        self.skip_ws();
        if self.peek() == Some(c) {
            self.i += 1;
            Ok(())
        } else {
            Err(self.err(&format!("expected {what}")))
        }
    }

    /// Read a bare identifier (constructor name).
    pub(super) fn parse_ident(&mut self) -> Result<String, ParseError> {
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

    pub(super) fn expect_word(&mut self, w: &str) -> Result<(), ParseError> {
        if self.s[self.i..].starts_with(w.as_bytes()) {
            self.i += w.len();
            Ok(())
        } else {
            Err(self.err(&format!("expected `{w}`")))
        }
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
