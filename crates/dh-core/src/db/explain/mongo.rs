//! MongoDB `explain` output to plan nodes. Pure: the adapter runs the
//! command and hands the reply (as relaxed JSON) here.
//!
//! Three reply shapes exist. A `find`, `count` or `distinct` gives
//! `queryPlanner` (and `executionStats` for an analyze). An aggregate gives
//! `stages`, each one stage of the pipeline, where `$cursor` carries the
//! `find` style plan of what the server reads first. A sharded cluster wraps
//! either one in `shards`, keyed by shard name. An aggregate the server can
//! answer entirely from one plan comes back as a plain `queryPlanner`.

use serde_json::Value;
use crate::api::PlanNode;

/// A filter or bounds text longer than this is cut, so one wide `$in` list
/// cannot blow up a row.
const MAX_CONDITION_CHARS: usize = 400;

/// Turn one explain reply into top level nodes (see [`super::finish`]).
/// `Err` carries the message for a reply of a shape this does not know.
pub(crate) fn plan_from_mongo(reply: &Value, analyze: bool) -> Result<Vec<PlanNode>, String> {
    if let Some(shards) = reply.get("shards").and_then(Value::as_object) {
        let children = shards
            .iter()
            .map(|(name, shard)| {
                let tops = plan_from_mongo(shard, analyze)?;
                Ok(PlanNode { label: name.clone(), children: tops, ..PlanNode::default() })
            })
            .collect::<Result<Vec<_>, String>>()?;
        return Ok(vec![PlanNode { label: "Shards".into(), children, ..PlanNode::default() }]);
    }
    if let Some(stages) = reply.get("stages").and_then(Value::as_array) {
        let children = stages.iter().map(|s| pipeline_stage(s, analyze)).collect::<Result<Vec<_>, _>>()?;
        return Ok(vec![PlanNode { label: "Pipeline".into(), children, ..PlanNode::default() }]);
    }
    if reply.get("queryPlanner").is_some() {
        return Ok(vec![query_plan(reply, analyze)?]);
    }
    Err("MongoDB answered with a plan in a shape Explain does not know how to show.".into())
}

/// One entry of an aggregate's `stages`: `{ "$match": {...}, nReturned, ... }`.
fn pipeline_stage(entry: &Value, analyze: bool) -> Result<PlanNode, String> {
    let Some(map) = entry.as_object() else {
        return Err("MongoDB answered with a pipeline stage Explain does not know how to show.".into());
    };
    let Some((name, body)) = map.iter().find(|(k, _)| k.starts_with('$')) else {
        return Err("MongoDB answered with a pipeline stage Explain does not know how to show.".into());
    };
    let mut node = PlanNode { label: name.clone(), ..PlanNode::default() };
    if name == "$cursor" {
        // The read that feeds the pipeline: its own find style plan.
        node.children.push(query_plan(body, analyze)?);
    } else {
        node.condition = compact(body);
    }
    if analyze {
        node.actual_rows = number(entry, "nReturned");
        node.actual_time_ms = number(entry, "executionTimeMillisEstimate");
    }
    Ok(node)
}

/// The plan under a `queryPlanner`: the executed stages for an analyze that
/// has them, else the winning plan.
fn query_plan(reply: &Value, analyze: bool) -> Result<PlanNode, String> {
    let namespace = reply
        .pointer("/queryPlanner/namespace")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let stage = analyze
        .then(|| reply.pointer("/executionStats/executionStages"))
        .flatten()
        .or_else(|| reply.pointer("/queryPlanner/winningPlan"))
        .ok_or("MongoDB answered without a winning plan.")?;
    Ok(stage_node(stage, namespace, analyze))
}

fn stage_node(stage: &Value, namespace: &str, analyze: bool) -> PlanNode {
    // The slot based engine nests the stage tree under `queryPlan`.
    let stage = match (stage.get("stage"), stage.get("queryPlan")) {
        (None, Some(inner)) => inner,
        _ => stage,
    };
    let name = stage.get("stage").and_then(Value::as_str).unwrap_or("STAGE");
    let target = match stage.get("indexName").and_then(Value::as_str) {
        Some(index) => index.to_string(),
        None if name == "COLLSCAN" => namespace.to_string(),
        None => String::new(),
    };
    let condition = match stage.get("filter") {
        Some(filter) => compact(filter),
        None if name.starts_with("IXSCAN") => stage.get("indexBounds").map(compact).unwrap_or_default(),
        None => String::new(),
    };
    let mut node = PlanNode { label: name.to_string(), target, condition, ..PlanNode::default() };
    if analyze {
        node.actual_rows = number(stage, "nReturned");
        node.actual_time_ms = number(stage, "executionTimeMillisEstimate");
    }
    let inputs = stage
        .get("inputStage")
        .into_iter()
        .chain(stage.get("inputStages").and_then(Value::as_array).into_iter().flatten());
    node.children = inputs.map(|s| stage_node(s, namespace, analyze)).collect();
    node
}

fn number(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(Value::as_f64)
}

