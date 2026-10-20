//! MySQL and MariaDB plans (spec 0025 AC-25) as [`PlanNode`]s. Three
//! outputs come in:
//!
//! - `EXPLAIN FORMAT=JSON`, on both flavors: a `query_block` holding
//!   operations (`ordering_operation`, `filesort`, `nested_loop`, ...) down
//!   to `table` steps. MariaDB's `ANALYZE FORMAT=JSON` is the same shape
//!   with `r_` fields for what really happened. MySQL 8.3+ with
//!   `explain_json_format_version = 2` sends an `operation`/`inputs` tree
//!   instead, which is read too.
//! - MySQL `EXPLAIN ANALYZE`: an indented text tree, one `-> step` per line.

use serde_json::{Map, Value};
use crate::api::PlanNode;

/// Keys that hold one operation step, with the label it shows as.
const OPERATIONS: &[(&str, &str)] = &[
    ("ordering_operation", "Sort"),
    ("grouping_operation", "Group"),
    ("duplicates_removal", "Remove duplicates"),
    ("filesort", "Sort"),
    ("temporary_table", "Temporary table"),
    ("windowing", "Window"),
    ("window_functions_computation", "Window"),
    ("union_result", "Union"),
    ("except_result", "Except"),
    ("intersect_result", "Intersect"),
    ("materialized_from_subquery", "Materialize"),
    ("block-nl-join", "Block nested loop"),
    ("read_sorted_file", "Read sorted file"),
    ("buffer_result", "Buffer result"),
];

/// The JSON a plan came back as.
pub(crate) fn plan_from_json(text: &str) -> Result<Vec<PlanNode>, String> {
    let value: Value =
        serde_json::from_str(text).map_err(|e| format!("The plan could not be read: {e}"))?;
    let Value::Object(top) = value else {
        return Err("The plan could not be read: it is not a JSON object.".into());
    };
    if top.contains_key("operation") {
        return Ok(vec![v2_node(&top)]);
    }
    Ok(walk(&top))
}

fn num(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        // MySQL quotes its costs: `"query_cost": "2.48"`.
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn text(v: Option<&Value>) -> Option<String> {
    match v? {
        Value::String(s) => Some(s.clone()),
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().filter_map(|i| i.as_str().map(str::to_string)).collect();
            (!parts.is_empty()).then(|| parts.join(", "))
        }
        _ => None,
    }
}

/// Every step found under `obj`, in the order its keys come.
fn walk(obj: &Map<String, Value>) -> Vec<PlanNode> {
    let mut out = Vec::new();
    for (key, value) in obj {
        match (key.as_str(), value) {
            ("query_block", Value::Object(b)) => out.push(query_block(b)),
            ("table", Value::Object(t)) => out.push(table(t)),
            ("nested_loop", Value::Array(items)) => {
                let steps: Vec<PlanNode> = items.iter().flat_map(walk_value).collect();
                if steps.len() > 1 {
                    out.push(PlanNode { label: "Nested loop".into(), children: steps, ..PlanNode::default() });
                } else {
                    out.extend(steps);
                }
            }
            (k, Value::Object(o)) => match OPERATIONS.iter().find(|(name, _)| *name == k) {
                Some((_, label)) => out.push(operation(label, o)),
                // Anything else (`cost_info`, `r_engine_stats`, a subquery
                // wrapper) may still hold steps further down.
                None => out.extend(walk(o)),
            },
            (_, Value::Array(items)) => out.extend(items.iter().flat_map(walk_value)),
            _ => {}
        }
    }
    out
}

fn walk_value(v: &Value) -> Vec<PlanNode> {
    match v {
        Value::Object(o) => walk(o),
        _ => Vec::new(),
    }
}

/// The `r_` fields MariaDB's analyze adds: rows and loops are per loop, the
/// time is the total, as on Postgres.
fn analyzed(node: &mut PlanNode, o: &Map<String, Value>) {
    node.loops = num(o.get("r_loops"));
    node.actual_rows = num(o.get("r_rows"));
    node.actual_time_ms = num(o.get("r_total_time_ms")).or_else(|| {
        let table = num(o.get("r_table_time_ms"));
        let other = num(o.get("r_other_time_ms"));
        (table.is_some() || other.is_some()).then(|| table.unwrap_or(0.0) + other.unwrap_or(0.0))
    });
}

