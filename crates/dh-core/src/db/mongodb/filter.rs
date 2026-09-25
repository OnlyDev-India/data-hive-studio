use bson::doc;
use crate::db::{DbError, DbResult};
use crate::api::{FilterOp, GridFilterCond};

/// Coerce a filter-bar string value to a BSON scalar (bool / int / double /
/// string) so Mongo comparisons are typed instead of always-string.
fn scalar_bson(v: &str) -> bson::Bson {
    match v {
        "true" => bson::Bson::Boolean(true),
        "false" => bson::Bson::Boolean(false),
        _ => v
            .parse::<i64>()
            .map(bson::Bson::Int64)
            .or_else(|_| v.parse::<f64>().map(bson::Bson::Double))
            .unwrap_or_else(|_| bson::Bson::String(v.to_string())),
    }
}

/// One filter-bar condition → a Mongo query document fragment.
fn condition_doc(cond: &GridFilterCond) -> Option<bson::Document> {
    let field = &cond.column;
    let mut d = bson::Document::new();
    match cond.op {
        FilterOp::Eq => d.insert(field, scalar_bson(&cond.value)),
        FilterOp::Neq => d.insert(field, doc! { "$ne": scalar_bson(&cond.value) }),
        FilterOp::Gt => d.insert(field, doc! { "$gt": scalar_bson(&cond.value) }),
        FilterOp::Gte => d.insert(field, doc! { "$gte": scalar_bson(&cond.value) }),
        FilterOp::Lt => d.insert(field, doc! { "$lt": scalar_bson(&cond.value) }),
        FilterOp::Lte => d.insert(field, doc! { "$lte": scalar_bson(&cond.value) }),
        FilterOp::Contains => d.insert(
            field,
            doc! { "$regex": cond.value.as_str(), "$options": "i" },
        ),
        FilterOp::StartsWith => d.insert(
            field,
            doc! { "$regex": format!("^{}", cond.value), "$options": "i" },
        ),
        FilterOp::EndsWith => d.insert(
            field,
            doc! { "$regex": format!("{}$", cond.value), "$options": "i" },
        ),
        FilterOp::IsNull => d.insert(field, bson::Bson::Null),
        FilterOp::IsNotNull => d.insert(field, doc! { "$ne": null }),
        FilterOp::In => d.insert(
            field,
            doc! { "$in": cond.values.iter().map(|v| scalar_bson(v)).collect::<Vec<_>>() },
        ),
    };
    Some(d)
}

/// Build a Mongo filter from the filter-bar conditions, or from a raw Mongo
/// query JSON in `custom_where` (which wins, mirroring the SQL adapter).
pub(super) fn build_filter(
    filters: &[GridFilterCond],
    custom_where: Option<&str>,
) -> DbResult<Option<bson::Document>> {
    if let Some(cw) = custom_where.map(str::trim).filter(|s| !s.is_empty()) {
        // The same extended-JSON parser the row editor uses (`mongo_json::parse`),
        // not plain `serde_json` — a filter needs BSON constructors too
        // (`{"_id": ObjectId("...")}`), which aren't valid strict JSON.
        let doc = super::mongo_json::parse(&super::mongo_json::quote_bare_keys(cw)).map_err(
            |e| {
                DbError::InvalidOperation(format!(
                    "custom_where must be a Mongo query JSON object: {e}"
                ))
            },
        )?;
        return Ok(Some(doc));
    }
    if filters.is_empty() {
        return Ok(None);
    }
    let docs: Vec<bson::Document> = filters.iter().filter_map(condition_doc).collect();
    if docs.is_empty() {
        return Ok(None);
    }
    if docs.len() == 1 {
        return Ok(docs.into_iter().next());
    }
    let use_or = filters
        .iter()
        .all(|f| f.conjunction.as_deref() == Some("OR"));
    if use_or {
        Ok(Some(doc! { "$or": docs }))
    } else {
        Ok(Some(doc! { "$and": docs }))
    }
}

