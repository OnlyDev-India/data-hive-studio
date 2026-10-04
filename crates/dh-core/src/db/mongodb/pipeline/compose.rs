use bson::{Bson, Document};
use crate::api::{BranchSpec, ComposedPipeline, PipelineSpec, StageError, StageSpec};
use crate::db::mongo_json::{parse, quote_bare_keys, render_bson};

/// A document or array this short stays on one line.
const INLINE_MAX: usize = 72;

/// Stands in for a side chain while the Save format renders its parent;
/// anything holding one breaks onto lines.
pub(super) const SIDE_TOKEN: &str = "@@dh-side-chain-";

/// One card as its stage document, or why it is not one.
pub(super) fn stage_doc(s: &StageSpec) -> Result<Document, String> {
    let op = s.op.trim();
    let valid = op.len() > 1
        && op.starts_with('$')
        && op[1..].chars().all(|c| c.is_ascii_alphanumeric());
    if !valid {
        return Err("A stage operator starts with $, like $match".into());
    }
    let body = s.body.trim();
    if body.is_empty() {
        return Err(format!("{op} needs a value"));
    }
    let text = quote_bare_keys(&format!("{{{}: {body}}}", json_string(op)));
    parse(&text).map_err(|e| located(&e.0, &text))
}

/// "expected `,` or `}` at byte 31" as "expected `,` or `}` (line 2)". The
/// wrapper around the body adds no line, so the line is the card's own.
fn located(message: &str, text: &str) -> String {
    let Some((what, at)) = message.rsplit_once(" at byte ") else {
        return message.to_string();
    };
    let Ok(at) = at.parse::<usize>() else {
        return message.to_string();
    };
    let line = text.get(..at.min(text.len())).map_or(1, |s| s.matches('\n').count() + 1);
    format!("{what} (line {line})")
}

/// The stages that take side chains.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum Branching {
    Facet,
    Lookup,
    UnionWith,
}

pub(super) fn branching(op: &str) -> Option<Branching> {
    match op.trim() {
        "$facet" => Some(Branching::Facet),
        "$lookup" => Some(Branching::Lookup),
        "$unionWith" => Some(Branching::UnionWith),
        _ => None,
    }
}

/// A side chain card as its stage document. It never writes and never has
/// a side chain of its own.
pub(super) fn branch_stage_doc(s: &StageSpec) -> Result<Document, String> {
    let op = s.op.trim();
    if is_write_op(op) {
        return Err(format!("{op} writes, so it can only be the last stage of the main pipeline"));
    }
    if !s.branches.is_empty() {
        return Err("A side chain card cannot have side chains of its own, keep the inner pipeline as JSON".into());
    }
    stage_doc(s)
}

/// A side chain's enabled cards that compose, adding an error per card that
/// does not.
fn branch_docs(b: &BranchSpec, errors: &mut Vec<StageError>) -> Vec<Document> {
    let mut docs = Vec::new();
    for s in b.stages.iter().filter(|s| s.enabled) {
        match branch_stage_doc(s) {
            Ok(d) => docs.push(d),
            Err(message) => errors.push(StageError {
                stage_id: s.id.clone(),
                branch_key: Some(b.key.clone()),
                message,
            }),
        }
    }
    docs
}

/// A `$facet` output name: not empty, no `$`, no `.`.
fn facet_key_error(key: &str) -> Option<String> {
    if key.is_empty() {
        Some("A $facet output needs a name".into())
    } else if key.contains('$') || key.contains('.') {
        Some(format!("A $facet output name cannot hold $ or . ({key})"))
    } else {
        None
    }
}

