//! The read only guard (spec 0007): one small value every adapter holds and
//! calls before it writes. Both the desktop app and the team server gateway
//! call the adapters directly, so a single guard here covers both.
//!
//! The guard is fixed when the adapter is built. Changing a connection's
//! read only flag means a new adapter (save, then Reconnect).
//!
//! It is a guardrail against slips made through this app, not a security
//! boundary: anyone holding the database password can use another tool. The
//! check here fails closed (not on the allowlist means refused), and on SQL
//! databases the database's own read only lock sits underneath it. Each
//! covers the other's blind spot: the check refuses the statements that could
//! switch the lock off, and the lock refuses the writes the check cannot see
//! (a data changing CTE, a writing function).

use super::{DbError, DbResult};
use crate::api::QueryOp;

/// Every refusal's text starts with this, so the frontend (which has the same
/// constant and an `isReadOnlyError` helper) can tell a refusal from any other
/// failure. The adapter never names the connection or says where to turn the
/// flag off: the frontend adds that hint.
pub const READ_ONLY_PREFIX: &str = "Read only connection:";

/// First keywords of a statement that only reads.
const READ_KEYWORDS: &[&str] = &["select", "with", "values", "table", "show", "explain"];

/// What `EXPLAIN ANALYZE` may run: it executes the statement it explains, so
/// only a statement that reads is allowed there.
const EXPLAINABLE_READS: &[&str] = &["select", "with", "values", "table"];

/// SQLite PRAGMAs that only read. Never with `=`. `user_version` is separate:
/// it reads only when bare, since `PRAGMA user_version(5)` sets it.
const READ_PRAGMAS: &[&str] = &[
    "table_info",
    "table_xinfo",
    "table_list",
    "index_list",
    "index_info",
    "index_xinfo",
    "foreign_key_list",
    "database_list",
    "compile_options",
    "collation_list",
    "function_list",
];

/// Functions that could switch the lock off from inside an allowed statement
/// (`SELECT set_config('default_transaction_read_only', 'off', false)`).
const LOCK_BREAKERS: &[&str] = &["set_config", "load_extension"];

/// The SQL dialect the text is read as: quoting and comment rules differ.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    Postgres,
    Sqlite,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ReadOnlyGuard {
    on: bool,
}

impl ReadOnlyGuard {
    pub fn new(read_only: bool) -> Self {
        Self { on: read_only }
    }

    pub fn is_on(self) -> bool {
        self.on
    }

    /// Refuse a structured write (grid edit, drop, schema change, ...).
    /// `what` is a fixed name passed by each call site, e.g. `"drop table"`.
    pub fn check_write(self, what: &str) -> DbResult<()> {
        if self.on {
            return Err(refused(&format!("{what} is not allowed")));
        }
        Ok(())
    }

    /// Refuse a structured op unless it only reads (select, count, distinct
    /// values). The one list is [`QueryOp::is_read`], shared with the gateway.
    pub fn check_op(self, op: &QueryOp) -> DbResult<()> {
        if op.is_read() {
            return Ok(());
        }
        self.check_write(op.write_name())
    }

    /// Refuse hand written SQL unless every statement in it is on the read
    /// allowlist. The script is split into statements first and refused as a
    /// whole, naming the first bad one, so nothing runs partly. Text that
    /// cannot be read (an unclosed quote or comment) counts as refused.
    pub fn check_sql(self, dialect: Dialect, sql: &str) -> DbResult<()> {
        if !self.on {
            return Ok(());
        }
        let statements = split_statements(dialect, sql).map_err(refused)?;
        let total = statements.len();
        for (n, stmt) in statements.iter().enumerate() {
            if let Err(what) = judge(dialect, &stmt.masked) {
                return Err(refused(&match total {
                    1 => what,
                    _ => format!("{what} (statement {} of {total}: \"{}\")", n + 1, snippet(&stmt.raw)),
                }));
            }
        }
        Ok(())
    }

    /// [`engine_refusal`](Self::engine_refusal) applied to a finished result:
    /// an engine error that is the database's own read only refusal becomes
    /// the typed error, anything else passes through untouched.
    pub fn refine(self, err: DbError) -> DbError {
        match err {
            DbError::SqlEngine(e) => self.engine_refusal(&e).unwrap_or(DbError::SqlEngine(e)),
            other => other,
        }
    }

