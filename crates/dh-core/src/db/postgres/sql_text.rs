/// Quote an identifier the Postgres way (double quotes).
pub(super) fn q(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Schema-qualified reference: `"schema"."name"`. Free function (not an
/// inherent `PgAdapter` method) — `schema` is always an already-resolved
/// per-call target now (see each trait method's own resolution), never read
/// off `self.cur_schema()` implicitly, so a sibling-database/schema caller
/// can't accidentally qualify against the primary connection's active one.
pub(super) fn tq(schema: &str, name: &str) -> String {
    format!("{}.{}", q(schema), q(name))
}

/// Qualified object reference for `$n::regclass` parameters: `"schema"."name"`.
/// NO surrounding single quotes — this value is always BOUND as a parameter
/// (the server applies its own quoting); embedding quotes would make
/// regclass input fail with "invalid name syntax". Named `qualify_regclass`
/// (not `regclass`) so it doesn't collide with the many local variables
/// named `regclass` that hold ITS result.
pub(super) fn qualify_regclass(schema: &str, name: &str) -> String {
    format!("{}.{}", q(schema), q(name))
}

/// Convert SQLite-style `?` placeholders to Postgres `$1..$n`. Occurrences
/// inside single-quoted literals are left alone.
pub(super) fn dollar_placeholders(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    let mut n = 0;
    let mut in_str = false;
    for ch in sql.chars() {
        match ch {
            '\'' => {
                in_str = !in_str;
                out.push(ch);
            }
            '?' if !in_str => {
                n += 1;
                out.push('$');
                out.push_str(&n.to_string());
            }
            _ => out.push(ch),
        }
    }
    out
}

/// Whether `trimmed` (already `$n` converted and trimmed) reads rows, by its
/// first keyword.
pub(super) fn is_select_statement(trimmed: &str) -> bool {
    let first_word = trimmed
        .split(|c: char| c == ' ' || c == '\n' || c == '\t')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    first_word == "select" || first_word == "with"
}