/// `stage` with its side chains spliced in: one output per `$facet` side
/// chain, or the `pipeline` of a `$lookup` or `$unionWith`.
pub(super) fn splice(mut stage: Document, branches: &[(&str, Vec<Document>)]) -> Result<Document, String> {
    let Some(op) = stage.keys().next().cloned() else {
        return Ok(stage);
    };
    let Some(kind) = branching(&op) else {
        return Ok(stage);
    };
    if branches.is_empty() {
        return Ok(stage);
    }
    let array = |docs: &[Document]| Bson::Array(docs.iter().cloned().map(Bson::Document).collect());
    let Some(value) = stage.get_mut(&op) else {
        return Ok(stage);
    };
    if kind == Branching::Facet {
        let Bson::Document(outputs) = value else {
            return Err("A $facet with side chains takes a document, like {}".into());
        };
        for (key, docs) in branches {
            if let Some(e) = facet_key_error(key) {
                return Err(e);
            }
            if outputs.contains_key(*key) {
                return Err(format!("$facet has the output {key} twice"));
            }
            outputs.insert(*key, array(docs));
        }
        return Ok(stage);
    }
    if branches.len() > 1 || branches[0].0 != "pipeline" {
        return Err(format!("{op} has one side chain, its pipeline"));
    }
    if let Bson::String(coll) = &*value {
        let coll = coll.clone();
        if kind == Branching::UnionWith {
            *value = Bson::Document(bson::doc! { "coll": coll });
        }
    }
    let Bson::Document(d) = value else {
        return Err(format!("{op} with a side chain takes a document"));
    };
    if d.contains_key("pipeline") {
        return Err(format!("This {op}'s pipeline is its side chain, so take pipeline out of the JSON"));
    }
    d.insert("pipeline", array(&branches[0].1));
    Ok(stage)
}

/// A main chain card as its stage document with its side chains spliced in,
/// adding an error per card that does not compose: its own, or one per side
/// chain card.
pub(super) fn main_stage_doc(s: &StageSpec, errors: &mut Vec<StageError>) -> Option<Document> {
    let own = stage_doc(s);
    let before = errors.len();
    let branches: Vec<(&str, Vec<Document>)> = match branching(&s.op) {
        Some(_) => s.branches.iter().map(|b| (b.key.as_str(), branch_docs(b, errors))).collect(),
        None => Vec::new(),
    };
    let branch_failed = errors.len() > before;
    match own.and_then(|d| splice(d, &branches)) {
        Ok(d) if !branch_failed => Some(d),
        Ok(_) => None,
        Err(message) => {
            errors.push(StageError { stage_id: s.id.clone(), branch_key: None, message });
            None
        }
    }
}

/// The enabled cards that compose, in order, and an error per card that does
/// not, a `$out` or `$merge` anywhere but last included.
pub(super) fn enabled_stages(spec: &PipelineSpec) -> (Vec<(&StageSpec, Document)>, Vec<StageError>) {
    let mut ok = Vec::new();
    let mut errors = Vec::new();
    let enabled: Vec<&StageSpec> = spec.stages.iter().filter(|s| s.enabled).collect();
    for (i, s) in enabled.iter().copied().enumerate() {
        let op = s.op.trim();
        if is_write_op(op) && i + 1 < enabled.len() {
            errors.push(StageError {
                stage_id: s.id.clone(),
                branch_key: None,
                message: format!("{op} writes, so it can only be the last stage"),
            });
            continue;
        }
        if let Some(d) = main_stage_doc(s, &mut errors) {
            ok.push((s, d));
        }
    }
    (ok, errors)
}

pub fn compose_pipeline(collection: &str, spec: &PipelineSpec) -> ComposedPipeline {
    let (stages, errors) = enabled_stages(spec);
    let docs: Vec<Bson> = stages.iter().map(|(_, d)| Bson::Document(d.clone())).collect();
    let target = collection_ref(collection);
    let shell_items: Vec<String> = stages.iter().map(|(_, d)| stage_text(d)).collect();
    ComposedPipeline {
        canonical: Bson::Array(docs.clone()).into_canonical_extjson(),
        shell: format!("{target}.aggregate({})", array_block(&shell_items)),
        json: serde_json::to_string_pretty(&Bson::Array(docs).into_relaxed_extjson())
            .unwrap_or_else(|_| "[]".into()),
        file: super::file::file_text(&target, spec),
        errors,
    }
}

/// `db.orders`, or `db.getCollection("order lines")` for a name that is not
/// a plain dotted identifier.
fn collection_ref(name: &str) -> String {
    if !name.is_empty() && name.split('.').all(is_ident) {
        format!("db.{name}")
    } else {
        format!("db.getCollection({})", json_string(name))
    }
}

/// `[` items each on their own line `]`, items already indented one level.
fn array_block(items: &[String]) -> String {
    if items.is_empty() {
        return "[]".into();
    }
    format!("[\n{}\n]", items.join(",\n"))
}

/// One stage as it sits inside the array, every line indented one level.
fn stage_text(d: &Document) -> String {
    indent(&doc_text(d, 1))
}

