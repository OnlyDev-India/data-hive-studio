//! Which cards a preview refresh runs, and the whole pipeline each one runs.

use bson::{doc, Bson, Document};
use crate::api::{BranchSpec, PipelinePreviewRequest};
use super::compose::{branch_stage_doc, branching, is_write_op, splice, stage_doc, Branching};
use super::write_stage;

/// Stages the server only takes first in a pipeline; the cap goes after one.
const FIRST_STAGES: &[&str] =
    &["$geoNear", "$search", "$searchMeta", "$vectorSearch", "$collStats", "$indexStats"];

/// One card to preview.
pub(super) struct Target {
    /// Its place among the targets, the index `deps` name it by.
    pub ord: usize,
    pub stage_id: String,
    pub branch_key: Option<String>,
    /// The collection a `$unionWith` side chain reads, instead of the request's.
    pub collection: Option<String>,
    /// The targets this one reads through: one failing stops it.
    pub deps: Vec<usize>,
    /// The pipeline, cap and tail included, or why the card fails. Empty
    /// when it waits on an earlier card that does not compose.
    pub pipeline: Result<Vec<Document>, String>,
}

/// `[cap, ...prefix, tail]`, the cap after a stage that must come first.
pub(super) fn target_pipeline(prefix: &[Document], cap: u64, show: u32) -> Vec<Document> {
    let cap_stage = doc! { "$limit": cap as i64 };
    let first_only = prefix
        .first()
        .and_then(|d| d.keys().next())
        .is_some_and(|op| FIRST_STAGES.contains(&op.as_str()));
    let mut out = Vec::with_capacity(prefix.len() + 2);
    if first_only {
        out.push(prefix[0].clone());
        out.push(cap_stage);
        out.extend(prefix[1..].iter().cloned());
    } else {
        out.push(cap_stage);
        out.extend(prefix.iter().cloned());
    }
    out.push(doc! { "$facet": {
        "docs": [{ "$limit": show as i64 }],
        "count": [{ "$count": "n" }],
    } });
    out
}

/// Where a refresh starts, by place in the main chain (disabled cards
/// counted) and, for a side chain card, by place in its chain.
#[derive(Clone, Copy)]
enum Start<'a> {
    All,
    Main(usize),
    Branch { parent: usize, key: &'a str, from: usize },
}

fn start_of(req: &PipelinePreviewRequest) -> Start<'_> {
    let Some(f) = &req.from else {
        return Start::All;
    };
    let stages = &req.spec.stages;
    if let Some(p) = stages.iter().position(|s| s.id == f.stage_id) {
        return Start::Main(p);
    }
    for (parent, s) in stages.iter().enumerate() {
        for b in &s.branches {
            if let Some(from) = b.stages.iter().position(|x| x.id == f.stage_id) {
                return Start::Branch { parent, key: &b.key, from };
            }
        }
    }
    Start::All
}

fn checked(p: Vec<Document>, cap: u64, show: u32) -> Result<Vec<Document>, String> {
    match write_stage(&p) {
        Some(op) => Err(format!("A preview never writes, and this pipeline has a {op} stage")),
        None => Ok(target_pipeline(&p, cap, show)),
    }
}

/// What a side chain's cards read through: the parent stage, the main chain
/// before it, and whether that chain composes.
struct Side<'a> {
    kind: Branching,
    parent: &'a Result<Document, String>,
    prefix: &'a [Document],
    broken: bool,
    deps: &'a [usize],
    cap: u64,
    show: u32,
}

impl Side<'_> {
    /// The pipeline of the side chain card ending `docs`, and the collection
    /// it runs on when that is not the request's. A `$facet` output runs on
    /// the parent's input; a `$lookup` card runs the parent with its
    /// pipeline cut there, then opens up the joined documents; a
    /// `$unionWith` card runs on the `coll` collection alone.
    fn pipeline(&self, docs: &[Document]) -> (Result<Vec<Document>, String>, Option<String>) {
        let (cap, show) = (self.cap, self.show);
        if self.kind == Branching::Facet {
            let mut p = self.prefix.to_vec();
            p.extend(docs.iter().cloned());
            return (checked(p, cap, show), None);
        }
        let Ok(parent) = self.parent else {
            return (Err(String::new()), None);
        };
        let Ok(spliced) = splice(parent.clone(), &[("pipeline", docs.to_vec())]) else {
            return (Err(String::new()), None);
        };
        if self.kind == Branching::Lookup {
            let Some(at) = parent.get_document("$lookup").ok().and_then(|l| l.get_str("as").ok()) else {
                return (Err("Name the field in as to preview this side chain".into()), None);
            };
            let path = format!("${at}");
            let mut p = self.prefix.to_vec();
            p.push(spliced);
            p.push(doc! { "$unwind": path.clone() });
            p.push(doc! { "$replaceRoot": { "newRoot": path } });
            return (checked(p, cap, show), None);
        }
        let coll = match parent.get("$unionWith") {
            Some(Bson::String(c)) => Some(c.clone()),
            Some(Bson::Document(d)) => d.get_str("coll").ok().map(str::to_string),
            _ => None,
        };
        match coll {
            Some(c) => (checked(docs.to_vec(), cap, show), Some(c)),
            None => (Err("Name the collection in coll to preview this side chain".into()), None),
        }
    }
}