    /// When the database's own read only lock refused a write the check let
    /// through (a data changing CTE, a writing function), say so with the
    /// typed refusal instead of the raw engine text. `None` means the
    /// failure is something else, or the guard is off.
    pub fn engine_refusal(self, err: &sqlx::Error) -> Option<DbError> {
        if !self.on {
            return None;
        }
        let sqlx::Error::Database(db) = err else {
            return None;
        };
        // Postgres 25006 read_only_sql_transaction; SQLite SQLITE_READONLY is
        // code 8, and its extended codes all say "readonly database".
        let code = db.code();
        let code = code.as_deref().unwrap_or("");
        let text = db.message().to_ascii_lowercase();
        if code == "25006"
            || code == "8"
            || text.contains("read-only transaction")
            || text.contains("readonly database")
        {
            return Some(refused("the database refused this write"));
        }
        None
    }
}

pub(crate) fn refused(what: impl AsRef<str>) -> DbError {
    DbError::ReadOnly(format!("{READ_ONLY_PREFIX} {}.", what.as_ref()))
}

/// A short, single line view of a statement for a refusal message.
fn snippet(raw: &str) -> String {
    let one_line = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = one_line.chars();
    let head: String = chars.by_ref().take(60).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
}

/// One statement of a script.
struct Statement {
    /// The statement as written, trimmed (for messages only).
    raw: String,
    /// The statement with comments turned into a space, string literals
    /// (single quoted, dollar quoted) emptied to `''`, and quoted identifiers
    /// kept but fenced with `\x01` so they can never read as a keyword.
    masked: String,
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

fn find_subslice(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Split `sql` into statements on top level `;`, skipping quotes and
/// comments, and build each one's masked text. Empty statements (a stray `;`,
/// a comment) are dropped. `Err` when a quote or comment never closes.
fn split_statements(dialect: Dialect, sql: &str) -> Result<Vec<Statement>, &'static str> {
    let b = sql.as_bytes();
    let mut out = Vec::new();
    let mut masked: Vec<u8> = Vec::new();
    let mut start = 0;
    let mut i = 0;

    let mut finish = |start: usize, end: usize, masked: &mut Vec<u8>| {
        let text = String::from_utf8_lossy(masked).into_owned();
        if !text.trim().is_empty() {
            out.push(Statement { raw: sql[start..end].trim().to_string(), masked: text });
        }
        masked.clear();
    };

    while i < b.len() {
        match b[i] {
            b';' => {
                finish(start, i, &mut masked);
                i += 1;
                start = i;
            }
            b'\'' => {
                let backslash = dialect == Dialect::Postgres && is_escape_string(b, i);
                i = skip_quoted(b, i, b'\'', backslash).ok_or(UNREADABLE)?;
                masked.extend_from_slice(b"''");
            }
            q @ (b'"' | b'`') if q == b'"' || dialect == Dialect::Sqlite => {
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
            b'-' if b.get(i + 1) == Some(&b'-') => {
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

/// The first thing in masked text.
enum Head<'a> {
    /// Nothing but whitespace.
    Empty,
    /// The first keyword, lowercased, and the text after it.
    Word(String, &'a str),
    /// Something that is not a keyword.
    Other,
}

/// Skips whitespace and opening parentheses (`(SELECT 1) UNION ...`).
fn head(masked: &str) -> Head<'_> {
    let b = masked.as_bytes();
    let mut i = 0;
    while i < b.len() && (b[i].is_ascii_whitespace() || b[i] == b'(') {
        i += 1;
    }
    if i == b.len() {
        return Head::Empty;
    }
    if !b[i].is_ascii_alphabetic() {
        return Head::Other;
    }
    let start = i;
    while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') {
        i += 1;
    }
    Head::Word(masked[start..i].to_ascii_lowercase(), &masked[i..])
}

/// Identifier like words in masked text, lowercased. Quoted identifiers
/// count (`"set_config"(...)` calls the function), string literals do not.
fn tokens(masked: &str) -> impl Iterator<Item = String> + '_ {
    masked
        .split(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$'))
        .filter(|t| !t.is_empty())
        .map(str::to_ascii_lowercase)
}

/// Judge one statement. `Err` carries the reason, without the prefix.
fn judge(dialect: Dialect, masked: &str) -> Result<(), String> {
    let (word, rest) = match head(masked) {
        Head::Empty => return Ok(()),
        Head::Other => return Err("this statement could not be recognised as a read".into()),
        Head::Word(word, rest) => (word, rest),
    };
    match word.as_str() {
        "explain" => judge_explain(rest)?,
        "pragma" if dialect == Dialect::Sqlite => judge_pragma(rest)?,
        w if READ_KEYWORDS.contains(&w) => {}
        w => return Err(format!("{} statements are not allowed", w.to_ascii_uppercase())),
    }
    if let Some(name) = tokens(masked).find(|t| LOCK_BREAKERS.contains(&t.as_str())) {
        return Err(format!("{name}() is not allowed"));
    }
    Ok(())
}

/// `EXPLAIN` alone never runs the statement, so it may explain anything. With
/// `ANALYZE` it runs it, so the explained statement must itself read.
fn judge_explain(rest: &str) -> Result<(), String> {
    let mut rest = rest.trim_start();
    let mut analyze = false;
    if rest.starts_with('(') {
        // `EXPLAIN (ANALYZE, VERBOSE) ...`: the options are a parenthesised list.
        let mut depth = 0;
        let close = rest.char_indices().find_map(|(i, c)| {
            match c {
                '(' => depth += 1,
                ')' => depth -= 1,
                _ => {}
            }
            (depth == 0).then_some(i)
        });
        let Some(close) = close else {
            return Err("this EXPLAIN could not be recognised as a read".into());
        };
        analyze = tokens(&rest[..=close]).any(|t| t == "analyze" || t == "analyse");
        rest = &rest[close + 1..];
    } else {
        // `EXPLAIN ANALYZE VERBOSE ...`: bare option words before the statement.
        loop {
            match head(rest) {
                Head::Word(w, after) if matches!(w.as_str(), "analyze" | "analyse" | "verbose") => {
                    analyze |= w != "verbose";
                    rest = after;
                }
                _ => break,
            }
        }
    }
    if !analyze {
        return Ok(());
    }
    match head(rest) {
        Head::Word(w, _) if EXPLAINABLE_READS.contains(&w.as_str()) => Ok(()),
        Head::Word(w, _) => Err(format!("EXPLAIN ANALYZE of a {} statement is not allowed", w.to_ascii_uppercase())),
        _ => Err("this EXPLAIN ANALYZE could not be recognised as a read".into()),
    }
}

/// SQLite `PRAGMA name`, `PRAGMA schema.name`, `PRAGMA name(arg)`: only the
/// read list, and never with `=`.
fn judge_pragma(rest: &str) -> Result<(), String> {
    if rest.contains('=') {
        return Err("a PRAGMA that sets a value is not allowed".into());
    }
    let rest = rest.trim_start();
    let word_end = |s: &str| s.find(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).unwrap_or(s.len());
    let mut name = &rest[..word_end(rest)];
    let mut after = &rest[name.len()..];
    // `main.table_info(...)`: skip the schema name.
    if let Some(dotted) = after.trim_start().strip_prefix('.') {
        let dotted = dotted.trim_start();
        name = &dotted[..word_end(dotted)];
        after = &dotted[name.len()..];
    }
    let name = name.to_ascii_lowercase();
    let after = after.trim();
    let ok = if name == "user_version" {
        after.is_empty()
    } else {
        READ_PRAGMAS.contains(&name.as_str()) && (after.is_empty() || after.starts_with('('))
    };
    if ok {
        Ok(())
    } else {
        Err(format!("PRAGMA {name} is not allowed"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PG: Dialect = Dialect::Postgres;
    const LITE: Dialect = Dialect::Sqlite;

    fn on() -> ReadOnlyGuard {
        ReadOnlyGuard::new(true)
    }

    fn refusal(res: DbResult<()>) -> String {
        match res {
            Err(DbError::ReadOnly(msg)) => msg,
            other => panic!("expected a read only refusal, got {other:?}"),
        }
    }

    fn allowed(dialect: Dialect, sqls: &[&str]) {
        for sql in sqls {
            assert!(on().check_sql(dialect, sql).is_ok(), "should allow: {sql}");
        }
    }

    fn refused_all(dialect: Dialect, sqls: &[&str]) {
        for sql in sqls {
            let msg = refusal(on().check_sql(dialect, sql));
            assert!(msg.starts_with(READ_ONLY_PREFIX), "{msg}");
        }
    }

    #[test]
    fn off_guard_allows_everything() {
        let g = ReadOnlyGuard::new(false);
        assert!(g.check_write("drop table").is_ok());
        assert!(g.check_sql(PG, "DROP TABLE t").is_ok());
        assert!(g.check_sql(LITE, "PRAGMA query_only = OFF").is_ok());
        assert!(!g.is_on());
    }

    #[test]
    fn default_guard_is_off() {
        assert!(!ReadOnlyGuard::default().is_on());
    }

    #[test]
    fn reads_pass() {
        for dialect in [PG, LITE] {
            allowed(
                dialect,
                &[
                    "SELECT 1",
                    "  select * from t",
                    "WITH x AS (SELECT 1) SELECT * FROM x",
                    "VALUES (1), (2)",
                    "EXPLAIN SELECT 1",
                    "(SELECT 1) UNION (SELECT 2)",
                    "-- note\nSELECT 1",
                    "/* a note */ SELECT 1",
                    "\n\t SELECT\n1",
                    "SELECT 1;",
                    "SELECT 1; SELECT 2",
                    "SELECT 1;;  ; SELECT 2 ;",
                    "SELECT 'a;b', \"c;d\" FROM t",
                    "SELECT 1 -- ; DROP TABLE t",
                ],
            );
        }
        allowed(PG, &["TABLE t", "SHOW search_path", "/* a /* nested */ note */ SELECT 1"]);
    }

    #[test]
    fn empty_and_comment_only_text_has_nothing_to_refuse() {
        for sql in ["", "   ", "-- only a comment", "/* only a comment */", ";", " ; ; "] {
            allowed(PG, &[sql]);
            allowed(LITE, &[sql]);
        }
    }

    #[test]
    fn writes_are_refused_with_the_prefix_and_the_keyword() {
        for (sql, word) in [
            ("UPDATE t SET a = 1", "UPDATE"),
            ("insert into t values (1)", "INSERT"),
            ("Delete from t", "DELETE"),
            ("DROP TABLE t", "DROP"),
            ("TRUNCATE t", "TRUNCATE"),
            ("CREATE TABLE t (a int)", "CREATE"),
            ("CREATE TEMP TABLE t (a int)", "CREATE"),
            ("ALTER TABLE t ADD COLUMN b int", "ALTER"),
            ("GRANT ALL ON t TO u", "GRANT"),
            ("COPY t FROM STDIN", "COPY"),
            ("CALL p()", "CALL"),
            ("DO $$ BEGIN END $$", "DO"),
            ("VACUUM", "VACUUM"),
            ("REINDEX TABLE t", "REINDEX"),
            ("REFRESH MATERIALIZED VIEW m", "REFRESH"),
            ("LOCK TABLE t", "LOCK"),
            ("SET default_transaction_read_only = off", "SET"),
            ("RESET default_transaction_read_only", "RESET"),
            ("RESET ALL", "RESET"),
            ("DISCARD ALL", "DISCARD"),
            ("BEGIN READ WRITE", "BEGIN"),
            ("START TRANSACTION READ WRITE", "START"),
            ("COMMIT", "COMMIT"),
            ("ROLLBACK", "ROLLBACK"),
            ("SAVEPOINT s", "SAVEPOINT"),
            ("SET TRANSACTION READ WRITE", "SET"),
            ("ATTACH DATABASE 'x.db' AS x", "ATTACH"),
            ("DETACH x", "DETACH"),
            ("REPLACE INTO t VALUES (1)", "REPLACE"),
            ("-- sneaky\nUPDATE t SET a = 1", "UPDATE"),
            ("/* sneaky */ DROP TABLE t", "DROP"),
            ("(DELETE FROM t)", "DELETE"),
        ] {
            for dialect in [PG, LITE] {
                let msg = refusal(on().check_sql(dialect, sql));
                assert!(msg.starts_with(READ_ONLY_PREFIX), "{msg}");
                assert!(msg.contains(word), "{msg} should name {word}");
            }
        }
    }

    #[test]
    fn unrecognised_text_fails_closed() {
        for dialect in [PG, LITE] {
            refused_all(
                dialect,
                &[
                    "'; DROP TABLE t",
                    "\\copy t from x",
                    "/* never closes SELECT 1",
                    "1 + 1",
                    "\"DROP\" TABLE t",
                    "SELECT 'never closes",
                    "SELECT \"never closes",
                ],
            );
        }
        refused_all(PG, &["SELECT $$never closes", "SELECT $tag$ body $other$"]);
        refused_all(LITE, &["SELECT [never closes", "SELECT `never closes"]);
    }

    #[test]
    fn refusal_never_says_where_to_turn_it_off() {
        let msg = refusal(on().check_sql(PG, "DELETE FROM t"));
        assert!(!msg.to_lowercase().contains("settings"));
        assert!(!msg.to_lowercase().contains("admin"));
    }

    #[test]
    fn structured_writes_are_refused_by_name() {
        let msg = refusal(on().check_write("drop table"));
        assert_eq!(msg, "Read only connection: drop table is not allowed.");
    }

    // ---- whole script refusal -------------------------------------------

    #[test]
    fn a_script_with_any_refused_statement_is_refused_whole() {
        let msg = refusal(on().check_sql(PG, "SELECT 1; DROP TABLE t; SELECT 2"));
        assert!(msg.contains("DROP statements are not allowed"), "{msg}");
        assert!(msg.contains("statement 2 of 3"), "{msg}");
        assert!(msg.contains("DROP TABLE t"), "{msg}");
        refused_all(LITE, &["SELECT 1; DROP TABLE t", "UPDATE t SET a = 1; SELECT 1"]);
    }

    #[test]
    fn a_single_statement_refusal_carries_no_position() {
        let msg = refusal(on().check_sql(PG, "DROP TABLE t"));
        assert_eq!(msg, "Read only connection: DROP statements are not allowed.");
    }

    #[test]
    fn a_long_refused_statement_is_shortened_in_the_message() {
        let sql = format!("SELECT 1; DELETE FROM t WHERE {}", "a = 1 AND ".repeat(30) + "b = 2");
        let msg = refusal(on().check_sql(PG, &sql));
        assert!(msg.contains('…'), "{msg}");
        assert!(msg.len() < 200, "{msg}");
    }

    // ---- the splitter: quotes and comments hide nothing --------------------

    #[test]
    fn semicolons_inside_quotes_and_comments_do_not_split() {
        allowed(
            PG,
            &[
                "SELECT ';'",
                "SELECT 'it''s; fine'",
                "SELECT \"a;b\"",
                "SELECT \"a\"\"; b\"",
                "SELECT $$a;b$$",
                "SELECT $tag$a;$$b$tag$",
                "SELECT E'a\\';b'",
                "SELECT 1 /* ; DROP TABLE t */",
                "SELECT 1 /* a /* ; nested */ ; still comment */",
                "SELECT 1 -- ; DROP TABLE t\n, 2",
            ],
        );
        allowed(
            LITE,
            &[
                "SELECT ';'",
                "SELECT `a;b`",
                "SELECT [a;b] FROM t",
                "SELECT 'it''s; fine'",
                "SELECT 1 /* ; DROP TABLE t */",
            ],
        );
    }

    #[test]
    fn a_statement_hidden_after_a_real_semicolon_is_seen() {
        refused_all(
            PG,
            &[
                "SELECT 'a'; DROP TABLE t",
                "SELECT $$a$$; DROP TABLE t",
                "SELECT E'\\\\'; DROP TABLE t",
                "SELECT 1 /* c */; DROP TABLE t",
                "SELECT 1 -- c\n; DROP TABLE t",
                "SELECT 1;\nDROP TABLE t",
            ],
        );
        refused_all(
            LITE,
            &["SELECT 'a'; DROP TABLE t", "SELECT [a]; DROP TABLE t", "SELECT `a`; DROP TABLE t"],
        );
    }

    #[test]
    fn dialect_quoting_differences_do_not_open_a_gap() {
        // Standard strings have no backslash escape: `'\'` is a whole string,
        // so the DROP after it is a real statement.
        refused_all(PG, &["SELECT '\\'; DROP TABLE t; --'"]);
        refused_all(LITE, &["SELECT '\\'; DROP TABLE t; --'"]);
        // SQLite block comments do not nest: the first `*/` ends the comment.
        refused_all(LITE, &["SELECT 1 /* a /* b */; DROP TABLE t; /* c */"]);
        // A dollar sign is not a quote in SQLite, nor when it follows a word
        // or starts a parameter in Postgres.
        refused_all(LITE, &["SELECT $$; DROP TABLE t; --$$"]);
        allowed(PG, &["SELECT a$b, $1 FROM t WHERE x = $2"]);
    }

    #[test]
    fn escape_string_needs_a_lone_e() {
        // `VALUE'...'` is not an escape string: the backslash does not escape.
        refused_all(PG, &["SELECT some_e'\\'; DROP TABLE t; --'"]);
    }

    // ---- bypass attempts: Postgres -----------------------------------------

    #[test]
    fn postgres_lock_breakers_are_refused() {
        refused_all(
            PG,
            &[
                "SET default_transaction_read_only = off",
                "SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE",
                "RESET default_transaction_read_only",
                "BEGIN READ WRITE",
                "BEGIN; SELECT 1",
                "SELECT 1; COMMIT",
                "DISCARD ALL",
                "SELECT set_config('default_transaction_read_only', 'off', false)",
                "SELECT pg_catalog.set_config('default_transaction_read_only', 'off', false)",
                "SELECT \"set_config\"('default_transaction_read_only', 'off', false)",
                "SELECT SET_CONFIG('default_transaction_read_only', 'off', false)",
                "WITH x AS (SELECT set_config('a', 'b', false)) SELECT * FROM x",
                "EXPLAIN SELECT set_config('a', 'b', false)",
                "SELECT 1 /* c */, set_config('a', 'b', false)",
            ],
        );
        let msg = refusal(on().check_sql(PG, "SELECT set_config('a', 'b', false)"));
        assert!(msg.contains("set_config"), "{msg}");
    }

    #[test]
    fn a_lock_breaker_name_inside_a_string_or_comment_is_fine() {
        allowed(
            PG,
            &[
                "SELECT 'set_config'",
                "SELECT 1 -- set_config",
                "SELECT 1 /* set_config */",
                "SELECT $$set_config$$",
                "SELECT my_set_config_view FROM t",
            ],
        );
    }

    #[test]
    fn a_data_changing_cte_is_left_to_the_database_lock() {
        // On purpose (spec 0007): it starts with an allowed keyword. The
        // Postgres session is read only, which refuses it.
        allowed(PG, &["WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d"]);
        allowed(LITE, &["WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x"]);
    }

    // ---- EXPLAIN ------------------------------------------------------------

    #[test]
    fn plain_explain_may_explain_anything() {
        allowed(
            PG,
            &[
                "EXPLAIN DELETE FROM t",
                "EXPLAIN VERBOSE UPDATE t SET a = 1",
                "EXPLAIN (COSTS OFF) INSERT INTO t VALUES (1)",
                "EXPLAIN (VERBOSE, FORMAT JSON) SELECT 1",
            ],
        );
        allowed(LITE, &["EXPLAIN QUERY PLAN DELETE FROM t", "EXPLAIN UPDATE t SET a = 1"]);
    }

    #[test]
    fn explain_analyze_needs_a_statement_that_reads() {
        allowed(
            PG,
            &[
                "EXPLAIN ANALYZE SELECT 1",
                "EXPLAIN ANALYSE SELECT 1",
                "EXPLAIN ANALYZE VERBOSE SELECT 1",
                "EXPLAIN (ANALYZE) SELECT 1",
                "EXPLAIN (ANALYZE, BUFFERS) WITH x AS (SELECT 1) SELECT * FROM x",
                "explain (analyze true) values (1)",
            ],
        );
        refused_all(
            PG,
            &[
                "EXPLAIN ANALYZE DELETE FROM t",
                "EXPLAIN ANALYZE VERBOSE UPDATE t SET a = 1",
                "EXPLAIN (ANALYZE) INSERT INTO t VALUES (1)",
                "EXPLAIN (ANALYZE, VERBOSE) DELETE FROM t",
                "explain ( analyze true ) delete from t",
                "EXPLAIN ANALYZE EXECUTE p",
                "EXPLAIN ANALYZE",
                "EXPLAIN (ANALYZE SELECT 1",
            ],
        );
    }

    // ---- bypass attempts: SQLite ---------------------------------------------

    #[test]
    fn read_pragmas_pass() {
        allowed(
            LITE,
            &[
                "PRAGMA table_info(t)",
                "PRAGMA table_info('t')",
                "pragma Table_XInfo(t)",
                "PRAGMA table_list",
                "PRAGMA main.table_info(t)",
                "PRAGMA index_list(t)",
                "PRAGMA index_info(i)",
                "PRAGMA index_xinfo(i)",
                "PRAGMA foreign_key_list(t)",
                "PRAGMA database_list",
                "PRAGMA compile_options",
                "PRAGMA collation_list",
                "PRAGMA function_list",
                "PRAGMA user_version",
                "PRAGMA main.user_version",
                "PRAGMA table_info(t);",
            ],
        );
    }

    #[test]
    fn write_pragmas_are_refused() {
        refused_all(
            LITE,
            &[
                "PRAGMA query_only = OFF",
                "PRAGMA query_only=0",
                "PRAGMA query_only(0)",
                "PRAGMA writable_schema = ON",
                "PRAGMA journal_mode = DELETE",
                "PRAGMA journal_mode",
                "PRAGMA foreign_keys = OFF",
                "PRAGMA user_version = 5",
                "PRAGMA user_version(5)",
                "PRAGMA table_info(t) = 1",
                "PRAGMA main.query_only = 0",
                "PRAGMA wal_checkpoint(TRUNCATE)",
                "PRAGMA \"query_only\" = 0",
                "PRAGMA",
            ],
        );
    }

    #[test]
    fn postgres_has_no_pragma() {
        refused_all(PG, &["PRAGMA table_info(t)"]);
    }

    #[test]
    fn sqlite_lock_breakers_are_refused() {
        refused_all(
            LITE,
            &[
                "ATTACH DATABASE 'x.db' AS x",
                "ATTACH 'x.db' AS x; SELECT 1",
                "DETACH DATABASE x",
                "SELECT load_extension('x')",
                "SELECT LOAD_EXTENSION('x', 'entry')",
                "SELECT \"load_extension\"('x')",
                "SELECT `load_extension`('x')",
                "SELECT [load_extension]('x')",
                "PRAGMA query_only = OFF",
                "VACUUM INTO 'copy.db'",
                "BEGIN IMMEDIATE",
            ],
        );
    }

    // ---- the database lock's own refusals become the typed error ----------

    #[derive(Debug)]
    struct EngineError {
        code: &'static str,
        message: &'static str,
    }

    impl std::fmt::Display for EngineError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str(self.message)
        }
    }

    impl std::error::Error for EngineError {}

    impl sqlx::error::DatabaseError for EngineError {
        fn message(&self) -> &str {
            self.message
        }
        fn code(&self) -> Option<std::borrow::Cow<'_, str>> {
            Some(self.code.into())
        }
        fn as_error(&self) -> &(dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn as_error_mut(&mut self) -> &mut (dyn std::error::Error + Send + Sync + 'static) {
            self
        }
        fn into_error(self: Box<Self>) -> Box<dyn std::error::Error + Send + Sync + 'static> {
            self
        }
        fn kind(&self) -> sqlx::error::ErrorKind {
            sqlx::error::ErrorKind::Other
        }
    }

    fn engine(code: &'static str, message: &'static str) -> sqlx::Error {
        sqlx::Error::Database(Box::new(EngineError { code, message }))
    }

    #[test]
    fn the_database_lock_refusal_becomes_the_typed_error() {
        for err in [
            engine("25006", "cannot execute DELETE in a read-only transaction"),
            engine("8", "attempt to write a readonly database"),
            engine("1032", "attempt to write a readonly database"),
        ] {
            let msg = refusal(match on().engine_refusal(&err) {
                Some(e) => Err(e),
                None => Ok(()),
            });
            assert!(msg.starts_with(READ_ONLY_PREFIX), "{msg}");
        }
    }

    #[test]
    fn other_engine_failures_and_a_guard_that_is_off_are_left_alone() {
        assert!(on().engine_refusal(&engine("42P01", "relation \"t\" does not exist")).is_none());
        assert!(on().engine_refusal(&engine("1", "no such table: t")).is_none());
        assert!(on().engine_refusal(&sqlx::Error::PoolClosed).is_none());
        let off = ReadOnlyGuard::new(false);
        assert!(off
            .engine_refusal(&engine("25006", "cannot execute DELETE in a read-only transaction"))
            .is_none());
    }
}
