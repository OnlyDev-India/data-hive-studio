use crate::api::{FieldKeyTruncation, FieldShape};
use std::collections::{BTreeSet, HashMap};
use super::convert::bson_type_name;

// ---- Nested field tree (spec 0001, "Fields" view) --------------------------
//
// Two passes over the up to 200 sampled documents: `accumulate_field_tree`
// walks each document, recording per dot-path stats into `FieldTreeAccum`;
// `build_field_children`/`build_field_node` then turn those stats into the
// `FieldShape` tree returned to the frontend. Kept as free functions (not
// adapter methods) since they operate purely on the accumulated stats, not
// the connection.

/// 6 levels of nesting are shown; accumulation walks one level further (see
/// the `depth > FIELD_TREE_MAX_DEPTH` guard below) purely to detect whether
/// a depth-6 node has real children to report as `depth_truncated`, without
/// ever rendering that extra level.
const FIELD_TREE_MAX_DEPTH: usize = 6;

/// Elements sampled per array, per document (spec 0001).
const FIELD_TREE_MAX_ARRAY_ELEMENTS: usize = 20;

/// Distinct keys shown per nested object before a `truncated` marker takes
/// over (spec 0001, AC-5). Not applied to the collection's own top-level
/// field list — see `sample_field_tree`.
const FIELD_TREE_MAX_KEYS_PER_OBJECT: usize = 50;

/// Total `FieldShape` nodes a single `field_tree` call may build, across
/// every level, so a pathological document (where the depth, key, and array
/// caps combine multiplicatively) can't produce an unbounded payload.
pub(super) const FIELD_TREE_NODE_BUDGET: usize = 2000;

type FieldTypeCounts = HashMap<&'static str, usize>;

#[derive(Default)]
pub(super) struct FieldTreeStat {
    /// Histogram of BSON types observed at this path — the most common one
    /// is reported as `FieldShape::bson_type`; never rendered as a union.
    type_counts: FieldTypeCounts,
    /// Times this path had a value, out of its parent's `container_count`
    /// (or the sample size, for a top-level path) — the numerator/denominator
    /// pair `FieldShape::optional` compares.
    present_count: usize,
    /// Times this path was itself walked as a container (an object, or an
    /// array whose element was an object) — the denominator for ITS OWN
    /// children's `optional` calculation.
    container_count: usize,
    /// Histogram of BSON types observed among this path's sampled array
    /// elements (only meaningful when `type_counts` says "array").
    element_type_counts: FieldTypeCounts,
}

#[derive(Default)]
pub(super) struct FieldTreeAccum {
    /// Full dot path → its stats.
    stats: HashMap<String, FieldTreeStat>,
    /// Parent dot path (`""` for the document root) → its immediate
    /// children's full dot paths.
    pub(super) children: HashMap<String, BTreeSet<String>>,
}

/// Walk one container instance (a sampled document when `prefix` is `""`, or
/// a nested object/array-object-element otherwise), recording its fields
/// into `accum`. `depth` is `prefix`'s own nesting depth (0 for the document
/// root); an object's dot path doubles as an array's element path, matching
/// MongoDB's own dot-notation query semantics, so object and array-of-object
/// children share one path scheme.
pub(super) fn accumulate_field_tree(obj: &bson::Document, prefix: &str, depth: usize, accum: &mut FieldTreeAccum) {
    if !prefix.is_empty() {
        accum.stats.entry(prefix.to_string()).or_default().container_count += 1;
    }
    // See FIELD_TREE_MAX_DEPTH's doc comment: `>` (not `>=`) lets a depth-6
    // container's OWN fields be recorded, one level of lookahead past what
    // gets rendered, so the depth-6 `FieldShape` can still report
    // `depth_truncated` accurately instead of always reading "no children".
    if depth > FIELD_TREE_MAX_DEPTH {
        return;
    }
    for (k, v) in obj.iter() {
        let path = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
        accum.children.entry(prefix.to_string()).or_default().insert(path.clone());
        {
            let stat = accum.stats.entry(path.clone()).or_default();
            stat.present_count += 1;
            *stat.type_counts.entry(bson_type_name(v)).or_insert(0) += 1;
        }
        match v {
            bson::Bson::Document(child) => {
                accumulate_field_tree(child, &path, depth + 1, accum);
            }
            bson::Bson::Array(arr) => {
                for el in arr.iter().take(FIELD_TREE_MAX_ARRAY_ELEMENTS) {
                    {
                        let stat = accum.stats.entry(path.clone()).or_default();
                        *stat.element_type_counts.entry(bson_type_name(el)).or_insert(0) += 1;
                    }
                    if let bson::Bson::Document(el_obj) = el {
                        accumulate_field_tree(el_obj, &path, depth + 1, accum);
                    }
                }
            }
            _ => {}
        }
    }
}