fn query_block(b: &Map<String, Value>) -> PlanNode {
    let id = b.get("select_id").and_then(Value::as_u64);
    let mut node = PlanNode {
        label: match id {
            Some(id) => format!("Query block #{id}"),
            None => "Query block".into(),
        },
        total_cost: num(b.get("cost_info").and_then(|c| c.get("query_cost"))).or_else(|| num(b.get("cost"))),
        condition: condition_lines(b),
        children: walk(b),
        ..PlanNode::default()
    };
    if let Some(message) = text(b.get("message")) {
        node.label = message;
    }
    analyzed(&mut node, b);
    node
}

fn operation(label: &str, o: &Map<String, Value>) -> PlanNode {
    let mut node = PlanNode {
        label: label.to_string(),
        target: text(o.get("table_name")).unwrap_or_default(),
        condition: condition_lines(o),
        total_cost: num(o.get("cost_info").and_then(|c| c.get("sort_cost"))).or_else(|| num(o.get("cost"))),
        children: walk(o),
        ..PlanNode::default()
    };
    analyzed(&mut node, o);
    node
}

/// What `access_type` means, in words.
fn access_label(access: &str) -> String {
    match access {
        "ALL" => "Table scan".into(),
        "index" => "Index scan".into(),
        "range" => "Index range scan".into(),
        "ref" | "ref_or_null" => "Index lookup".into(),
        "eq_ref" => "Unique index lookup".into(),
        "const" | "system" => "Single row lookup".into(),
        "index_merge" => "Index merge".into(),
        "fulltext" => "Full text search".into(),
        "unique_subquery" | "index_subquery" => "Subquery index lookup".into(),
        "hash" => "Hash join".into(),
        other => other.to_string(),
    }
}

fn table(t: &Map<String, Value>) -> PlanNode {
    let name = text(t.get("table_name")).unwrap_or_default();
    let target = match text(t.get("key")) {
        Some(key) if !name.is_empty() => format!("{name} using {key}"),
        _ => name,
    };
    let label = match (text(t.get("access_type")), text(t.get("message"))) {
        (Some(access), _) => access_label(&access),
        (None, Some(message)) => message,
        (None, None) => "Table".into(),
    };
    let cost = t.get("cost_info");
    let mut node = PlanNode {
        label,
        target,
        condition: condition_lines(t),
        total_cost: num(cost.and_then(|c| c.get("prefix_cost"))).or_else(|| num(t.get("cost"))),
        est_rows: num(t.get("rows_examined_per_scan")).or_else(|| num(t.get("rows"))),
        children: walk(t),
        ..PlanNode::default()
    };
    analyzed(&mut node, t);
    node
}

/// Conditions and keys, one named line each.
fn condition_lines(o: &Map<String, Value>) -> String {
    let named = [
        ("ref", "Ref"),
        ("index_condition", "Index condition"),
        ("attached_condition", "Filter"),
        ("having_condition", "Having"),
        ("sort_key", "Sort key"),
        ("condition", "Condition"),
    ];
    named
        .iter()
        .filter_map(|(key, name)| text(o.get(*key)).map(|v| format!("{name}: {v}")))
        .collect::<Vec<_>>()
        .join("\n")
}

/// One step of the version 2 JSON format.
fn v2_node(o: &Map<String, Value>) -> PlanNode {
    let table = text(o.get("table_name")).unwrap_or_default();
    let target = match text(o.get("index_name")) {
        Some(index) if !table.is_empty() => format!("{table} using {index}"),
        _ => table,
    };
    let mut children: Vec<PlanNode> = Vec::new();
    for key in ["inputs", "subqueries"] {
        if let Some(Value::Array(items)) = o.get(key) {
            children.extend(items.iter().filter_map(Value::as_object).map(v2_node));
        }
    }
    PlanNode {
        label: text(o.get("operation")).unwrap_or_else(|| "Step".into()),
        target,
        condition: text(o.get("condition")).map(|c| format!("Condition: {c}")).unwrap_or_default(),
        startup_cost: num(o.get("estimated_first_row_cost")),
        total_cost: num(o.get("estimated_total_cost")),
        est_rows: num(o.get("estimated_rows")),
        children,
        ..PlanNode::default()
    }
}