fn compact(v: &Value) -> String {
    let text = v.to_string();
    if text.chars().count() <= MAX_CONDITION_CHARS {
        return text;
    }
    let cut: String = text.chars().take(MAX_CONDITION_CHARS).collect();
    format!("{cut}…")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tops(reply: Value, analyze: bool) -> PlanNode {
        let mut tops = plan_from_mongo(&reply, analyze).unwrap();
        assert_eq!(tops.len(), 1);
        tops.remove(0)
    }

    #[test]
    fn a_find_with_an_index_reads_stage_index_and_bounds() {
        let node = tops(
            json!({ "queryPlanner": { "namespace": "shop.orders", "winningPlan": {
                "stage": "FETCH", "filter": { "status": { "$eq": "open" } },
                "inputStage": { "stage": "IXSCAN", "indexName": "customer_1",
                    "indexBounds": { "customer": ["[7, 7]"] } } } } }),
            false,
        );
        assert_eq!((node.label.as_str(), node.target.as_str()), ("FETCH", ""));
        assert_eq!(node.condition, r#"{"status":{"$eq":"open"}}"#);
        let scan = &node.children[0];
        assert_eq!((scan.label.as_str(), scan.target.as_str()), ("IXSCAN", "customer_1"));
        assert_eq!(scan.condition, r#"{"customer":["[7, 7]"]}"#);
        assert_eq!(scan.actual_rows, None);
    }

    #[test]
    fn a_collection_scan_targets_the_namespace() {
        let node = tops(
            json!({ "queryPlanner": { "namespace": "shop.orders",
                "winningPlan": { "stage": "COLLSCAN", "direction": "forward" } } }),
            false,
        );
        assert_eq!(node.target, "shop.orders");
    }

    #[test]
    fn analyze_reads_the_executed_stages_with_rows_and_time() {
        let node = tops(
            json!({
                "queryPlanner": { "namespace": "a.b", "winningPlan": { "stage": "COLLSCAN" } },
                "executionStats": { "executionStages": {
                    "stage": "LIMIT", "nReturned": 5, "executionTimeMillisEstimate": 3,
                    "inputStage": { "stage": "COLLSCAN", "nReturned": 5, "executionTimeMillisEstimate": 2 } } }
            }),
            true,
        );
        assert_eq!((node.label.as_str(), node.actual_rows, node.actual_time_ms), ("LIMIT", Some(5.0), Some(3.0)));
        assert_eq!(node.children[0].actual_time_ms, Some(2.0));
    }

    #[test]
    fn a_slot_based_plan_is_read_through_query_plan() {
        let node = tops(
            json!({ "queryPlanner": { "namespace": "a.b", "winningPlan": {
                "queryPlan": { "stage": "COLLSCAN" }, "slotBasedPlan": { "slots": "..." } } } }),
            false,
        );
        assert_eq!(node.label, "COLLSCAN");
    }

    #[test]
    fn several_input_stages_become_several_children() {
        let node = tops(
            json!({ "queryPlanner": { "namespace": "a.b", "winningPlan": { "stage": "OR",
                "inputStages": [ { "stage": "IXSCAN", "indexName": "a_1" },
                                 { "stage": "IXSCAN", "indexName": "b_1" } ] } } }),
            false,
        );
        assert_eq!(node.children.len(), 2);
        assert_eq!(node.children[1].target, "b_1");
    }

    #[test]
    fn an_aggregate_is_a_pipeline_with_the_cursor_plan_under_its_stage() {
        let node = tops(
            json!({ "stages": [
                { "$cursor": { "queryPlanner": { "namespace": "a.b", "winningPlan": { "stage": "COLLSCAN" } },
                    "executionStats": { "executionStages": { "stage": "COLLSCAN", "nReturned": 9 } } },
                  "nReturned": 9, "executionTimeMillisEstimate": 4 },
                { "$group": { "_id": "$k" }, "nReturned": 3, "executionTimeMillisEstimate": 6 },
            ] }),
            true,
        );
        assert_eq!(node.label, "Pipeline");
        let cursor = &node.children[0];
        assert_eq!((cursor.label.as_str(), cursor.actual_rows), ("$cursor", Some(9.0)));
        assert_eq!(cursor.children[0].label, "COLLSCAN");
        let group = &node.children[1];
        assert_eq!((group.condition.as_str(), group.actual_time_ms), (r#"{"_id":"$k"}"#, Some(6.0)));
    }

    #[test]
    fn a_sharded_reply_has_one_child_per_shard() {
        let node = tops(
            json!({ "shards": {
                "s1": { "queryPlanner": { "namespace": "a.b", "winningPlan": { "stage": "COLLSCAN" } } },
                "s2": { "queryPlanner": { "namespace": "a.b", "winningPlan": { "stage": "FETCH" } } },
            } }),
            false,
        );
        assert_eq!(node.label, "Shards");
        assert_eq!(node.children.len(), 2);
        assert_eq!(node.children[0].children[0].label, "COLLSCAN");
    }

    #[test]
    fn an_unknown_shape_is_an_error() {
        assert!(plan_from_mongo(&json!({ "ok": 1 }), false).is_err());
    }

    #[test]
    fn a_long_condition_is_cut() {
        let long = json!({ "a": { "$in": (0..500).collect::<Vec<_>>() } });
        let node = tops(
            json!({ "queryPlanner": { "namespace": "a.b", "winningPlan": { "stage": "COLLSCAN", "filter": long } } }),
            false,
        );
        assert!(node.condition.ends_with('…'));
        assert_eq!(node.condition.chars().count(), MAX_CONDITION_CHARS + 1);
    }
}
