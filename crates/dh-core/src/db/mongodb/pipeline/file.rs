//! The Save format: the shell text with each card's title, note and
//! disabled state as comments, side chain cards included, so `parse` reads
//! back the same cards.

use bson::{Bson, Document};
use crate::api::{PipelineSpec, StageSpec};
use super::compose::{
    branch_stage_doc, branching, doc_text, main_stage_doc, splice, stage_doc, Branching, SIDE_TOKEN,
};

pub(super) fn file_text(target: &str, spec: &PipelineSpec) -> String {
    let items = marked_items(&spec.stages, 1, &|s| main_text(s, 1));
    let body = if items.is_empty() { "[]".to_string() } else { format!("[\n{}\n]", items.join("\n")) };
    format!("{target}.aggregate({body})\n")
}

/// Each card at `depth`: its `// @title` and note lines, then the stage, or
/// `// @disabled` and the stage commented out. The last enabled card has no
/// comma. `text_of` gives a stage's text with its first line unindented.
fn marked_items(stages: &[StageSpec], depth: usize, text_of: &dyn Fn(&StageSpec) -> String) -> Vec<String> {
    let pad = "  ".repeat(depth);
    let last_enabled = stages.iter().rposition(|s| s.enabled);
    stages
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let mut lines: Vec<String> = Vec::new();
            if let Some(title) = s.title.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
                lines.push(format!("{pad}// @title {}", title.replace('\n', " ")));
            }
            if let Some(note) = s.note.as_deref().filter(|n| !n.trim().is_empty()) {
                lines.extend(note.lines().map(|l| format!("{pad}// {l}").trim_end().to_string()));
            }
            let text = text_of(s);
            if s.enabled {
                let comma = if Some(i) == last_enabled { "" } else { "," };
                lines.push(format!("{pad}{text}{comma}"));
            } else {
                lines.push(format!("{pad}// @disabled"));
                lines.extend(text.lines().enumerate().map(|(k, l)| {
                    let l = if k == 0 { l } else { l.strip_prefix(pad.as_str()).unwrap_or(l) };
                    format!("{pad}// {l}")
                }));
            }
            lines.join("\n")
        })
        .collect()
}

/// A card as typed, for one that does not compose.
fn raw_text(s: &StageSpec) -> String {
    format!("{{ {}: {} }}", s.op.trim(), s.body.trim())
}

fn has_marks(s: &StageSpec) -> bool {
    let set = |v: &Option<String>| v.as_deref().is_some_and(|t| !t.trim().is_empty());
    !s.enabled || set(&s.title) || set(&s.note)
}

/// A main chain card at `depth`. Side chains whose cards carry no marks are
/// spliced in as they compose; otherwise each side chain is written card by
/// card in its parent's place.
fn main_text(s: &StageSpec, depth: usize) -> String {
    let marked = branching(&s.op).is_some() && s.branches.iter().any(|b| b.stages.iter().any(has_marks));
    if !marked {
        return match main_stage_doc(s, &mut Vec::new()) {
            Some(d) => doc_text(&d, depth),
            None => raw_text(s),
        };
    }
    // Splice empty side chains to check the parent holds them, then put a
    // token in each one's place.
    let empty: Vec<(&str, Vec<Document>)> = s.branches.iter().map(|b| (b.key.as_str(), Vec::new())).collect();
    let Ok(mut held) = stage_doc(s).and_then(|d| splice(d, &empty)) else {
        return raw_text(s);
    };
    let op = s.op.trim();
    let facet = branching(op) == Some(Branching::Facet);
    if let Some(Bson::Document(v)) = held.get_mut(op) {
        for (i, b) in s.branches.iter().enumerate() {
            v.insert(if facet { b.key.as_str() } else { "pipeline" }, format!("{SIDE_TOKEN}{i}"));
        }
    }
    let mut text = doc_text(&held, depth);
    for (i, b) in s.branches.iter().enumerate() {
        let holder = format!("\"{SIDE_TOKEN}{i}\"");
        let Some(at) = text.find(&holder) else { continue };
        let line_start = text[..at].rfind('\n').map_or(0, |n| n + 1);
        let line_depth = if line_start == 0 {
            depth
        } else {
            text[line_start..].chars().take_while(|c| *c == ' ').count() / 2
        };
        let items = marked_items(&b.stages, line_depth + 1, &|c| match branch_stage_doc(c) {
            Ok(d) => doc_text(&d, line_depth + 1),
            Err(_) => raw_text(c),
        });
        let array = if items.is_empty() {
            "[]".to_string()
        } else {
            format!("[\n{}\n{}]", items.join("\n"), "  ".repeat(line_depth))
        };
        text.replace_range(at..at + holder.len(), &array);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::api::BranchSpec;

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
    fn side_chain_cards_keep_their_marks() {
        let mut off = stage("t2", "$limit", "3");
        off.enabled = false;
        let mut sorted = stage("t1", "$sort", "{ n: -1 }");
        sorted.title = Some("Biggest".into());
        let mut facet = stage("f", "$facet", "{}");
        facet.branches = vec![
            BranchSpec { key: "top".into(), stages: vec![sorted, off] },
            BranchSpec { key: "none".into(), stages: vec![] },
        ];
        let text = file_text("db.c", &PipelineSpec { stages: vec![facet] });
        assert_eq!(
            text,
            "db.c.aggregate([\n  {\n    $facet: {\n      top: [\n        // @title Biggest\n        { $sort: { n: -1 } }\n        // @disabled\n        // { $limit: 3 }\n      ],\n      none: []\n    }\n  }\n])\n"
        );
    }
}