/// MySQL `EXPLAIN ANALYZE` text: `-> step  (cost=.. rows=..) (actual
/// time=a..b rows=r loops=l)`, nested four spaces a level. A line that
/// doesn't start with `->` continues the step above it.
pub(crate) fn plan_from_tree(text: &str) -> Vec<PlanNode> {
    // (depth, node) for the open path from the root to the current step.
    let mut stack: Vec<(usize, PlanNode)> = Vec::new();
    let mut tops = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim_start();
        let Some(step) = trimmed.strip_prefix("->") else {
            if let Some((_, last)) = stack.last_mut() {
                if !trimmed.is_empty() {
                    last.label.push(' ');
                    last.label.push_str(trimmed.trim_end());
                }
            }
            continue;
        };
        let depth = (line.len() - trimmed.len()) / 4;
        let node = tree_step(step.trim());
        while stack.last().is_some_and(|(d, _)| *d >= depth) {
            close(&mut stack, &mut tops);
        }
        stack.push((depth, node));
    }
    while !stack.is_empty() {
        close(&mut stack, &mut tops);
    }
    tops
}

fn close(stack: &mut Vec<(usize, PlanNode)>, tops: &mut Vec<PlanNode>) {
    let Some((_, node)) = stack.pop() else { return };
    match stack.last_mut() {
        Some((_, parent)) => parent.children.push(node),
        None => tops.push(node),
    }
}

/// One `-> ...` line without the arrow.
fn tree_step(step: &str) -> PlanNode {
    let mut node = PlanNode::default();
    let mut head = step;
    if let Some(at) = step.find("(actual time=") {
        let inner = paren_body(&step[at..]);
        let (_, last) = span(field(inner, "time="));
        node.loops = field(inner, "loops=").and_then(|v| v.parse().ok());
        node.actual_rows = field(inner, "rows=").and_then(|v| v.parse().ok());
        node.actual_time_ms = last.map(|t| t * node.loops.unwrap_or(1.0));
        head = &step[..at];
    } else if let Some(at) = step.find("(never executed)") {
        node.loops = Some(0.0);
        head = &step[..at];
    }
    if let Some(at) = head.find("(cost=") {
        let inner = paren_body(&head[at..]);
        let (first, last) = span(field(inner, "cost="));
        (node.startup_cost, node.total_cost) = if last.is_some() { (first, last) } else { (None, first) };
        node.est_rows = field(inner, "rows=").and_then(|v| v.parse().ok());
        head = &head[..at];
    }
    let head = head.trim();
    // `Filter: (a.n > 1)` keeps its condition apart, unless the colon is in
    // the lookup after ` on ` (`... on t using k (k='a: b')`).
    let colon = head.find(": ");
    if let Some(at) = colon.filter(|c| head.find(" on ").is_none_or(|on| *c < on)) {
        node.label = head[..at].trim().to_string();
        node.condition = format!("{}: {}", node.label, head[at + 2..].trim());
        return node;
    }
    // `Index lookup on a using n (n=1)`: the step, its table and key, and the
    // lookup in parentheses.
    match head.split_once(" on ") {
        Some((label, rest)) => {
            node.label = label.trim().to_string();
            match rest.find(" (") {
                Some(at) if rest.ends_with(')') => {
                    node.target = rest[..at].trim().to_string();
                    node.condition = format!("Lookup: {}", rest[at..].trim());
                }
                _ => node.target = rest.trim().to_string(),
            }
        }
        None => node.label = head.to_string(),
    }
    node
}

/// The text inside the parentheses `s` starts with.
fn paren_body(s: &str) -> &str {
    let body = s.strip_prefix('(').unwrap_or(s);
    body.find(')').map_or(body, |end| &body[..end])
}

/// The value after `name` in `a=1 b=2`, up to the next space.
fn field<'a>(inner: &'a str, name: &str) -> Option<&'a str> {
    let at = inner.split_whitespace().find_map(|w| w.strip_prefix(name))?;
    Some(at)
}

