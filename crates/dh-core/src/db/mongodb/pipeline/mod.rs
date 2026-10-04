//! The aggregation builder's pipeline engine: `compose` turns the cards into
//! stage documents and every text form, `preview` runs each card on a capped
//! slice of the collection, `run` streams the whole pipeline.

mod compose;
mod file;
mod marks;
mod parse;
mod preview;
mod run;
mod targets;
#[cfg(test)]
mod live_tests;

pub use compose::{compose_pipeline, render_stage};
pub use parse::{parse_pipeline, stage_array};
pub use preview::preview_activity_text;

use bson::{Bson, Document};
use crate::api::{GridFilterCond, PipelineSpec, StageSpec};
use crate::db::DbResult;
use super::filter::build_filter;

/// The first `$out` or `$merge` anywhere in `stages`, sub pipelines included.
pub(super) fn write_stage(stages: &[Document]) -> Option<&'static str> {
    fn in_doc(d: &Document) -> Option<&'static str> {
        for (k, v) in d {
            match k.as_str() {
                "$out" => return Some("$out"),
                "$merge" => return Some("$merge"),
                _ => {}
            }
            if let Some(op) = in_value(v) {
                return Some(op);
            }
        }
        None
    }
    fn in_value(v: &Bson) -> Option<&'static str> {
        match v {
            Bson::Document(d) => in_doc(d),
            Bson::Array(items) => items.iter().find_map(in_value),
            _ => None,
        }
    }
    stages.iter().find_map(in_doc)
}

/// The write stage the enabled cards hold, at any depth and in any place, if any.
pub fn spec_write_stage(spec: &PipelineSpec) -> Option<&'static str> {
    let enabled = |s: &&StageSpec| s.enabled;
    let docs: Vec<Document> = spec
        .stages
        .iter()
        .filter(enabled)
        .flat_map(|s| std::iter::once(s).chain(s.branches.iter().flat_map(|b| b.stages.iter().filter(enabled))))
        .filter_map(|s| compose::stage_doc(s).ok())
        .collect();
    write_stage(&docs)
}

/// A collection grid's filter as the body of a `$match` card, or `None` when
/// the grid has no filter.
pub fn filter_to_match(filters: &[GridFilterCond], custom_where: Option<&str>) -> DbResult<Option<String>> {
    Ok(build_filter(filters, custom_where)?.map(|d| compose::body_text(&d)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::FilterOp;

    #[test]
    fn a_grid_filter_becomes_a_match_body_and_no_filter_none() {
        let cond = GridFilterCond {
            column: "status".into(),
            op: FilterOp::Eq,
            value: "A".into(),
            values: vec![],
            conjunction: None,
        };
        assert_eq!(filter_to_match(&[cond], None).unwrap().as_deref(), Some("{ status: \"A\" }"));
        assert_eq!(filter_to_match(&[], Some("  ")).unwrap(), None);
        assert_eq!(
            filter_to_match(&[], Some("{_id: ObjectId(\"507f1f77bcf86cd799439011\")}")).unwrap().as_deref(),
            Some("{ _id: ObjectId(\"507f1f77bcf86cd799439011\") }")
        );
    }

    #[test]
    fn a_write_stage_is_found_at_any_depth() {
        let stages = vec![bson::doc! { "$facet": { "a": [{ "$merge": "x" }] } }];
        assert_eq!(write_stage(&stages), Some("$merge"));
        assert_eq!(write_stage(&[bson::doc! { "$match": { "$out": 1 } }]), Some("$out"));
        assert_eq!(write_stage(&[bson::doc! { "$match": {} }]), None);
    }

    #[test]
    fn a_write_stage_out_of_place_still_counts_for_the_read_only_guard() {
        let stage = |id: &str, op: &str, body: &str| StageSpec {
            id: id.into(),
            op: op.into(),
            body: body.into(),
            enabled: true,
            title: None,
            note: None,
            branches: vec![],
        };
        let spec = PipelineSpec { stages: vec![stage("a", "$out", r#""x""#), stage("b", "$match", "{}")] };
        assert_eq!(spec_write_stage(&spec), Some("$out"));
        let mut lookup = stage("l", "$lookup", r#"{ from: "x", as: "y" }"#);
        lookup.branches =
            vec![crate::api::BranchSpec { key: "pipeline".into(), stages: vec![stage("w", "$merge", r#"{ into: "z" }"#)] }];
        assert_eq!(spec_write_stage(&PipelineSpec { stages: vec![lookup] }), Some("$merge"));
    }
}