/// The single most common BSON type at a path — ties broken alphabetically
/// for determinism (`FieldShape::bson_type` is never a union; see AC-4).
fn most_common_field_type(counts: &FieldTypeCounts) -> String {
    let mut ranked: Vec<(&&'static str, &usize)> = counts.iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
    ranked.first().map(|(t, _)| t.to_string()).unwrap_or_else(|| "bson".into())
}

/// The union of BSON types observed among a path's sampled array elements,
/// most common first, ties broken alphabetically (AC-3).
fn ranked_element_types(counts: &FieldTypeCounts) -> Vec<String> {
    let mut ranked: Vec<(&&'static str, &usize)> = counts.iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
    ranked.into_iter().map(|(t, _)| t.to_string()).collect()
}

/// Builds one path's `FieldShape`, recursing into its children unless it
/// sits at the depth-6 boundary or the node budget has run out.
fn build_field_node(
    path: &str,
    depth: usize,
    denom: usize,
    accum: &FieldTreeAccum,
    budget: &mut usize,
) -> FieldShape {
    let stat = &accum.stats[path];
    let name = path.rsplit('.').next().unwrap_or(path).to_string();
    let bson_type = most_common_field_type(&stat.type_counts);
    let optional = stat.present_count < denom;
    let has_children_data = accum.children.get(path).is_some_and(|s| !s.is_empty());
    let element_total: usize = stat.element_type_counts.values().sum();

    if depth >= FIELD_TREE_MAX_DEPTH {
        // Boundary node: report its own name/type/optional, but omit
        // children/element_types outright rather than partially populate
        // them — `depth_truncated` is only true when there was real content
        // being hidden (see the doc comment on `FIELD_TREE_MAX_DEPTH`'s
        // one-level accumulation lookahead, which makes `has_children_data`
        // and `element_total` reliable here, not just "we never looked").
        let depth_truncated = has_children_data || element_total > 0;
        let empty = (bson_type == "object" && !has_children_data)
            || (bson_type == "array" && element_total == 0);
        return FieldShape {
            name,
            path: path.to_string(),
            bson_type,
            optional,
            children: Vec::new(),
            element_types: Vec::new(),
            truncated: None,
            empty,
            depth_truncated,
        };
    }

    let (children, truncated, budget_hit) = if bson_type == "object" || bson_type == "array" {
        build_field_children(
            path,
            depth + 1,
            stat.container_count,
            Some(FIELD_TREE_MAX_KEYS_PER_OBJECT),
            accum,
            budget,
        )
    } else {
        (Vec::new(), None, false)
    };
    let element_types = if bson_type == "array" {
        ranked_element_types(&stat.element_type_counts)
    } else {
        Vec::new()
    };
    let empty = (bson_type == "object" && !has_children_data)
        || (bson_type == "array" && element_total == 0);

    FieldShape {
        name,
        path: path.to_string(),
        bson_type,
        optional,
        children,
        element_types,
        truncated,
        empty,
        depth_truncated: budget_hit,
    }
}

/// Builds every immediate child of `parent_path` (`""` for the document
/// root), ranked most-present-first (the ranking AC-5's "50 most common
/// keys" cap uses), applying `cap` (`None` for the root's own field list,
/// which is never truncated — see `sample_field_tree`) and the shared node
/// `budget`. Returns the built children, the key-count truncation marker (if
/// `cap` was exceeded), and whether the node budget cut this list short.
pub(super) fn build_field_children(
    parent_path: &str,
    depth: usize,
    denom: usize,
    cap: Option<usize>,
    accum: &FieldTreeAccum,
    budget: &mut usize,
) -> (Vec<FieldShape>, Option<FieldKeyTruncation>, bool) {
    let Some(set) = accum.children.get(parent_path) else {
        return (Vec::new(), None, false);
    };
    let mut ranked: Vec<&String> = set.iter().collect();
    ranked.sort_by(|a, b| {
        let pa = accum.stats[a.as_str()].present_count;
        let pb = accum.stats[b.as_str()].present_count;
        pb.cmp(&pa).then_with(|| a.cmp(b))
    });
    let total = ranked.len();
    let take_n = cap.unwrap_or(total);
    let mut out = Vec::with_capacity(take_n.min(total));
    let mut budget_hit = false;
    for path in ranked.into_iter().take(take_n) {
        if *budget == 0 {
            budget_hit = true;
            break;
        }
        *budget -= 1;
        out.push(build_field_node(path, depth, denom, accum, budget));
    }
    let truncated = cap.filter(|c| total > *c).map(|c| FieldKeyTruncation {
        shown: out.len().min(c) as u32,
        total: total as u32,
    });
    (out, truncated, budget_hit)
}
