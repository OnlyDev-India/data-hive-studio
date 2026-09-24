//! Turning one imported JSON document into BSON (spec 0008, AC-19).
//!
//! The app sends strings for CSV cells and real JSON values for JSON files.
//! A string is converted with the collection's known field type. A value that
//! is already typed (a number, a boolean, `{"$date": ...}` from a new
//! collection) is read as relaxed extended JSON.

use std::collections::HashMap;

use bson::{Bson, Document};
use serde_json::{Map, Value};

use super::filter::{field_bson, is_object_id_hex};

/// One document that cannot be converted: the field and the reason.
#[derive(Debug)]
pub(super) struct DocProblem {
    pub column: String,
    pub message: String,
}

fn problem(column: &str, message: String) -> DocProblem {
    DocProblem { column: column.to_string(), message }
}

/// Convert one document. `types` maps a field to the collection's known BSON
/// type name (empty for a new collection). An empty `_id` is left out so the
/// server makes one (AC-19).
pub(super) fn to_document(
    map: &Map<String, Value>,
    types: &HashMap<String, String>,
) -> Result<Document, DocProblem> {
    let mut out = Document::new();
    for (key, value) in map {
        let ty = types.get(key).map(|t| t.to_ascii_lowercase());
        if key == "_id" && is_empty_id(value) {
            continue;
        }
        let converted = match value {
            Value::String(s) => from_string(key, s, ty.as_deref())?,
            Value::Number(n) => from_number(key, n, ty.as_deref())?,
            other => Bson::try_from(other.clone())
                .map_err(|e| problem(key, format!("cannot read this value: {e}")))?,
        };
        out.insert(key, converted);
    }
    Ok(out)
}

fn is_empty_id(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::String(s) => s.trim().is_empty(),
        _ => false,
    }
}

/// A string cell, converted by the field's type. A field with no known type
/// stays a string, so `"007"` is never quietly turned into a number.
fn from_string(key: &str, s: &str, ty: Option<&str>) -> Result<Bson, DocProblem> {
    if key == "_id" {
        // Mixed `_id` types are legal, so a plain string stays a string.
        if is_object_id_hex(s) && ty != Some("string") {
            return Ok(Bson::ObjectId(bson::oid::ObjectId::parse_str(s).map_err(|e| problem(key, e.to_string()))?));
        }
        if let Some(t) = ty.filter(|t| t.contains("int")) {
            return whole(key, s, t);
        }
        return Ok(Bson::String(s.to_string()));
    }
    let Some(t) = ty else { return Ok(Bson::String(s.to_string())) };
    let t = t.trim();
    if t.contains("int") || t.contains("long") {
        return whole(key, s, t);
    }
    if t.contains("double") || t.contains("float") || t.contains("decimal") {
        return s
            .trim()
            .parse::<f64>()
            .map(Bson::Double)
            .map_err(|_| problem(key, format!("\"{s}\" is not a number")));
    }
    if t.contains("bool") {
        return match s.trim().to_ascii_lowercase().as_str() {
            "true" | "1" => Ok(Bson::Boolean(true)),
            "false" | "0" => Ok(Bson::Boolean(false)),
            _ => Err(problem(key, format!("\"{s}\" is not true or false"))),
        };
    }
    if t == "date" {
        return parse_date(s).ok_or_else(|| problem(key, format!("\"{s}\" is not a date")));
    }
    if t == "objectid" {
        return bson::oid::ObjectId::parse_str(s.trim())
            .map(Bson::ObjectId)
            .map_err(|_| problem(key, format!("\"{s}\" is not an ObjectId")));
    }
    if t.contains("object") || t.contains("array") || t.contains("bson") {
        return Ok(field_bson(Some(s), Some(t)));
    }
    Ok(Bson::String(s.to_string()))
}

fn whole(key: &str, s: &str, _ty: &str) -> Result<Bson, DocProblem> {
    s.trim()
        .parse::<i64>()
        .map(Bson::Int64)
        .map_err(|_| problem(key, format!("\"{s}\" is not a whole number")))
}

/// A number the file already typed. In a `double` field a whole number is
/// stored as a double, so the field keeps one type.
fn from_number(key: &str, n: &serde_json::Number, ty: Option<&str>) -> Result<Bson, DocProblem> {
    let double = ty.is_some_and(|t| t.contains("double") || t.contains("decimal") || t.contains("float"));
    if double {
        return n.as_f64().map(Bson::Double).ok_or_else(|| problem(key, "not a number".into()));
    }
    if let Some(i) = n.as_i64() {
        return Ok(Bson::Int64(i));
    }
    n.as_f64().map(Bson::Double).ok_or_else(|| problem(key, "not a number".into()))
}

/// RFC 3339, or a plain `YYYY-MM-DD` read as midnight UTC.
fn parse_date(s: &str) -> Option<Bson> {
    let t = s.trim();
    let full = if t.len() == 10 { format!("{t}T00:00:00Z") } else { t.replace(' ', "T") };
    bson::DateTime::parse_rfc3339_str(&full)
        .or_else(|_| bson::DateTime::parse_rfc3339_str(format!("{full}Z")))
        .ok()
        .map(Bson::DateTime)
}