/// `0.25..0.45` as both ends, `0.45` as the first only.
fn span(v: Option<&str>) -> (Option<f64>, Option<f64>) {
    match v {
        Some(v) => match v.split_once("..") {
            Some((a, b)) => (a.parse().ok(), b.parse().ok()),
            None => (v.parse().ok(), None),
        },
        None => (None, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MYSQL_JSON: &str = r#"{"query_block": {"select_id": 1, "cost_info": {"query_cost": "2.48"},
      "ordering_operation": {"using_filesort": true, "cost_info": {"sort_cost": "1.33"},
        "nested_loop": [
          {"table": {"table_name": "b", "access_type": "ALL", "rows_examined_per_scan": 2,
            "cost_info": {"prefix_cost": "0.45"}, "attached_condition": "(`b`.`a_id` is not null)"}},
          {"table": {"table_name": "a", "access_type": "eq_ref", "key": "PRIMARY",
            "ref": ["dh_test.b.a_id"], "rows_examined_per_scan": 1,
            "cost_info": {"prefix_cost": "1.15"}, "attached_condition": "(`a`.`n` > 1)"}}
        ]}}}"#;

    #[test]
    fn a_mysql_estimate_keeps_the_steps_costs_and_conditions() {
        let tops = plan_from_json(MYSQL_JSON).unwrap();
        let block = &tops[0];
        assert_eq!((block.label.as_str(), block.total_cost), ("Query block #1", Some(2.48)));
        let sort = &block.children[0];
        assert_eq!((sort.label.as_str(), sort.total_cost), ("Sort", Some(1.33)));
        let join = &sort.children[0];
        assert_eq!(join.label, "Nested loop");
        let (b, a) = (&join.children[0], &join.children[1]);
        assert_eq!((b.label.as_str(), b.target.as_str(), b.est_rows), ("Table scan", "b", Some(2.0)));
        assert_eq!(b.condition, "Filter: (`b`.`a_id` is not null)");
        assert_eq!((a.label.as_str(), a.target.as_str()), ("Unique index lookup", "a using PRIMARY"));
        assert_eq!(a.condition, "Ref: dh_test.b.a_id\nFilter: (`a`.`n` > 1)");
        assert_eq!(a.total_cost, Some(1.15));
    }

    #[test]
    fn a_mariadb_analyze_reads_the_real_rows_loops_and_time() {
        let json = r#"{"query_optimization": {"r_total_time_ms": 0.09},
          "query_block": {"select_id": 1, "cost": 0.015, "r_loops": 1, "r_total_time_ms": 0.44,
            "filesort": {"sort_key": "a.n", "r_loops": 1, "r_total_time_ms": 0.005,
              "temporary_table": {"nested_loop": [
                {"table": {"table_name": "b", "access_type": "ALL", "loops": 1, "r_loops": 1, "rows": 2,
                  "r_rows": 2, "cost": 0.011, "r_table_time_ms": 0.02, "r_other_time_ms": 0.4,
                  "attached_condition": "b.a_id is not null"}}]}}}}"#;
        let tops = plan_from_json(json).unwrap();
        assert_eq!(tops.len(), 1, "query_optimization holds no steps");
        let block = &tops[0];
        assert_eq!((block.total_cost, block.actual_time_ms, block.loops), (Some(0.015), Some(0.44), Some(1.0)));
        let sort = &block.children[0];
        assert_eq!((sort.label.as_str(), sort.condition.as_str()), ("Sort", "Sort key: a.n"));
        let tmp = &sort.children[0];
        assert_eq!(tmp.label, "Temporary table");
        let b = &tmp.children[0];
        assert_eq!((b.est_rows, b.actual_rows, b.loops), (Some(2.0), Some(2.0), Some(1.0)));
        assert!((b.actual_time_ms.unwrap() - 0.42).abs() < 1e-9);
    }

    #[test]
    fn unions_subqueries_and_messages_become_steps() {
        let json = r#"{"query_block": {"union_result": {"table_name": "<union1,2>", "access_type": "ALL",
            "query_specifications": [
              {"query_block": {"select_id": 1, "message": "No tables used"}},
              {"query_block": {"select_id": 2, "table": {"message": "No tables used"}}}]}}}"#;
        let tops = plan_from_json(json).unwrap();
        let union = &tops[0].children[0];
        assert_eq!((union.label.as_str(), union.target.as_str()), ("Union", "<union1,2>"));
        assert_eq!(union.children.len(), 2);
        assert_eq!(union.children[0].label, "No tables used");
        assert_eq!(union.children[1].children[0].label, "No tables used");
        assert!(plan_from_json("[1]").is_err());
        assert!(plan_from_json("not json").is_err());
    }

    #[test]
    fn the_version_2_format_is_read_too() {
        let json = r#"{"query": "select ...", "operation": "Nested loop inner join",
            "estimated_rows": 1.33, "estimated_total_cost": 1.15, "inputs": [
              {"operation": "Table scan on b", "table_name": "b", "estimated_rows": 2, "estimated_total_cost": 0.45},
              {"operation": "Single-row index lookup on a using PRIMARY", "table_name": "a", "index_name": "PRIMARY",
               "condition": "id = b.a_id"}]}"#;
        let top = &plan_from_json(json).unwrap()[0];
        assert_eq!((top.label.as_str(), top.total_cost, top.est_rows), ("Nested loop inner join", Some(1.15), Some(1.33)));
        assert_eq!(top.children[1].target, "a using PRIMARY");
        assert_eq!(top.children[1].condition, "Condition: id = b.a_id");
    }

    const TREE: &str = "-> Sort: a.n  (actual time=5.11..5.11 rows=1 loops=1)
    -> Stream results  (cost=1.15 rows=1.33) (actual time=4.33..4.34 rows=1 loops=1)
        -> Nested loop inner join  (cost=1.15 rows=1.33) (actual time=4.32..4.32 rows=1 loops=1)
            -> Filter: (b.a_id is not null)  (cost=0.45 rows=2) (actual time=1.07..1.07 rows=2 loops=1)
                -> Table scan on b  (cost=0.45 rows=2) (actual time=1.07..1.07 rows=2 loops=1)
            -> Filter: (a.n > 1)  (cost=0.283 rows=0.667) (actual time=0.393..0.393 rows=0.5 loops=2)
                -> Single-row index lookup on a using PRIMARY (id=b.a_id)  (cost=0.283 rows=1) (actual time=0.00344..0.00346 rows=1 loops=2)
