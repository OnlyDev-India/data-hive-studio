//! The read only guard's statement splitter: splits a script on top level
//! terminators, skipping quotes and comments per dialect, and masks each
//! statement so a keyword in a string or comment never counts.

use super::Dialect;

/// One statement of a script.
pub(in crate::db) struct Statement {
    /// The statement as written, trimmed (for messages only).
    pub(in crate::db) raw: String,
    /// The statement with comments turned into a space, string literals
    /// (single quoted, dollar quoted) emptied to `''`, and quoted identifiers
    /// kept but fenced with `\x01` so they can never read as a keyword.
    pub(in crate::db) masked: String,
}

const UNREADABLE: &str = "this script could not be read to check that it only reads";

fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'$' || b >= 0x80
}

/// Index just past the closing `q` of the quoted run that opens at `open`.
/// A doubled `q` is an escaped quote; with `backslash`, `\x` skips a byte.
/// `None` when the run never closes.
fn skip_quoted(b: &[u8], open: usize, q: u8, backslash: bool) -> Option<usize> {
    let mut i = open + 1;
    while i < b.len() {
        if backslash && b[i] == b'\\' {
            i += 2;
            continue;
        }
        if b[i] == q {
            if b.get(i + 1) == Some(&q) {
                i += 2;
                continue;
            }
            return Some(i + 1);
        }
        i += 1;
    }
    None
}

/// `E'...'` (Postgres escape string): the quote at `i` follows a lone `E`.
fn is_escape_string(b: &[u8], i: usize) -> bool {
    i >= 1 && matches!(b[i - 1], b'E' | b'e') && (i < 2 || !is_ident_byte(b[i - 2]))
}

/// The dollar quote tag (`$$` or `$tag$`) that opens at `i`, if one does.
/// `$1` is a parameter and `a$b` is an identifier, neither is a quote.
fn dollar_tag(b: &[u8], i: usize) -> Option<&[u8]> {
    if i > 0 && is_ident_byte(b[i - 1]) {
        return None;
    }
    let mut j = i + 1;
    if b.get(j) != Some(&b'$') {
        let first = *b.get(j)?;
        if !(first.is_ascii_alphabetic() || first == b'_' || first >= 0x80) {
            return None;
        }
        while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_' || b[j] >= 0x80) {
            j += 1;
        }
        if b.get(j) != Some(&b'$') {
            return None;
        }
    }
    Some(&b[i..=j])
}

/// Whether only spaces or tabs sit between the last newline and `i`.
fn at_line_start(b: &[u8], i: usize) -> bool {
    b[..i].iter().rev().take_while(|&&c| c != b'\n').all(|&c| c == b' ' || c == b'\t' || c == b'\r')
}

/// A `DELIMITER xx` line starting at `i`: the index after the line and the
/// new terminator.
fn delimiter_line(b: &[u8], i: usize) -> Option<(usize, Vec<u8>)> {
    const WORD: &[u8] = b"delimiter";
    let head = b.get(i..i + WORD.len())?;
    if !head.eq_ignore_ascii_case(WORD) || !b.get(i + WORD.len()).is_some_and(|c| *c == b' ' || *c == b'\t') {
        return None;
    }
    let end = b[i..].iter().position(|&c| c == b'\n').map_or(b.len(), |p| i + p);
    let token: Vec<u8> = b[i + WORD.len()..end]
        .iter()
        .copied()
        .skip_while(|c| c.is_ascii_whitespace())
        .take_while(|c| !c.is_ascii_whitespace())
        .collect();
    if token.is_empty() {
        return None;
    }
    Some(((end + 1).min(b.len()), token))
}

fn find_subslice(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// How many statements `sql` holds, by the same splitter the check uses.
pub(crate) fn statement_count(dialect: Dialect, sql: &str) -> Result<usize, &'static str> {
    split_statements(dialect, sql).map(|s| s.len())
}