/// Render one document's field as a grid cell string (None = NULL cell).
pub(super) fn json_cell_string(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::Null => None,
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        other => Some(other.to_string()),
    }
}

/// Compact JSON-ish description of a Mongo filter for the activity log.
pub(super) fn filter_desc(filter: &Option<bson::Document>) -> String {
    match filter {
        Some(d) => serde_json::to_string(d).unwrap_or_else(|_| "{}".into()),
        None => "{}".into(),
    }
}

/// True when `s` looks like a 24-character ObjectId hex string.
pub(super) fn is_object_id_hex(s: &str) -> bool {
    s.len() == 24 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// Coerce a grid cell string to a BSON value using the column's inferred
/// type. Object/array/bson fields are parsed as JSON so nested documents stay
/// structured; scalars are coerced to bool/int/double where sensible.
pub(super) fn field_bson(value: Option<&str>, data_type: Option<&str>) -> bson::Bson {
    let v = match value {
        Some(v) => v,
        None => return bson::Bson::Null,
    };
    let t = data_type.unwrap_or("").to_ascii_lowercase();
    if t.contains("object") || t.contains("array") || t.contains("bson") {
        if let Ok(j) = serde_json::from_str::<serde_json::Value>(v) {
            if let Ok(b) = bson::to_bson(&j) {
                return b;
            }
        }
        return bson::Bson::String(v.to_string());
    }
    if t.contains("bool") {
        return bson::Bson::Boolean(v == "true" || v == "1");
    }
    // A date cell must be written back as a BSON date, not as the text the
    // grid shows, or the field silently changes type.
    if t == "date" {
        if let Some(d) = super::import_docs::parse_date(v) {
            return d;
        }
    }
    if t.contains("int") || t.contains("long") || t.contains("integer") {
        if let Ok(i) = v.parse::<i64>() {
            return bson::Bson::Int64(i);
        }
        if let Ok(f) = v.parse::<f64>() {
            return bson::Bson::Double(f);
        }
    }
    if t.contains("double") || t.contains("float") || t.contains("decimal") {
        if let Ok(f) = v.parse::<f64>() {
            return bson::Bson::Double(f);
        }
    }
    // No type hint (e.g. a dotted nested path from the drill-down editor): best
    // effort — bool (both "true"/"false" and the "1"/"0" the grid's own bool
    // editor writes), integer, double, then JSON object/array, else string.
    if v == "true" || v == "1" {
        return bson::Bson::Boolean(true);
    }
    if v == "false" || v == "0" {
        return bson::Bson::Boolean(false);
    }
    if let Ok(i) = v.parse::<i64>() {
        if !is_object_id_hex(v) {
            return bson::Bson::Int64(i);
        }
    }
    if let Ok(f) = v.parse::<f64>() {
        return bson::Bson::Double(f);
    }
    if let Ok(j) = serde_json::from_str::<serde_json::Value>(v) {
        if j.is_object() || j.is_array() {
            if let Ok(b) = bson::to_bson(&j) {
                return b;
            }
        }
    }
    bson::Bson::String(v.to_string())
}

/// Build a document-matching filter from a grid row's `match_row` (key → cell
/// string). `_id` values that look like ObjectId hex are matched as real
/// ObjectIds; other fields are coerced generically.
pub(super) fn filter_from_match_row(
    match_row: &std::collections::BTreeMap<String, Option<String>>,
) -> bson::Document {
    let mut d = bson::Document::new();
    for (k, v) in match_row {
        if k == "_id" {
            if let Some(s) = v.as_deref() {
                if is_object_id_hex(s) {
                    if let Ok(oid) = bson::oid::ObjectId::parse_str(s) {
                        d.insert("_id", oid);
                        continue;
                    }
                }
            }
        }
        d.insert(k, field_bson(v.as_deref(), None));
    }
    d
}