/// Push a target for every enabled card of side chain `b` from place `from`
/// on (none when `None`), adding each to `parent_deps`. Returns the chain's
/// cards that compose, for the parent, and whether one does not.
fn branch_targets(
    side: &Side,
    b: &BranchSpec,
    from: Option<usize>,
    out: &mut Vec<Target>,
    parent_deps: &mut Vec<usize>,
) -> (Vec<Document>, bool) {
    let mut docs = Vec::new();
    let mut failed = false;
    // A `$unionWith` side chain never reads the main chain.
    let reads_main = side.kind != Branching::UnionWith;
    let mut deps: Vec<usize> = if reads_main { side.deps.to_vec() } else { Vec::new() };
    for (j, s) in b.stages.iter().enumerate() {
        if !s.enabled {
            continue;
        }
        let own = branch_stage_doc(s);
        let waits = failed || (reads_main && side.broken);
        failed |= own.is_err();
        if let Ok(d) = &own {
            docs.push(d.clone());
        }
        if !from.is_some_and(|f| j >= f) {
            continue;
        }
        let (pipeline, collection) = match own {
            _ if waits => (Err(String::new()), None),
            Err(e) => (Err(e), None),
            Ok(_) => side.pipeline(&docs),
        };
        let ord = out.len();
        out.push(Target {
            ord,
            stage_id: s.id.clone(),
            branch_key: Some(b.key.clone()),
            collection,
            deps: deps.clone(),
            pipeline,
        });
        deps.push(ord);
        parent_deps.push(ord);
    }
    (docs, failed)
}