/// Split `sql` into statements on top level `;`, skipping quotes and
/// comments, and build each one's masked text. Empty statements (a stray `;`,
/// a comment) are dropped. `Err` when a quote or comment never closes.
pub(in crate::db) fn split_statements(dialect: Dialect, sql: &str) -> Result<Vec<Statement>, &'static str> {
    let b = sql.as_bytes();
    let mut out = Vec::new();
    let mut masked: Vec<u8> = Vec::new();
    let mut start = 0;
    let mut i = 0;

    // MySQL scripts may change the terminator with a `DELIMITER xx` line.
    let mut terminator: Vec<u8> = b";".to_vec();

    let mut finish = |start: usize, end: usize, masked: &mut Vec<u8>| {
        let text = String::from_utf8_lossy(masked).into_owned();
        if !text.trim().is_empty() {
            out.push(Statement { raw: sql[start..end].trim().to_string(), masked: text });
        }
        masked.clear();
    };

    while i < b.len() {
        if dialect == Dialect::Mysql && at_line_start(b, i) {
            if let Some((next, new_terminator)) = delimiter_line(b, i) {
                // Whatever came before the line ends there; the line itself
                // is never part of a statement.
                finish(start, i, &mut masked);
                terminator = new_terminator;
                i = next;
                start = i;
                continue;
            }
        }
        if b[i..].starts_with(&terminator) && (terminator != b";" || b[i] == b';') {
            finish(start, i, &mut masked);
            i += terminator.len();
            start = i;
            continue;
        }
        match b[i] {
            b';' if terminator == b";" => {
                finish(start, i, &mut masked);
                i += 1;
                start = i;
            }
            q @ (b'\'' | b'"') if dialect == Dialect::Mysql => {
                // Both quotes delimit strings on MySQL, with backslash escapes.
                i = skip_quoted(b, i, q, true).ok_or(UNREADABLE)?;
                masked.extend_from_slice(b"''");
            }
            b'\'' => {
                let backslash = dialect == Dialect::Postgres && is_escape_string(b, i);
                i = skip_quoted(b, i, b'\'', backslash).ok_or(UNREADABLE)?;
                masked.extend_from_slice(b"''");
            }
            b'#' if dialect == Dialect::Mysql => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
                masked.push(b' ');
            }
            // MySQL needs whitespace after `--` for a comment; `a--1` is
            // arithmetic.
            b'-' if dialect == Dialect::Mysql
                && b.get(i + 1) == Some(&b'-')
                && !b.get(i + 2).is_some_and(|c| !c.is_ascii_whitespace()) =>
            {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
                masked.push(b' ');
            }
            b'/' if dialect == Dialect::Mysql && b.get(i + 1) == Some(&b'*') => {
                let close = find_subslice(&b[i + 2..], b"*/").ok_or(UNREADABLE)?;
                let body = &b[i + 2..i + 2 + close];
                // `/*! ... */` and `/*M! ... */` run as code on the server.
                let code = body.strip_prefix(b"!").or_else(|| body.strip_prefix(b"M!"));
                match code {
                    Some(code) => {
                        let digits = code.iter().take_while(|c| c.is_ascii_digit()).count();
                        masked.push(b' ');
                        masked.extend_from_slice(&code[digits..]);
                        masked.push(b' ');
                    }
                    None => masked.push(b' '),
                }
                i += close + 4;
            }
            q @ (b'"' | b'`') if q == b'"' || dialect != Dialect::Postgres => {
                let end = skip_quoted(b, i, q, false).ok_or(UNREADABLE)?;
                masked.push(1);
                masked.extend_from_slice(&b[i + 1..end - 1]);
                masked.push(1);
                i = end;
            }
            b'[' if dialect == Dialect::Sqlite => {
                let close = b[i..].iter().position(|&c| c == b']').ok_or(UNREADABLE)?;
                masked.push(1);
                masked.extend_from_slice(&b[i + 1..i + close]);
                masked.push(1);
                i += close + 1;
            }
            b'-' if dialect != Dialect::Mysql && b.get(i + 1) == Some(&b'-') => {
                while i < b.len() && b[i] != b'\n' {
                    i += 1;
                }
                masked.push(b' ');
            }
            b'/' if b.get(i + 1) == Some(&b'*') => {
                // Postgres nests block comments, SQLite does not.
                let nests = dialect == Dialect::Postgres;
                let mut depth = 1;
                i += 2;
                while i < b.len() && depth > 0 {
                    if nests && b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
                        depth += 1;
                        i += 2;
                    } else if b[i] == b'*' && b.get(i + 1) == Some(&b'/') {
                        depth -= 1;
                        i += 2;
                    } else {
                        i += 1;
                    }
                }
                if depth > 0 {
                    return Err(UNREADABLE);
                }
                masked.push(b' ');
            }
            b'$' if dialect == Dialect::Postgres => match dollar_tag(b, i) {
                Some(tag) => {
                    let body = i + tag.len();
                    let close = find_subslice(&b[body..], tag).ok_or(UNREADABLE)?;
                    i = body + close + tag.len();
                    masked.extend_from_slice(b"''");
                }
                None => {
                    masked.push(b'$');
                    i += 1;
                }
            },
            c => {
                masked.push(c);
                i += 1;
            }
        }
    }
    finish(start, b.len(), &mut masked);
    Ok(out)
}
