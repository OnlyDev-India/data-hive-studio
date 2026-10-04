//! Pipeline text back into cards: a shell `aggregate` call or a JSON array,
//! with the Save format's `// @title`, note and `// @disabled` comments read
//! back at any depth.

use bson::{Bson, Document};
use crate::api::{BranchDraft, ParsedPipeline, StageDraft};
use crate::db::mongo_json::{parse, quote_bare_keys};
use super::super::console_parse::validate_chain;
use super::compose::{branching, value_text, Branching};
use super::marks::{with_marks, META};


/// Extended JSON wrappers a pasted JSON array may hold (`{"$oid": …}`).
const EXT_KEYS: &[&str] = &[
    "$oid", "$date", "$numberLong", "$numberInt", "$numberDouble", "$numberDecimal", "$binary", "$uuid",
    "$timestamp", "$regularExpression", "$minKey", "$maxKey", "$symbol", "$code", "$undefined",
];

const SHAPE: &str = "Paste a pipeline as db.<collection>.aggregate([...]) or as a JSON array of stages";

pub fn parse_pipeline(text: &str) -> Result<ParsedPipeline, String> {
    let code = blank_comments(text);
    let (collection, start, end) = locate_array(&code)?;
    // Check with the comments gone first, so an error points at the real text.
    parse_array(&code[start..end]).map_err(|(message, at)| at_line(text, start + at, &message))?;
    let marked = with_marks(&text[start..end]);
    let items = parse_array(&marked).map_err(|(message, _)| message)?;
    let stages = items
        .into_iter()
        .enumerate()
        .map(|(i, b)| card(b, i + 1, false))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ParsedPipeline { collection, stages })
}

/// The stage documents of an `aggregate` argument (`[...]`, maybe followed
/// by options), comments allowed. What the console and Explain run.
pub fn stage_array(args: &str) -> Result<Vec<Document>, String> {
    let code = blank_comments(args);
    let open = code.find(|c: char| !c.is_whitespace()).filter(|&i| code.as_bytes()[i] == b'[');
    let Some(open) = open else {
        return Err("aggregate pipeline must be a JSON array".into());
    };
    let close = close_of(&code, open).ok_or("aggregate pipeline is missing its closing ]")?;
    let items = parse_array(&code[open..=close]).map_err(|(m, at)| at_line(args, open + at, &m))?;
    items
        .into_iter()
        .map(|b| match lift(b) {
            Bson::Document(d) => Ok(d),
            _ => Err("every pipeline stage must be a document, like { $match: {} }".into()),
        })
        .collect()
}

