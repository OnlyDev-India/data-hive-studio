use super::{TranslateError, err};

// ---- Tokenizer -------------------------------------------------------
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Tok {
    Ident(String),
    Str(String),
    Num(String),
    /// `,` `(` `)` `*` `;` `.`
    Punct(char),
    Op(String),
    Eof,
}

pub(super) struct Lexer<'a> {
    pub(super) chars: std::iter::Peekable<std::str::CharIndices<'a>>,
    src: &'a str,
}

impl<'a> Lexer<'a> {
    pub(super) fn new(src: &'a str) -> Self {
        Self { chars: src.char_indices().peekable(), src }
    }

    pub(super) fn tokenize(mut self) -> Result<Vec<Tok>, TranslateError> {
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
