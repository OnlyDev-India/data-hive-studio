//! PostgreSQL's `EXPLAIN (FORMAT JSON)` output into [`PlanNode`]s.

use serde_json::Value;
use crate::api::PlanNode;

/// The JSON parser stops at 128 levels, and so does this.
const MAX_DEPTH: usize = 128;

const CONDITIONS: &[&str] = &[
    "Index Cond",
    "Recheck Cond",
    "Hash Cond",
    "Merge Cond",
    "Join Filter",
    "Filter",
];

/// The output is an array holding one object with a `Plan`.
pub(crate) fn plan_from_json(output: &Value) -> Result<Vec<PlanNode>, String> {
    let plan = output
        .get(0)
        .and_then(|first| first.get("Plan"))
        .ok_or_else(|| "The database returned a plan in a shape Explain does not know.".to_string())?;
    Ok(vec![node(plan, 0)?])
}

fn node(plan: &Value, depth: usize) -> Result<PlanNode, String> {
    if depth >= MAX_DEPTH {
        return Err(TOO_DEEP.into());
    }
    let text = |key: &str| plan.get(key).and_then(Value::as_str).unwrap_or("");
    let number = |key: &str| plan.get(key).and_then(Value::as_f64);
    let loops = number("Actual Loops");
    let mut children = Vec::new();
    if let Some(list) = plan.get("Plans").and_then(Value::as_array) {
        for child in list {
            children.push(node(child, depth + 1)?);
        }
    }
    Ok(PlanNode {
        id: 0,
        label: label(plan),
        target: target(plan),
        condition: CONDITIONS
            .iter()
            .filter_map(|name| {
                let cond = text(name);
                (!cond.is_empty()).then(|| format!("{name}: {cond}"))
            })
            .collect::<Vec<_>>()
            .join("\n"),
        startup_cost: number("Startup Cost"),
        total_cost: number("Total Cost"),
        est_rows: number("Plan Rows"),
        actual_rows: number("Actual Rows"),
        // The per loop time times the loops is the total, and it already
        // includes the children.
        actual_time_ms: number("Actual Total Time").map(|t| t * loops.unwrap_or(1.0)),
        loops,
        children,
    })
}

pub(crate) const TOO_DEEP: &str = "This plan is nested too deeply to show.";

fn label(plan: &Value) -> String {
    let text = |key: &str| plan.get(key).and_then(Value::as_str).unwrap_or("");
    let kind = text("Node Type");
    let detail = match (text("Strategy"), text("Join Type")) {
        ("", "" | "Inner") => "",
        ("", join) => join,
        (strategy, _) => strategy,
    };
    if detail.is_empty() { kind.into() } else { format!("{kind} ({detail})") }
}

fn target(plan: &Value) -> String {
    let text = |key: &str| plan.get(key).and_then(Value::as_str).unwrap_or("");
    let relation = match (text("Relation Name"), text("Alias")) {
        ("", _) => String::new(),
        (name, alias) if !alias.is_empty() && alias != name => format!("{name} {alias}"),
        (name, _) => name.into(),
    };
    match (text("Index Name"), relation.as_str()) {
        ("", "") => ["CTE Name", "Function Name", "Subplan Name"]
            .iter()
            .map(|k| text(k))
            .find(|v| !v.is_empty())
            .unwrap_or("")
            .into(),
        ("", rel) => rel.into(),
        (index, "") => index.into(),
        (index, rel) => format!("{index} on {rel}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_join_over_two_scans_keeps_costs_targets_and_conditions() {
        let output = json!([{ "Plan": {
            "Node Type": "Hash Join", "Join Type": "Left", "Startup Cost": 1.5, "Total Cost": 42.0,
            "Plan Rows": 100, "Hash Cond": "(a.id = b.a_id)",
            "Plans": [
                { "Node Type": "Seq Scan", "Relation Name": "orders", "Alias": "a", "Plan Rows": 10, "Filter": "(x > 1)" },
                { "Node Type": "Index Scan", "Index Name": "b_pk", "Relation Name": "b", "Alias": "b",
                  "Index Cond": "(id = 1)", "Filter": "(y)" }
            ]
        }}]);
        let top = plan_from_json(&output).unwrap().remove(0);
        assert_eq!(top.label, "Hash Join (Left)");
        assert_eq!((top.startup_cost, top.total_cost, top.est_rows), (Some(1.5), Some(42.0), Some(100.0)));
        assert_eq!(top.condition, "Hash Cond: (a.id = b.a_id)");
        assert_eq!(top.children[0].target, "orders a");
        assert_eq!(top.children[0].condition, "Filter: (x > 1)");
        assert_eq!(top.children[1].target, "b_pk on b");
        assert_eq!(top.children[1].condition, "Index Cond: (id = 1)\nFilter: (y)");
        assert_eq!(top.children[1].total_cost, None);
    }

    #[test]
    fn an_inner_join_and_a_strategy_read_as_expected() {
        let inner = json!([{ "Plan": { "Node Type": "Nested Loop", "Join Type": "Inner" }}]);
        assert_eq!(plan_from_json(&inner).unwrap()[0].label, "Nested Loop");
        let agg = json!([{ "Plan": { "Node Type": "Aggregate", "Strategy": "Hashed" }}]);
        assert_eq!(plan_from_json(&agg).unwrap()[0].label, "Aggregate (Hashed)");
    }

    #[test]
    fn cte_function_and_subplan_names_are_targets() {
        let cte = json!([{ "Plan": { "Node Type": "CTE Scan", "CTE Name": "x" }}]);
        assert_eq!(plan_from_json(&cte).unwrap()[0].target, "x");
        let sub = json!([{ "Plan": { "Node Type": "Result", "Subplan Name": "SubPlan 1" }}]);
        assert_eq!(plan_from_json(&sub).unwrap()[0].target, "SubPlan 1");
    }

    #[test]
    fn analyze_time_is_the_total_across_loops() {
        let output = json!([{ "Plan": {
            "Node Type": "Index Scan", "Actual Rows": 3, "Actual Total Time": 0.5, "Actual Loops": 4
        }}]);
        let node = plan_from_json(&output).unwrap().remove(0);
        assert_eq!((node.actual_rows, node.actual_time_ms, node.loops), (Some(3.0), Some(2.0), Some(4.0)));
    }

    #[test]
    fn an_unknown_shape_and_a_too_deep_plan_are_errors() {
        assert!(plan_from_json(&json!({})).is_err());
        let mut deep = json!({ "Node Type": "Result" });
        for _ in 0..MAX_DEPTH {
            deep = json!({ "Node Type": "Result", "Plans": [deep] });
        }
        assert_eq!(plan_from_json(&json!([{ "Plan": deep }])).unwrap_err(), TOO_DEEP);
    }
}