/// `text` with every `//` and `/* */` comment outside strings turned to
/// spaces, newlines kept, so every byte stays where it was.
pub(super) fn blank_comments(text: &str) -> String {
    let b = text.as_bytes();
    let mut out = b.to_vec();
    let mut i = 0;
    let mut quote: Option<u8> = None;
    while i < b.len() {
        let c = b[i];
        if let Some(q) = quote {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == q {
                quote = None;
            }
            i += 1;
            continue;
        }
        match (c, b.get(i + 1)) {
            (b'"' | b'\'', _) => quote = Some(c),
            (b'/', Some(b'/')) => {
                while i < b.len() && b[i] != b'\n' {
                    out[i] = b' ';
                    i += 1;
                }
                continue;
            }
            (b'/', Some(b'*')) => {
                let stop = text[i + 2..].find("*/").map_or(b.len(), |n| i + 2 + n + 2);
                for o in &mut out[i..stop] {
                    if *o != b'\n' {
                        *o = b' ';
                    }
                }
                i = stop;
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    String::from_utf8(out).unwrap_or_default()
}

/// The byte index of the bracket closing the one at `open`, strings skipped.
pub(super) fn close_of(s: &str, open: usize) -> Option<usize> {
    let b = s.as_bytes();
    let mut depth = 0i32;
    let mut quote: Option<u8> = None;
    let mut i = open;
    while i < b.len() {
        let c = b[i];
        if let Some(q) = quote {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == q {
                quote = None;
            }
        } else {
            match c {
                b'"' | b'\'' => quote = Some(c),
                b'[' | b'{' | b'(' => depth += 1,
                b']' | b'}' | b')' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(i);
                    }
                }
                _ => {}
            }
        }
        i += 1;
    }
    None
}

/// The collection a shell call names and the byte range of its pipeline
/// array, in comment free `code`.
fn locate_array(code: &str) -> Result<(Option<String>, usize, usize), String> {
    let lead = code.len() - code.trim_start().len();
    let rest = &code[lead..];
    if rest.starts_with('[') {
        let close = close_of(code, lead).ok_or("The pipeline is missing its closing ]")?;
        if !code[close + 1..].trim().trim_end_matches(';').trim().is_empty() {
            return Err("There is text after the pipeline's closing ]".into());
        }
        return Ok((None, lead, close + 1));
    }
    let Some(after_db) = rest.strip_prefix("db.") else {
        return Err(SHAPE.into());
    };
    let base = lead + 3;
    let (collection, call_at) = if let Some(args) = after_db.strip_prefix("getCollection(") {
        let open = base + "getCollection".len();
        let close = close_of(code, open).ok_or(SHAPE)?;
        let name: String = serde_json::from_str(args[..close - open - 1].trim()).map_err(|_| SHAPE.to_string())?;
        (name, close + 1)
    } else {
        let dot = after_db.find(".aggregate(").ok_or(SHAPE)?;
        (after_db[..dot].trim().to_string(), base + dot)
    };
    let tail = &code[call_at..];
    if !tail.starts_with(".aggregate(") {
        return Err(SHAPE.into());
    }
    let open_paren = call_at + ".aggregate".len();
    let close_paren = close_of(code, open_paren).ok_or("The aggregate call is missing its closing )")?;
    validate_chain(code[close_paren + 1..].trim().trim_end_matches(';')).map_err(|e| e.to_string())?;
    let inner = &code[open_paren + 1..close_paren];
    let skip = inner.len() - inner.trim_start().len();
    let start = open_paren + 1 + skip;
    if !code[start..].starts_with('[') {
        return Err("aggregate takes an array of stages, like aggregate([{ $match: {} }])".into());
    }
    let close = close_of(code, start).ok_or("The pipeline is missing its closing ]")?;
    Ok((Some(collection).filter(|c| !c.is_empty()), start, close + 1))
}

/// A `[...]` array of stages, or the parser's message and the byte in `s`
/// it stopped at.
fn parse_array(s: &str) -> Result<Vec<Bson>, (String, usize)> {
    const WRAP: &str = "{\"p\": ";
    let quoted = quote_bare_keys(s);
    match parse(&format!("{WRAP}{quoted}}}")) {
        Ok(mut d) => match d.remove("p") {
            Some(Bson::Array(items)) => Ok(items),
            _ => Err(("The pipeline must be an array of stages".into(), 0)),
        },
        Err(e) => {
            let (what, at) = match e.0.rsplit_once(" at byte ") {
                Some((what, n)) => (what.to_string(), n.parse::<usize>().unwrap_or(0)),
                None => (e.0.clone(), WRAP.len()),
            };
            Err((what, unquoted_at(s, &quoted, at.saturating_sub(WRAP.len()))))
        }
    }
}

/// The byte of `orig` that byte `at` of `quoted` (`orig` with the quotes
/// `quote_bare_keys` added) came from.
fn unquoted_at(orig: &str, quoted: &str, at: usize) -> usize {
    let (o, q) = (orig.as_bytes(), quoted.as_bytes());
    let (mut i, mut j) = (0, 0);
    while i < at.min(q.len()) && j < o.len() {
        if q[i] == o[j] {
            j += 1;
        }
        i += 1;
    }
    j
}

/// "expected `,` (line 3, column 7)" for byte `at` of `text`.
fn at_line(text: &str, at: usize, what: &str) -> String {
    let before = &text[..at.min(text.len())];
    let line = before.matches('\n').count() + 1;
    let column = before.rsplit('\n').next().map_or(0, |l| l.chars().count()) + 1;
    format!("{what} (line {line}, column {column})")
}

/// A stage value with extended JSON wrappers (`{"$oid": …}`) turned into
/// the values they stand for, the way the console reads them.
fn lift(v: Bson) -> Bson {
    match v {
        Bson::Document(d) => {
            if d.keys().next().is_some_and(|k| EXT_KEYS.contains(&k.as_str())) {
                if let Ok(b) = Bson::try_from(Bson::Document(d.clone()).into_relaxed_extjson()) {
                    if !matches!(b, Bson::Document(_)) {
                        return b;
                    }
                }
            }
            Bson::Document(d.into_iter().map(|(k, v)| (k, lift(v))).collect())
        }
        Bson::Array(a) => Bson::Array(a.into_iter().map(lift).collect()),
        other => other,
    }
}

/// `v` with every `META` key taken out, at any depth.
fn strip_meta(v: Bson) -> Bson {
    match v {
        Bson::Document(d) => {
            Bson::Document(d.into_iter().filter(|(k, _)| k != META).map(|(k, v)| (k, strip_meta(v))).collect())
        }
        Bson::Array(a) => Bson::Array(a.into_iter().map(strip_meta).collect()),
        other => other,
    }
}

/// Whether `v` reads as a stage: a document with one `$` key besides `META`.
fn is_stage(v: &Bson) -> bool {
    let Bson::Document(d) = v else { return false };
    let mut keys = d.keys().filter(|k| *k != META);
    keys.next().is_some_and(|k| k.starts_with('$')) && keys.next().is_none()
}

fn side_chain(items: &[Bson]) -> bool {
    items.iter().all(is_stage)
}

/// A disabled card that does not parse: its operator and its body as typed.
fn split_raw(raw: &str, n: usize) -> Result<(String, String), String> {
    let inner = raw.trim().strip_prefix('{').and_then(|r| r.strip_suffix('}')).unwrap_or(raw).trim();
    let (key, body) = inner.split_once(':').ok_or_else(|| not_a_stage(n))?;
    let op = key.trim().trim_matches(['"', '\'']).to_string();
    if !op.starts_with('$') {
        return Err(not_a_stage(n));
    }
    Ok((op, body.trim().to_string()))
}

fn not_a_stage(n: usize) -> String {
    format!("Stage {n} should hold one stage operator, like {{ $match: {{}} }}")
}

/// Item `n` of a chain as a card, its side chains as cards too unless it is
/// itself a side chain card.
fn card(item: Bson, n: usize, in_branch: bool) -> Result<StageDraft, String> {
    let Bson::Document(mut doc) = item else { return Err(not_a_stage(n)) };
    let meta = match doc.remove(META) {
        Some(Bson::Document(m)) => m,
        _ => Document::new(),
    };
    let text = |k: &str| meta.get_str(k).ok().map(str::to_string);
    let (title, note) = (text("title"), text("note"));
    let enabled = !meta.get_bool("disabled").unwrap_or(false);
    if let Some(raw) = text("raw") {
        let (op, body) = split_raw(&raw, n)?;
        return Ok(StageDraft { op, body, enabled, title, note, branches: vec![] });
    }
    if doc.len() != 1 || !doc.keys().all(|k| k.starts_with('$')) {
        return Err(not_a_stage(n));
    }
    let Some((op, value)) = doc.into_iter().next() else { return Err(not_a_stage(n)) };
    let mut value = lift(value);
    let mut branches = Vec::new();
    if !in_branch {
        let chain = |items: Vec<Bson>| -> Result<Vec<StageDraft>, String> {
            items.into_iter().enumerate().map(|(i, b)| card(b, i + 1, true)).collect()
        };
        match (branching(&op), &mut value) {
            (Some(Branching::Facet), Bson::Document(outputs)) => {
                let keys: Vec<String> = outputs
                    .iter()
                    .filter(|(_, v)| matches!(v, Bson::Array(a) if side_chain(a)))
                    .map(|(k, _)| k.clone())
                    .collect();
                for key in keys {
                    if let Some(Bson::Array(items)) = outputs.remove(&key) {
                        branches.push(BranchDraft { key, stages: chain(items)? });
                    }
                }
            }
            (Some(_), Bson::Document(d)) if matches!(d.get("pipeline"), Some(Bson::Array(a)) if side_chain(a)) => {
                if let Some(Bson::Array(items)) = d.remove("pipeline") {
                    branches.push(BranchDraft { key: "pipeline".into(), stages: chain(items)? });
                }
            }
            _ => {}
        }
    }
    Ok(StageDraft {
        body: value_text(&strip_meta(value), 0),
        op,
        enabled,
        title,
        note,
        branches,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::{BranchSpec, PipelineSpec, StageSpec};
    use crate::db::mongodb::pipeline::compose_pipeline;

    fn ops(p: &ParsedPipeline) -> Vec<(&str, &str, bool)> {
        p.stages.iter().map(|s| (s.op.as_str(), s.body.as_str(), s.enabled)).collect()
    }

    #[test]
    fn a_shell_call_with_constructors_and_bare_keys_reads_as_cards() {
        let p = parse_pipeline(
            "db.orders.aggregate([\n  { $match: { _id: ObjectId(\"507f1f77bcf86cd799439011\") } }, // first\n  { $limit: 10 }\n]);",
        )
        .unwrap();
        assert_eq!(p.collection.as_deref(), Some("orders"));
        assert_eq!(
            ops(&p),
            [("$match", "{ _id: ObjectId(\"507f1f77bcf86cd799439011\") }", true), ("$limit", "10", true)]
        );
        // A comment after a card belongs to the next one.
        assert_eq!(p.stages[1].note.as_deref(), Some("first"));
    }

    #[test]
    fn a_json_array_and_get_collection_both_read() {
        let p = parse_pipeline(r#"[{"$match": {"_id": {"$oid": "507f1f77bcf86cd799439011"}}}, {"$skip": 2}]"#).unwrap();
        assert_eq!(p.collection, None);
        assert_eq!(p.stages[0].body, "{ _id: ObjectId(\"507f1f77bcf86cd799439011\") }");
        let p = parse_pipeline("db.getCollection(\"order lines\").aggregate([]).toArray()").unwrap();
        assert_eq!(p.collection.as_deref(), Some("order lines"));
        assert!(p.stages.is_empty());
    }

    #[test]
    fn text_that_does_not_parse_names_its_line_and_column() {
        let e = parse_pipeline("db.c.aggregate([\n  { $match: { a: } }\n])").unwrap_err();
        assert!(e.ends_with("(line 2, column 18)"), "{e}");
        assert!(parse_pipeline("db.c.find({})").is_err());
        assert!(parse_pipeline("[{ $match: {}, $limit: 1 }]").unwrap_err().contains("Stage 1"));
        assert!(parse_pipeline("db.c.aggregate([]) db.d.aggregate([])").is_err());
    }

    #[test]
    fn side_chains_come_back_as_branches() {
        let p = parse_pipeline(
            r#"[
              { $facet: { top: [{ $sort: { n: -1 } }], meta: { a: 1 } } },
              { $lookup: { from: "items", let: { o: "$_id" }, pipeline: [{ $match: { a: 1 } }], as: "lines" } },
              { $unionWith: { coll: "archive", pipeline: [] } },
              { $lookup: { from: "x", localField: "a", foreignField: "b", as: "y" } }
            ]"#,
        )
        .unwrap();
        let s = &p.stages;
        assert_eq!(s[0].body, "{ meta: { a: 1 } }");
        assert_eq!(s[0].branches[0].key, "top");
        assert_eq!(s[0].branches[0].stages[0].op, "$sort");
        assert_eq!(s[1].body, "{ from: \"items\", let: { o: \"$_id\" }, as: \"lines\" }");
        assert_eq!(s[1].branches[0].stages[0].body, "{ a: 1 }");
        assert_eq!(s[2].body, "{ coll: \"archive\" }");
        assert_eq!(s[2].branches[0].stages.len(), 0);
        assert!(s[3].branches.is_empty());
    }

    fn stage(id: &str, op: &str, body: &str) -> StageSpec {
        StageSpec {
            id: id.into(),
            op: op.into(),
            body: body.into(),
            enabled: true,
            title: None,
            note: None,
            branches: vec![],
        }
    }

    #[test]
    fn a_saved_file_reopens_as_the_same_cards() {
        let mut first = stage("a", "$match", r#"{ status: "A" }"#);
        first.title = Some("Active".into());
        first.note = Some("why\nand how".into());
        let mut off = stage("b", "$sort", "{ n: -1 }");
        off.enabled = false;
        let mut broken = stage("c", "$project", "{ a: }");
        broken.enabled = false;
        let mut side_off = stage("t2", "$limit", "3");
        side_off.enabled = false;
        side_off.note = Some("not yet".into());
        let mut titled = stage("t1", "$skip", "1");
        titled.title = Some("Skip one".into());
        let mut facet = stage("f", "$facet", "{}");
        facet.branches = vec![BranchSpec { key: "top".into(), stages: vec![titled, side_off] }];
        let mut facet_off = facet.clone();
        facet_off.enabled = false;
        let spec = PipelineSpec { stages: vec![first, off, facet, broken, facet_off, stage("z", "$count", "\"n\"")] };
        let file = compose_pipeline("orders", &spec).file;
        let p = parse_pipeline(&file).unwrap_or_else(|e| panic!("{e}\n{file}"));
        assert_eq!(p.collection.as_deref(), Some("orders"));
        assert_eq!(
            ops(&p),
            [
                ("$match", "{ status: \"A\" }", true),
                ("$sort", "{ n: -1 }", false),
                ("$facet", "{}", true),
                ("$project", "{ a: }", false),
                ("$facet", "{}", false),
                ("$count", "\"n\"", true),
            ]
        );
        assert_eq!(p.stages[0].title.as_deref(), Some("Active"));
        assert_eq!(p.stages[0].note.as_deref(), Some("why\nand how"));
        for f in [&p.stages[2], &p.stages[4]] {
            let side = &f.branches[0].stages;
            assert_eq!(side[0].title.as_deref(), Some("Skip one"));
            assert_eq!((side[1].op.as_str(), side[1].enabled), ("$limit", false));
            assert_eq!(side[1].note.as_deref(), Some("not yet"));
        }
    }

    #[test]
    fn the_console_reads_constructors_and_options() {
        let docs = stage_array("[{ $match: { at: ISODate(\"2026-01-01T00:00:00Z\") } }], { allowDiskUse: true }").unwrap();
        assert!(matches!(docs[0].get_document("$match").unwrap().get("at"), Some(Bson::DateTime(_))));
        assert!(stage_array("{ $match: {} }").is_err());
        assert!(stage_array("[1]").is_err());
    }
}
