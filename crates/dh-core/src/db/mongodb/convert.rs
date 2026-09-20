use base64::Engine as _;
use super::MongoAdapter;
use super::filter::json_cell_string;

/// Project a list of JSON documents into a union-of-fields grid.
pub(super) fn flatten_documents(docs: &[serde_json::Value]) -> (Vec<String>, Vec<Vec<Option<String>>>) {
    let mut columns: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for d in docs {
        if let serde_json::Value::Object(map) = d {
            for k in map.keys() {
                if seen.insert(k.clone()) {
                    columns.push(k.clone());
                }
            }
        }
    }
    if let Some(i) = columns.iter().position(|c| c == "_id") {
        let id = columns.remove(i);
        columns.insert(0, id);
    } else if columns.is_empty() {
        // No documents matched — fall back to _id rather than a columnless
        // grid, same as `select_page`.
        columns.push("_id".to_string());
    }
    let rows = docs
        .iter()
        .map(|d| match d {
            serde_json::Value::Object(map) => columns
                .iter()
                .map(|c| map.get(c).and_then(json_cell_string))
                .collect(),
            other => columns.iter().map(|_| json_cell_string(other)).collect(),
        })
        .collect();
    (columns, rows)
}

/// One index key's sort direction as ±1. Non-numeric key values (text/geo/
/// hashed index specs, e.g. `{field: "text"}`) aren't a sort direction at
/// all — reported as ascending since there's nothing meaningful to show.
pub(super) fn bson_dir(v: &bson::Bson) -> i8 {
    let n = match v {
        bson::Bson::Int32(n) => *n as f64,
        bson::Bson::Int64(n) => *n as f64,
        bson::Bson::Double(n) => *n,
        _ => return 1,
    };
    if n < 0.0 {
        -1
    } else {
        1
    }
}

/// BSON type name → human data_type string (for the schema explorer).
pub(super) fn bson_type_name(ty: &bson::Bson) -> &'static str {
    use bson::Bson::*;
    match ty {
        Double(_) => "double",
        String(_) => "string",
        Array(_) => "array",
        Document(_) => "object",
        Boolean(_) => "boolean",
        Int32(_) | Int64(_) => "integer",
        Decimal128(_) => "decimal",
        DateTime(_) => "date",
        Null | Undefined => "null",
        ObjectId(_) => "objectid",
        Binary(_) => "binary",
        RegularExpression(_) => "regex",
        Timestamp(_) => "timestamp",
        _ => "bson",
    }
}

impl MongoAdapter {
    /// Convert a BSON Document to a serde_json::Value for JSON rendering.
    pub(super) fn document_to_json(doc: bson::Document) -> serde_json::Value {
        let mut map = serde_json::Map::new();
        for (k, v) in doc {
            map.insert(k, Self::bson_to_json(v));
        }
        serde_json::Value::Object(map)
    }

    pub(super) fn bson_to_json(v: bson::Bson) -> serde_json::Value {
        use bson::Bson::*;
        match v {
            Double(f) => serde_json::Value::Number(
                serde_json::Number::from_f64(f).unwrap_or(serde_json::Number::from(0)),
            ),
            String(s) => serde_json::Value::String(s),
            Array(arr) => {
                serde_json::Value::Array(arr.into_iter().map(Self::bson_to_json).collect())
            }
            Document(doc) => Self::document_to_json(doc),
            Boolean(b) => serde_json::Value::Bool(b),
            Int32(i) => serde_json::Value::Number(i.into()),
            Int64(i) => serde_json::Value::Number(i.into()),
            Decimal128(d) => serde_json::Value::String(d.to_string()),
            // Falls back to Display (raw millis) for dates outside chrono's
            // representable range instead of the deprecated panicking variant.
            DateTime(dt) => {
                serde_json::Value::String(dt.try_to_rfc3339_string().unwrap_or_else(|_| dt.to_string()))
            }
            Null | Undefined => serde_json::Value::Null,
            ObjectId(oid) => serde_json::Value::String(oid.to_hex()),
            Binary(bin) => serde_json::Value::String(format!(
                "BinData({:?},{})",
                bin.subtype,
                base64::engine::general_purpose::STANDARD.encode(bin.bytes)
            )),
            RegularExpression(regex) => {
                serde_json::Value::String(format!("/{}/{}", regex.pattern, regex.options))
            }
            Timestamp(ts) => serde_json::Value::Object(
                serde_json::json!({"t": ts.time, "i": ts.increment})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
            MinKey => serde_json::Value::String("MinKey".into()),
            MaxKey => serde_json::Value::String("MaxKey".into()),
            Symbol(s) => serde_json::Value::String(s),
            _ => serde_json::Value::String(v.to_string()),
        }
    }
}