/// The cards a refresh runs, in chain order, each side chain before its
/// parent. From a main card: it and every later enabled card, side chains
/// included. From a side chain card: the rest of that chain, then its parent
/// and every later main card. A write stage is never one, and a card that
/// does not compose is one that fails, so the cards reading through it wait.
pub(super) fn targets(req: &PipelinePreviewRequest) -> Vec<Target> {
    let start = start_of(req);
    let (cap, show) = (req.cap, req.show);
    let mut out: Vec<Target> = Vec::new();
    let mut prefix: Vec<Document> = Vec::new();
    // A main card so far does not compose, so every later one waits.
    let mut broken = false;
    // The targets every later main card reads through.
    let mut deps: Vec<usize> = Vec::new();
    for (i, s) in req.spec.stages.iter().enumerate() {
        if !s.enabled {
            continue;
        }
        let op = s.op.trim();
        let own = stage_doc(s);
        let mut parent_deps = deps.clone();
        let mut spliced: Vec<(&str, Vec<Document>)> = Vec::new();
        let mut branch_failed = false;
        if let Some(kind) = branching(op) {
            let side = Side { kind, parent: &own, prefix: &prefix, broken, deps: &deps, cap, show };
            for b in &s.branches {
                let from = match start {
                    Start::All => Some(0),
                    Start::Main(p) => (i >= p).then_some(0),
                    Start::Branch { parent, key, from } if parent == i => (key == b.key).then_some(from),
                    Start::Branch { parent, .. } => (i > parent).then_some(0),
                };
                let (docs, failed) = branch_targets(&side, b, from, &mut out, &mut parent_deps);
                branch_failed |= failed;
                spliced.push((b.key.as_str(), docs));
            }
        }
        let composed = match own {
            Err(e) => Err(e),
            Ok(_) if branch_failed => Err(String::new()),
            Ok(d) => splice(d, &spliced),
        };
        if let Ok(d) = &composed {
            prefix.push(d.clone());
        }
        let in_range = match start {
            Start::All => true,
            Start::Main(p) => i >= p,
            Start::Branch { parent, .. } => i >= parent,
        };
        if !in_range || is_write_op(op) {
            broken |= composed.is_err();
            deps = parent_deps;
            continue;
        }
        let pipeline = match (broken, composed) {
            (true, _) => Err(String::new()),
            (false, Err(e)) => {
                broken = true;
                Err(e)
            }
            (false, Ok(_)) => checked(prefix.clone(), cap, show),
        };
        let ord = out.len();
        out.push(Target { ord, stage_id: s.id.clone(), branch_key: None, collection: None, deps: parent_deps.clone(), pipeline });
        deps = parent_deps;
        deps.push(ord);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::{PipelineSpec, StageRef, StageSpec};

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

    fn branched(mut s: StageSpec, branches: Vec<(&str, Vec<StageSpec>)>) -> StageSpec {
        s.branches = branches.into_iter().map(|(k, stages)| BranchSpec { key: k.into(), stages }).collect();
        s
    }

    fn request(stages: Vec<StageSpec>, from: Option<(&str, Option<&str>)>) -> PipelinePreviewRequest {
        PipelinePreviewRequest {
            database: "d".into(),
            collection: "c".into(),
            spec: PipelineSpec { stages },
            from: from.map(|(id, key)| StageRef { stage_id: id.into(), branch_key: key.map(str::to_string) }),
            cap: 1000,
            time_ms: 10_000,
            show: 20,
            concurrency: 4,
            run_id: None,
        }
    }

    fn main_from(stages: Vec<StageSpec>, from: Option<&str>) -> PipelinePreviewRequest {
        request(stages, from.map(|id| (id, None)))
    }

    fn ids(ts: &[Target]) -> Vec<&str> {
        ts.iter().map(|t| t.stage_id.as_str()).collect()
    }

    #[test]
    fn each_target_runs_its_prefix_under_the_cap_with_the_facet_tail() {
        let ts = targets(&main_from(vec![stage("a", "$match", "{ a: 1 }"), stage("b", "$limit", "5")], None));
        assert_eq!(ids(&ts), ["a", "b"]);
        let p = ts[1].pipeline.as_ref().unwrap();
        assert_eq!(p[0], doc! { "$limit": 1000_i64 });
        assert_eq!(p[1], doc! { "$match": { "a": 1_i64 } });
        assert_eq!(p[2], doc! { "$limit": 5_i64 });
        assert!(p[3].contains_key("$facet"));
        assert_eq!(p.len(), 4);
        assert_eq!(ts[1].deps, [0]);
    }

    #[test]
    fn the_cap_goes_after_a_stage_that_must_be_first() {
        let p = target_pipeline(&[doc! { "$geoNear": {} }, doc! { "$match": {} }], 10, 20);
        assert!(p[0].contains_key("$geoNear"));
        assert_eq!(p[1], doc! { "$limit": 10_i64 });
    }

    #[test]
    fn a_refresh_from_a_card_runs_it_and_every_later_enabled_card() {
        let mut off = stage("c", "$sort", "{ a: 1 }");
        off.enabled = false;
        let ts = targets(&main_from(
            vec![stage("a", "$match", "{}"), stage("b", "$match", "{}"), off, stage("d", "$skip", "1")],
            Some("b"),
        ));
        assert_eq!(ids(&ts), ["b", "d"]);
        assert_eq!(ts[1].pipeline.as_ref().unwrap().len(), 5);
    }

    #[test]
    fn a_card_that_does_not_compose_fails_and_the_cards_behind_it_wait() {
        let ts = targets(&main_from(
            vec![stage("a", "$match", "{}"), stage("b", "$match", "{ a: }"), stage("c", "$skip", "1")],
            None,
        ));
        assert!(ts[0].pipeline.is_ok());
        assert!(!ts[1].pipeline.as_ref().unwrap_err().is_empty());
        assert_eq!(ts[2].pipeline.as_ref().unwrap_err(), "");
    }

    #[test]
    fn a_broken_card_before_the_refresh_start_still_blocks_it() {
        let ts = targets(&main_from(vec![stage("a", "$match", "{ a: }"), stage("b", "$skip", "1")], Some("b")));
        assert_eq!(ts[0].pipeline.as_ref().unwrap_err(), "");
    }

    #[test]
    fn write_stages_are_never_previewed_and_a_nested_one_is_refused() {
        let ts = targets(&main_from(
            vec![
                stage("a", "$lookup", r#"{ from: "x", as: "y", pipeline: [{ $merge: { into: "z" } }] }"#),
                stage("b", "$out", r#""copy""#),
            ],
            None,
        ));
        assert_eq!(ids(&ts), ["a"]);
        assert!(ts[0].pipeline.as_ref().unwrap_err().contains("$merge"));
    }

    fn facet() -> StageSpec {
        branched(
            stage("f", "$facet", "{}"),
            vec![
                ("top", vec![stage("t1", "$sort", "{ n: -1 }"), stage("t2", "$limit", "3")]),
                ("all", vec![stage("c1", "$count", "\"n\"")]),
            ],
        )
    }

    #[test]
    fn a_facet_output_card_runs_on_the_parents_input() {
        let ts = targets(&main_from(vec![stage("m", "$match", "{ a: 1 }"), facet(), stage("z", "$skip", "1")], None));
        assert_eq!(ids(&ts), ["m", "t1", "t2", "c1", "f", "z"]);
        let t2 = ts[2].pipeline.as_ref().unwrap();
        assert_eq!(t2[1], doc! { "$match": { "a": 1_i64 } });
        assert_eq!(t2[2], doc! { "$sort": { "n": -1_i64 } });
        assert_eq!(t2[3], doc! { "$limit": 3_i64 });
        assert_eq!(ts[2].branch_key.as_deref(), Some("top"));
        assert_eq!(ts[2].deps, [0, 1], "reads through the main chain and its own chain");
        assert_eq!(ts[3].deps, [0], "another output does not read through top");
        assert_eq!(ts[4].deps, [0, 1, 2, 3]);
        let f = ts[4].pipeline.as_ref().unwrap();
        assert_eq!(f[2].get_document("$facet").unwrap().get_array("top").unwrap().len(), 2);
        assert_eq!(ts[5].deps, [0, 1, 2, 3, 4]);
    }

    #[test]
    fn a_refresh_from_a_side_chain_card_runs_the_rest_of_it_then_the_parent_on() {
        let ts = targets(&request(
            vec![stage("m", "$match", "{}"), facet(), stage("z", "$skip", "1")],
            Some(("t2", Some("top"))),
        ));
        assert_eq!(ids(&ts), ["t2", "f", "z"]);
        let ts = targets(&main_from(vec![stage("m", "$match", "{}"), facet()], Some("f")));
        assert_eq!(ids(&ts), ["t1", "t2", "c1", "f"]);
    }

    #[test]
    fn a_lookup_side_card_shows_the_joined_documents() {
        let lookup = branched(
            stage("l", "$lookup", r#"{ from: "items", let: { o: "$_id" }, as: "lines" }"#),
            vec![("pipeline", vec![stage("p1", "$match", "{ q: 1 }"), stage("p2", "$limit", "2")])],
        );
        let ts = targets(&main_from(vec![lookup], None));
        assert_eq!(ids(&ts), ["p1", "p2", "l"]);
        let p = ts[0].pipeline.as_ref().unwrap();
        let joined = p[1].get_document("$lookup").unwrap();
        assert_eq!(joined.get_array("pipeline").unwrap().len(), 1, "cut at the card");
        assert_eq!(joined.get_str("from").unwrap(), "items");
        assert_eq!(p[2], doc! { "$unwind": "$lines" });
        assert_eq!(p[3], doc! { "$replaceRoot": { "newRoot": "$lines" } });
        assert!(ts[0].collection.is_none());
    }

    #[test]
    fn a_union_side_card_runs_on_its_own_collection_whatever_the_main_chain() {
        let union = branched(stage("u", "$unionWith", r#""archive""#), vec![("pipeline", vec![stage("a1", "$limit", "5")])]);
        let ts = targets(&main_from(vec![stage("m", "$match", "{ a: }"), union], None));
        assert_eq!(ids(&ts), ["m", "a1", "u"]);
        assert_eq!(ts[1].collection.as_deref(), Some("archive"));
        let p = ts[1].pipeline.as_ref().unwrap();
        assert_eq!(p[0], doc! { "$limit": 1000_i64 });
        assert_eq!(p[1], doc! { "$limit": 5_i64 });
        assert!(ts[1].deps.is_empty());
        assert_eq!(ts[2].pipeline.as_ref().unwrap_err(), "", "the parent waits on the broken $match");
    }

    #[test]
    fn a_side_card_that_does_not_compose_holds_back_its_chain_the_parent_and_after() {
        let f = branched(
            stage("f", "$facet", "{}"),
            vec![
                ("top", vec![stage("t1", "$match", "{ a: }"), stage("t2", "$limit", "3")]),
                ("all", vec![stage("c1", "$count", "\"n\"")]),
            ],
        );
        let ts = targets(&main_from(vec![f, stage("z", "$skip", "1")], None));
        assert_eq!(ids(&ts), ["t1", "t2", "c1", "f", "z"]);
        assert!(!ts[0].pipeline.as_ref().unwrap_err().is_empty());
        assert_eq!(ts[1].pipeline.as_ref().unwrap_err(), "");
        assert!(ts[2].pipeline.is_ok(), "the other output still runs");
        assert_eq!(ts[3].pipeline.as_ref().unwrap_err(), "");
        assert_eq!(ts[4].pipeline.as_ref().unwrap_err(), "");
    }

    #[test]
    fn a_write_stage_in_a_side_chain_is_refused() {
        let lookup = branched(
            stage("l", "$lookup", r#"{ from: "x", as: "y" }"#),
            vec![("pipeline", vec![stage("w", "$merge", r#"{ into: "z" }"#)])],
        );
        let ts = targets(&main_from(vec![lookup], None));
        assert!(ts[0].pipeline.as_ref().unwrap_err().contains("main pipeline"));
        assert_eq!(ts[1].pipeline.as_ref().unwrap_err(), "");
    }
}