";

    #[test]
    fn mysql_explain_analyze_text_nests_by_indent() {
        let tops = plan_from_tree(TREE);
        assert_eq!(tops.len(), 1);
        let sort = &tops[0];
        assert_eq!((sort.label.as_str(), sort.condition.as_str()), ("Sort", "Sort: a.n"));
        assert_eq!((sort.actual_rows, sort.loops, sort.total_cost), (Some(1.0), Some(1.0), None));
        let join = &sort.children[0].children[0];
        assert_eq!(join.label, "Nested loop inner join");
        assert_eq!((join.total_cost, join.est_rows), (Some(1.15), Some(1.33)));
        assert_eq!(join.children.len(), 2);
        let scan = &join.children[0].children[0];
        assert_eq!((scan.label.as_str(), scan.target.as_str()), ("Table scan", "b"));
        let lookup = &join.children[1].children[0];
        assert_eq!(lookup.label, "Single-row index lookup");
        assert_eq!(lookup.target, "a using PRIMARY");
        assert_eq!(lookup.condition, "Lookup: (id=b.a_id)");
        // The per loop time times the loops.
        assert!((lookup.actual_time_ms.unwrap() - 0.00692).abs() < 1e-9);
    }

    #[test]
    fn never_executed_steps_and_cost_ranges_are_read() {
        let tops = plan_from_tree(
            "-> Limit: 1 row(s)  (cost=0.25..0.45 rows=1)\n    -> Table scan on t  (cost=0.45 rows=2) (never executed)\n",
        );
        let limit = &tops[0];
        assert_eq!((limit.startup_cost, limit.total_cost), (Some(0.25), Some(0.45)));
        assert_eq!(limit.children[0].loops, Some(0.0));
        assert!(plan_from_tree("").is_empty());
        let odd = &plan_from_tree("-> Index lookup on t using k (k='a: b')  (cost=0.35 rows=1)")[0];
        assert_eq!((odd.label.as_str(), odd.target.as_str()), ("Index lookup", "t using k"));
    }
}
