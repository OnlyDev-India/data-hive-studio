//! SQLite's `EXPLAIN QUERY PLAN` rows `(id, parent, notused, detail)` into
//! [`PlanNode`]s. SQLite gives no costs or row counts, only a text detail.

use std::collections::HashMap;
use crate::api::PlanNode;

/// One row: its id, its parent's id (0 for a top row) and the detail text.
pub(crate) type QueryPlanRow = (i64, i64, String);

/// Top level nodes, in the order SQLite listed them.
pub(crate) fn plan_from_rows(rows: &[QueryPlanRow]) -> Vec<PlanNode> {
    let mut kids: HashMap<i64, Vec<usize>> = HashMap::new();
    let known: Vec<i64> = rows.iter().map(|r| r.0).collect();
    let mut tops = Vec::new();
    for (i, (_, parent, _)) in rows.iter().enumerate() {
        if known.contains(parent) {
            kids.entry(*parent).or_default().push(i);
        } else {
            tops.push(i);
        }
    }
    tops.into_iter().map(|i| build(rows, &kids, i, 0)).collect()
}

/// A `parent` chain can never really loop, but a bad row must not recurse
/// forever, so the depth is bounded.
const MAX_DEPTH: usize = 200;

fn build(rows: &[QueryPlanRow], kids: &HashMap<i64, Vec<usize>>, at: usize, depth: usize) -> PlanNode {
    let (id, _, detail) = &rows[at];
    let mut node = node_from_detail(detail);
    if depth < MAX_DEPTH {
        node.children = kids
            .get(id)
            .map(|list| list.iter().map(|&i| build(rows, kids, i, depth + 1)).collect())
            .unwrap_or_default();
    }
    node
}

/// `SCAN t`, `SEARCH t USING INDEX i (a=?)` and their older `TABLE` forms
/// split into verb, target and condition. Any other detail (`USE TEMP B-TREE
/// FOR ORDER BY`, `CO-ROUTINE x`) is kept whole as the label.
fn node_from_detail(detail: &str) -> PlanNode {
    let detail = detail.trim();
    let split = ["SCAN", "SEARCH"]
        .into_iter()
        .find_map(|verb| detail.strip_prefix(verb).and_then(|r| r.strip_prefix(' ')).map(|r| (verb, r)));
    let Some((verb, rest)) = split else {
        return PlanNode { label: detail.into(), ..PlanNode::default() };
    };
    let rest = rest.strip_prefix("TABLE ").unwrap_or(rest);
    if rest.starts_with("CONSTANT ROW") {
        return PlanNode { label: detail.into(), ..PlanNode::default() };
    }
    let (table, using) = rest.split_once(" USING ").unwrap_or((rest, ""));
    let (index, condition) = match using.strip_suffix(')').and_then(|u| u.rsplit_once(" (")) {
        Some((index, condition)) => (index, condition),
        None => (using, ""),
    };
    let index = index_name(index);
    let target = if index.is_empty() { table.to_string() } else { format!("{index} on {table}") };
    PlanNode { label: verb.into(), target, condition: condition.into(), ..PlanNode::default() }
}

fn index_name(using: &str) -> String {
    let using = using.trim();
    if using == "INTEGER PRIMARY KEY" {
        "primary key".into()
    } else if using == "AUTOMATIC COVERING INDEX" {
        "automatic index".into()
    } else if let Some(name) = using.strip_prefix("COVERING INDEX ") {
        format!("{name} (covering)")
    } else if let Some(name) = using.strip_prefix("INDEX ") {
        name.into()
    } else {
        using.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(list: &[(i64, i64, &str)]) -> Vec<QueryPlanRow> {
        list.iter().map(|(a, b, c)| (*a, *b, c.to_string())).collect()
    }

    #[test]
    fn a_scan_has_a_verb_and_a_target() {
        let tops = plan_from_rows(&rows(&[(2, 0, "SCAN users")]));
        assert_eq!((tops[0].label.as_str(), tops[0].target.as_str()), ("SCAN", "users"));
        assert!(tops[0].condition.is_empty());
    }

    #[test]
    fn a_search_names_its_index_and_condition() {
        let tops = plan_from_rows(&rows(&[(3, 0, "SEARCH orders USING INDEX idx_user (user_id=? AND day>?)")]));
        assert_eq!(tops[0].label, "SEARCH");
        assert_eq!(tops[0].target, "idx_user on orders");
        assert_eq!(tops[0].condition, "user_id=? AND day>?");
    }

    #[test]
    fn the_older_and_special_index_forms_read_the_same() {
        let tops = plan_from_rows(&rows(&[
            (1, 0, "SEARCH TABLE t USING INTEGER PRIMARY KEY (rowid=?)"),
            (2, 0, "SCAN t USING COVERING INDEX i_a"),
            (3, 0, "SEARCH t USING AUTOMATIC COVERING INDEX (a=?)"),
        ]));
        assert_eq!(tops[0].target, "primary key on t");
        assert_eq!(tops[1].target, "i_a (covering) on t");
        assert_eq!(tops[2].target, "automatic index on t");
    }

    #[test]
    fn other_details_stay_whole_and_children_follow_parent_ids() {
        let tops = plan_from_rows(&rows(&[
            (2, 0, "CO-ROUTINE x"),
            (5, 2, "SCAN t"),
            (9, 0, "USE TEMP B-TREE FOR ORDER BY"),
        ]));
        assert_eq!(tops.len(), 2);
        assert_eq!(tops[0].label, "CO-ROUTINE x");
        assert_eq!(tops[0].children[0].target, "t");
        assert_eq!(tops[1].label, "USE TEMP B-TREE FOR ORDER BY");
    }
}