fn indent(text: &str) -> String {
    let mut lines = text.lines();
    let first = lines.next().unwrap_or_default();
    // Continuation lines already carry their depth from `doc_text`.
    std::iter::once(format!("  {first}"))
        .chain(lines.map(str::to_string))
        .collect::<Vec<_>>()
        .join("\n")
}

/// A stage value in canonical Extended JSON as card body text, the way a
/// form writes back into the card.
pub fn render_stage(op: &str, value: serde_json::Value) -> Result<String, String> {
    let v = Bson::try_from(value).map_err(|e| format!("{} value is not valid Extended JSON: {e}", op.trim()))?;
    Ok(value_text(&v, 0))
}

pub(super) fn is_write_op(op: &str) -> bool {
    matches!(op, "$out" | "$merge")
}

/// A document as card body text.
pub(super) fn body_text(d: &Document) -> String {
    doc_text(d, 0)
}

fn is_ident(k: &str) -> bool {
    let mut chars = k.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == '$')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

pub(super) fn json_string(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| format!("\"{s}\""))
}

/// Shell style text for a value: bare keys, and a plain number wherever
/// parsing it gives the same type back (an integer reads as a long, a number
/// with a point as a double). Everything else is `render_bson`'s.
pub(super) fn value_text(v: &Bson, depth: usize) -> String {
    match v {
        Bson::Document(d) => doc_text(d, depth),
        Bson::Array(a) => array_text(a, depth),
        Bson::Int64(i) => i.to_string(),
        Bson::Double(f) if f.is_finite() => format!("{f:?}"),
        other => render_bson(other),
    }
}

pub(super) fn doc_text(d: &Document, depth: usize) -> String {
    let parts: Vec<String> = d
        .iter()
        .map(|(k, v)| {
            let key = if is_ident(k) { k.clone() } else { json_string(k) };
            format!("{key}: {}", value_text(v, depth + 1))
        })
        .collect();
    wrap(&parts, depth, "{ ", " }", "{}")
}

fn array_text(a: &[Bson], depth: usize) -> String {
    let parts: Vec<String> = a.iter().map(|v| value_text(v, depth + 1)).collect();
    wrap(&parts, depth, "[", "]", "[]")
}

