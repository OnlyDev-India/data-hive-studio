use crate::db::{DbError, DbResult};

// ---- Console parser (Phase 3: find / aggregate / count / distinct + a small
// shell subset). MongoDB has no SQL, so the console accepts JSON queries and
// baking-stone shell-style commands instead. No arbitrary JS is evaluated.

/// Index of the `)` matching the `(` at `open`, skipping over quoted strings
/// (so `$regex: "a(b"` does not throw off the balance). Returns None if
/// unbalanced.
fn balanced_close(s: &str, open: usize) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut depth: isize = 1;
    let mut i = open + 1;
    let mut in_str: Option<u8> = None;
    let mut escaped = false;
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = in_str {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == q {
                in_str = None;
            }
            i += 1;
            continue;
        }
        match b {
            b'"' | b'\'' => in_str = Some(b),
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// Split `s` on top-level commas (depth 0, string-aware) — used to separate a
/// command's comma-separated JSON arguments.
pub(super) fn split_top_level(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut depth: isize = 0;
    let mut cur = String::new();
    let mut in_str: Option<char> = None;
    let mut escaped = false;
    for b in s.chars() {
        if let Some(q) = in_str {
            cur.push(b);
            if escaped {
                escaped = false;
            } else if b == '\\' {
                escaped = true;
            } else if b == q {
                in_str = None;
            }
            continue;
        }
        match b {
            '"' | '\'' => {
                in_str = Some(b);
                cur.push(b);
            }
            '{' | '[' | '(' => {
                depth += 1;
                cur.push(b);
            }
            '}' | ']' | ')' => {
                depth -= 1;
                cur.push(b);
            }
            ',' if depth == 0 => {
                out.push(cur.trim().to_string());
                cur = String::new();
            }
            _ => cur.push(b),
        }
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

/// A parsed `db.<collection>.<method>(<args>)[.limit(n).pretty()]` call.
pub(super) struct DbCall {
    pub(super) coll: String,
    pub(super) method: String,
    pub(super) args: String,
    pub(super) chain: String,
}

/// Parse a `db.<collection>.<method>(...)` console command into its parts.
pub(super) fn parse_db_call(s: &str) -> Option<DbCall> {
    let body = s.strip_prefix("db.")?;
    let body = body.trim().trim_end_matches(';').trim();
    let open = body.find('(')?;
    let prefix = &body[..open];
    let last_dot = prefix.rfind('.')?;
    let method = prefix[last_dot + 1..].trim().to_string();
    let coll = prefix[..last_dot].trim().to_string();
    let close = balanced_close(body, open)?;
    let args = body[open + 1..close].trim().to_string();
    let chain = body[close + 1..]
        .trim()
        .trim_end_matches(';')
        .trim()
        .to_string();
    Some(DbCall {
        coll,
        method,
        args,
        chain,
    })
}

/// Options recognized after a `find(...)` call, e.g. `.limit(5).sort({...})`.
pub(super) struct FindChain {
    pub(super) limit: Option<i64>,
    pub(super) sort: Option<String>,
}

pub(super) fn parse_chain(chain: &str) -> FindChain {
    let lower = chain.to_ascii_lowercase();
    let mut f = FindChain {
        limit: None,
        sort: None,
    };
    if let Some(i) = lower.find(".limit") {
        if let Some(po) = chain[i..].find('(') {
            let o = i + po;
            if let Some(c) = balanced_close(chain, o) {
                f.limit = chain[o + 1..c].trim().parse::<i64>().ok();
            }
        }
    }
    if let Some(i) = lower.find(".sort") {
        if let Some(po) = chain[i..].find('(') {
            let o = i + po;
            if let Some(c) = balanced_close(chain, o) {
                f.sort = Some(chain[o + 1..c].trim().to_string());
            }
        }
    }
    f
}

/// Modifier calls tolerated after the main `db.<collection>.<method>(...)`
/// call — everything `parse_chain` itself understands, plus a couple of
/// no-ops the real Mongo shell also allows chained on.
const CHAIN_METHODS: &[&str] = &["limit", "sort", "skip", "pretty", "toArray", "count"];

/// `parse_db_call` only looks for the FIRST `db.<collection>.<method>(...)`
/// in the input and puts everything after its closing `)` into `chain` —
/// which is exactly right for `.limit(5).sort({...})`, but means a second,
/// separate command typed right after the first with no `;` between them
/// (e.g. two `db.x.find()` calls on their own lines) silently landed in
/// `chain` too, where `parse_chain` just didn't recognize it as a modifier
/// and quietly dropped it: the first query ran, the second vanished with no
/// error at all. This walks `chain` consuming only recognized modifier
/// calls and errors on whatever's left, so a second glued-on command is
/// reported instead of silently discarded.
pub(super) fn validate_chain(chain: &str) -> DbResult<()> {
    let mut rest = chain.trim();
    while !rest.is_empty() {
        let Some(stripped) = rest.strip_prefix('.') else {
            break;
        };
        let Some(open) = stripped.find('(') else {
            break;
        };
        if !CHAIN_METHODS.contains(&stripped[..open].trim()) {
            break;
        }
        let Some(close) = balanced_close(stripped, open) else {
            break;
        };
        rest = stripped[close + 1..].trim();
    }
    if rest.is_empty() {
        Ok(())
    } else {
        Err(DbError::InvalidOperation(format!(
            "Unexpected text after the query: `{rest}` — looks like more than one command with no \";\" between them. Run each separately, or add \";\" between them."
        )))
    }
}

/// Parse a `<query>` argument (optionally `query, options`) into a filter
/// document. Empty input → `None` (match everything).
pub(super) fn parse_filter(args: &str) -> DbResult<Option<bson::Document>> {
    let parts = split_top_level(args);
    let first = parts.first().map(|p| p.trim()).unwrap_or("");
    if first.is_empty() {
        return Ok(None);
    }
    let v: serde_json::Value = serde_json::from_str(&super::mongo_json::quote_bare_keys(first))
        .map_err(|e| DbError::InvalidOperation(format!("invalid query JSON: {e}")))?;
    if !v.is_object() {
        return Err(DbError::InvalidOperation(
            "a query must be a JSON object, e.g. {\"status\": \"active\"}".into(),
        ));
    }
    bson::to_document(&v)
        .map(Some)
        .map_err(|e| DbError::InvalidOperation(format!("invalid query: {e}")))
}

/// Parse a single REQUIRED JSON-object argument — an insert document, or an
/// update's replacement/operator document. Unlike `parse_filter`, empty
/// input is an error rather than "match everything": these are the actual
/// document being written, not a query.
pub(super) fn parse_json_object(s: &str, what: &str) -> DbResult<bson::Document> {
    let s = s.trim();
    if s.is_empty() {
        return Err(DbError::InvalidOperation(format!("{what} is required")));
    }
    let v: serde_json::Value = serde_json::from_str(&super::mongo_json::quote_bare_keys(s))
        .map_err(|e| DbError::InvalidOperation(format!("invalid {what} JSON: {e}")))?;
    if !v.is_object() {
        return Err(DbError::InvalidOperation(format!("{what} must be a JSON object")));
    }
    bson::to_document(&v).map_err(|e| DbError::InvalidOperation(format!("invalid {what}: {e}")))
}

/// Parse a JSON array of documents — `insertMany`'s argument.
pub(super) fn parse_json_object_array(s: &str, what: &str) -> DbResult<Vec<bson::Document>> {
    let v: serde_json::Value = serde_json::from_str(&super::mongo_json::quote_bare_keys(s.trim()))
        .map_err(|e| DbError::InvalidOperation(format!("invalid {what} JSON: {e}")))?;
    let arr = v.as_array().ok_or_else(|| {
        DbError::InvalidOperation(format!("{what} must be a JSON array of documents"))
    })?;
    arr.iter()
        .map(|d| {
            if !d.is_object() {
                return Err(DbError::InvalidOperation(format!(
                    "every item in {what} must be a JSON object"
                )));
            }
            bson::to_document(d)
                .map_err(|e| DbError::InvalidOperation(format!("invalid document in {what}: {e}")))
        })
        .collect()
}
