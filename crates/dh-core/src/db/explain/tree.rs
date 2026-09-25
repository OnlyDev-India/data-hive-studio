//! Shared finishing step for every engine's parser: one root, unique ids, and
//! the node cap.

use crate::api::PlanNode;

/// A plan larger than this is cut and marked truncated.
pub const MAX_PLAN_NODES: usize = 5000;

/// Turn parsed top level nodes into the single tree a [`PlanResult`] holds.
/// Several tops share a synthetic "QUERY PLAN" root. Ids are assigned in
/// reading order, and nodes past [`MAX_PLAN_NODES`] are dropped.
///
/// [`PlanResult`]: crate::api::PlanResult
pub(crate) fn finish(mut roots: Vec<PlanNode>) -> (Option<PlanNode>, bool) {
    let mut root = match roots.len() {
        0 => return (None, false),
        1 => roots.remove(0),
        _ => PlanNode { label: "QUERY PLAN".into(), children: roots, ..PlanNode::default() },
    };
    let mut next = 0u32;
    let mut truncated = false;
    number(&mut root, &mut next, &mut truncated);
    (Some(root), truncated)
}

fn number(node: &mut PlanNode, next: &mut u32, truncated: &mut bool) {
    *next += 1;
    node.id = *next;
    let mut kept = Vec::with_capacity(node.children.len());
    for mut child in std::mem::take(&mut node.children) {
        if *next as usize >= MAX_PLAN_NODES {
            *truncated = true;
            break;
        }
        number(&mut child, next, truncated);
        kept.push(child);
    }
    node.children = kept;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf(label: &str) -> PlanNode {
        PlanNode { label: label.into(), ..PlanNode::default() }
    }

    fn count(n: &PlanNode) -> usize {
        1 + n.children.iter().map(count).sum::<usize>()
    }

    #[test]
    fn several_tops_get_a_synthetic_root_and_unique_ids() {
        let (root, truncated) = finish(vec![leaf("a"), leaf("b")]);
        let root = root.unwrap();
        assert!(!truncated);
        assert_eq!(root.label, "QUERY PLAN");
        assert_eq!((root.id, root.children[0].id, root.children[1].id), (1, 2, 3));
    }

    #[test]
    fn one_top_is_the_root_and_none_is_empty() {
        assert_eq!(finish(vec![leaf("only")]).0.unwrap().label, "only");
        assert!(finish(vec![]).0.is_none());
    }

    #[test]
    fn a_tree_past_the_cap_is_cut_and_marked() {
        let wide = PlanNode {
            label: "top".into(),
            children: (0..6000).map(|i| leaf(&i.to_string())).collect(),
            ..PlanNode::default()
        };
        let (root, truncated) = finish(vec![wide]);
        assert!(truncated);
        assert_eq!(count(&root.unwrap()), MAX_PLAN_NODES);
    }
}