fn wrap(parts: &[String], depth: usize, open: &str, close: &str, empty: &str) -> String {
    if parts.is_empty() {
        return empty.into();
    }
    let inline = format!("{open}{}{close}", parts.join(", "));
    if inline.len() + depth * 2 <= INLINE_MAX && !inline.contains('\n') && !inline.contains(SIDE_TOKEN) {
        return inline;
    }
    let pad = "  ".repeat(depth + 1);
    let lines: Vec<String> = parts.iter().map(|p| format!("{pad}{p}")).collect();
    format!(
        "{}\n{}\n{}{}",
        open.trim_end(),
        lines.join(",\n"),
        "  ".repeat(depth),
        close.trim_start()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn spec(stages: Vec<StageSpec>) -> PipelineSpec {
        PipelineSpec { stages }
    }

    fn branched(mut s: StageSpec, branches: Vec<(&str, Vec<StageSpec>)>) -> StageSpec {
        s.branches = branches.into_iter().map(|(k, stages)| BranchSpec { key: k.into(), stages }).collect();
        s
    }

    #[test]
    fn side_chains_are_spliced_into_their_parent() {
        let facet = branched(
            stage("f", "$facet", "{}"),
            vec![
                ("top", vec![stage("t1", "$sort", "{ n: -1 }"), stage("t2", "$limit", "3")]),
                ("count", vec![stage("c1", "$count", "\"n\"")]),
            ],
        );
        let lookup = branched(
            stage("l", "$lookup", r#"{ from: "items", let: { o: "$_id" }, as: "lines" }"#),
            vec![("pipeline", vec![stage("p1", "$match", "{ $expr: { $eq: [\"$order\", \"$$o\"] } }")])],
        );
        let union = branched(stage("u", "$unionWith", r#""archive""#), vec![("pipeline", vec![stage("a1", "$limit", "5")])]);
        let p = compose_pipeline("orders", &spec(vec![facet, lookup, union]));
        assert!(p.errors.is_empty(), "{:?}", p.errors);
        let c = &p.canonical;
        assert_eq!(c[0]["$facet"]["top"][1]["$limit"]["$numberLong"], "3");
        assert_eq!(c[0]["$facet"]["count"][0]["$count"], "n");
        assert_eq!(c[1]["$lookup"]["pipeline"][0]["$match"]["$expr"]["$eq"][1], "$$o");
        assert_eq!(c[2]["$unionWith"]["coll"], "archive");
        assert_eq!(c[2]["$unionWith"]["pipeline"][0]["$limit"]["$numberLong"], "5");
    }

    #[test]
    fn disabled_side_chain_cards_are_left_out() {
        let mut off = stage("t2", "$limit", "3");
        off.enabled = false;
        let facet = branched(stage("f", "$facet", "{}"), vec![("top", vec![stage("t1", "$skip", "1"), off])]);
        let p = compose_pipeline("c", &spec(vec![facet]));
        assert_eq!(p.canonical[0]["$facet"]["top"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn a_side_chain_card_error_names_its_branch_and_holds_back_the_parent() {
        let facet = branched(
            stage("f", "$facet", "{}"),
            vec![("top", vec![stage("t1", "$match", "{ a: }"), stage("t2", "$out", "\"x\"")])],
        );
        let p = compose_pipeline("c", &spec(vec![facet, stage("m", "$match", "{}")]));
        let errs: Vec<(&str, Option<&str>)> =
            p.errors.iter().map(|e| (e.stage_id.as_str(), e.branch_key.as_deref())).collect();
        assert_eq!(errs, [("t1", Some("top")), ("t2", Some("top"))]);
        assert!(p.errors[1].message.contains("main pipeline"));
        assert_eq!(p.canonical.as_array().unwrap().len(), 1, "only $match composes");
    }

    #[test]
    fn a_splice_that_cannot_hold_is_the_parents_error() {
        let both = branched(
            stage("l", "$lookup", r#"{ from: "x", as: "y", pipeline: [] }"#),
            vec![("pipeline", vec![stage("p", "$match", "{}")])],
        );
        let twice = branched(stage("f", "$facet", "{ a: [] }"), vec![("a", vec![]), ("b.c", vec![])]);
        let p = compose_pipeline("c", &spec(vec![both, twice]));
        let msgs: Vec<(&str, &str)> = p.errors.iter().map(|e| (e.stage_id.as_str(), e.message.as_str())).collect();
        assert_eq!(msgs.len(), 2);
        assert!(msgs[0].1.contains("take pipeline out"), "{msgs:?}");
        assert!(msgs[1].1.contains("twice"), "{msgs:?}");
        assert!(p.errors.iter().all(|e| e.branch_key.is_none()));
    }

    #[test]
    fn the_file_holds_the_spliced_stage() {
        let facet = branched(stage("f", "$facet", "{}"), vec![("n", vec![stage("c", "$count", "\"n\"")])]);
        let p = compose_pipeline("c", &spec(vec![facet]));
        assert_eq!(p.file, "db.c.aggregate([\n  { $facet: { n: [{ $count: \"n\" }] } }\n])\n");
    }

    #[test]
    fn relaxed_bodies_compose_into_every_form() {
        let p = compose_pipeline(
            "orders",
            &spec(vec![
                stage("a", "$match", r#"{ status: "A", _id: ObjectId("507f1f77bcf86cd799439011") }"#),
                stage("b", "$limit", "10"),
                stage("c", "$unwind", r#""$items""#),
            ]),
        );
        assert!(p.errors.is_empty(), "{:?}", p.errors);
        assert_eq!(
            p.shell,
            "db.orders.aggregate([\n  { $match: { status: \"A\", _id: ObjectId(\"507f1f77bcf86cd799439011\") } },\n  { $limit: 10 },\n  { $unwind: \"$items\" }\n])"
        );
        assert_eq!(p.canonical[1]["$limit"]["$numberLong"], "10");
        let json: serde_json::Value = serde_json::from_str(&p.json).unwrap();
        assert_eq!(json[0]["$match"]["_id"]["$oid"], "507f1f77bcf86cd799439011");
        assert_eq!(json[1]["$limit"], 10);
    }

    #[test]
    fn a_card_that_does_not_parse_is_named_with_its_line() {
        let p = compose_pipeline(
            "orders",
            &spec(vec![
                stage("a", "$match", "{ a: 1 }"),
                stage("b", "$group", "{\n  _id: \"$a\"\n  n: { $sum: 1 } }"),
                stage("c", "match", "{}"),
                stage("d", "$sort", "  "),
            ]),
        );
        let ids: Vec<&str> = p.errors.iter().map(|e| e.stage_id.as_str()).collect();
        assert_eq!(ids, ["b", "c", "d"]);
        assert!(p.errors[0].message.ends_with("(line 3)"), "{}", p.errors[0].message);
        assert!(p.errors[1].message.contains("starts with $"));
        assert_eq!(p.errors[2].message, "$sort needs a value");
    }

    #[test]
    fn disabled_cards_are_left_out_of_shell_and_json_but_kept_in_the_file() {
        let mut off = stage("b", "$sort", "{ n: -1 }");
        off.enabled = false;
        let mut titled = stage("a", "$match", "{}");
        titled.title = Some("Everything".into());
        titled.note = Some("first line\nsecond".into());
        let p = compose_pipeline("my orders", &spec(vec![titled, off]));
        assert_eq!(p.shell, "db.getCollection(\"my orders\").aggregate([\n  { $match: {} }\n])");
        assert_eq!(
            p.file,
            "db.getCollection(\"my orders\").aggregate([\n  // @title Everything\n  // first line\n  // second\n  { $match: {} }\n  // @disabled\n  // { $sort: { n: -1 } }\n])\n"
        );
    }

    #[test]
    fn a_write_stage_anywhere_but_last_is_an_error() {
        let p = compose_pipeline(
            "c",
            &spec(vec![stage("a", "$out", r#""copy""#), stage("b", "$match", "{}")]),
        );
        assert_eq!(p.errors.len(), 1);
        assert_eq!(p.errors[0].stage_id, "a");
        assert!(p.errors[0].message.contains("last stage"));

        let mut off = stage("b", "$match", "{}");
        off.enabled = false;
        let p = compose_pipeline("c", &spec(vec![stage("a", "$merge", r#"{ into: "x" }"#), off]));
        assert!(p.errors.is_empty(), "{:?}", p.errors);
    }

    #[test]
    fn long_values_break_onto_indented_lines() {
        let p = compose_pipeline(
            "c",
            &spec(vec![stage(
                "a",
                "$group",
                r#"{ _id: "$customer_id", total: { $sum: "$amount" }, orders: { $push: "$order_number" } }"#,
            )]),
        );
        assert_eq!(
            p.shell,
            "db.c.aggregate([\n  {\n    $group: {\n      _id: \"$customer_id\",\n      total: { $sum: \"$amount\" },\n      orders: { $push: \"$order_number\" }\n    }\n  }\n])"
        );
    }

    #[test]
    fn a_canonical_value_renders_as_the_body_compose_reads_back() {
        let value = serde_json::json!({
            "_id": { "$oid": "507f1f77bcf86cd799439011" },
            "n": { "$gt": { "$numberLong": "5" } },
            "r": { "$numberDouble": "1.5" },
        });
        let body = render_stage("$match", value).unwrap();
        assert_eq!(body, "{ _id: ObjectId(\"507f1f77bcf86cd799439011\"), n: { $gt: 5 }, r: 1.5 }");
        let p = compose_pipeline("c", &spec(vec![stage("a", "$match", &body)]));
        assert!(p.errors.is_empty(), "{:?}", p.errors);
        assert_eq!(p.canonical[0]["$match"]["n"]["$gt"]["$numberLong"], "5");

        assert_eq!(render_stage("$limit", serde_json::json!({ "$numberLong": "10" })).unwrap(), "10");
        assert_eq!(render_stage("$unwind", serde_json::json!("$items")).unwrap(), "\"$items\"");
        assert!(render_stage("$match", serde_json::json!({ "$oid": "nope" })).is_err());
    }

    #[test]
    fn doubles_and_quoted_keys_round_trip() {
        let p = compose_pipeline("c", &spec(vec![stage("a", "$set", r#"{ "a b": 2.0, r: 1.5 }"#)]));
        assert_eq!(p.shell, "db.c.aggregate([\n  { $set: { \"a b\": 2.0, r: 1.5 } }\n])");
        let back = parse(&quote_bare_keys("{ \"a b\": 2.0, r: 1.5 }")).unwrap();
        assert!(matches!(back.get("a b"), Some(Bson::Double(_))));
    }
}
