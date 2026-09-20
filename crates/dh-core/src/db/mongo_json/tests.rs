use super::*;
use crate::db::mongo_json::render::render;

fn render_ok(input: &str) -> String {
    let d = parse(input).expect("parse should succeed");
    render(&d)
}

#[test]
fn parses_basic_document() {
    let d = parse(r#"{ "a": 1, "b": "x", "c": true, "d": null, "e": [1, 2] }"#).unwrap();
    assert_eq!(d.get_i64("a"), Ok(1));
    assert_eq!(d.get_str("b"), Ok("x"));
    assert_eq!(d.get_bool("c"), Ok(true));
    assert!(matches!(d.get("d"), Some(Bson::Null)));
    assert!(d.get_array("e").is_ok());
}

#[test]
fn parses_constructors() {
    let d = parse(
        r#"{
                "_id": ObjectId("507f1f77bcf86cd799439011"),
                "when": ISODate("2026-01-01T00:00:00Z"),
                "big": NumberLong("9223372036854775807"),
                "n": Int32(5),
                "pi": NumberDecimal("3.14"),
                "rx": /^foo$/i,
                "ts": Timestamp(1620000000, 1),
                "min": MinKey()
            }"#,
    )
    .unwrap();
    assert!(matches!(d.get("_id"), Some(Bson::ObjectId(_))));
    assert!(matches!(d.get("when"), Some(Bson::DateTime(_))));
    assert!(matches!(d.get("big"), Some(Bson::Int64(_))));
    assert!(matches!(d.get("n"), Some(Bson::Int32(_))));
    assert!(matches!(d.get("pi"), Some(Bson::Decimal128(_))));
    assert!(matches!(d.get("rx"), Some(Bson::RegularExpression(r)) if r.options == "i"));
    assert!(matches!(d.get("ts"), Some(Bson::Timestamp(_))));
    assert!(matches!(d.get("min"), Some(Bson::MinKey)));
}

#[test]
fn round_trip_preserves_types() {
    let input = r#"{ "x": ObjectId("507f1f77bcf86cd799439011"), "y": NumberLong(42) }"#;
    let rendered = render_ok(input);
    // Re-parse must keep the ObjectId (not degrade to string).
    let again = parse(&rendered).unwrap();
    assert!(matches!(again.get("x"), Some(Bson::ObjectId(_))));
    assert!(matches!(again.get("y"), Some(Bson::Int64(_))));
}

#[test]
fn rejects_bad_input() {
    assert!(parse("{").is_err());
    assert!(parse(r#"{ "a": ObjectId("nope") }"#).is_err());
    assert!(parse(r#"{ "a": UnknownCtor(1) }"#).is_err());
    assert!(parse("not a document").is_err());
}

#[test]
fn parses_nested_and_arrays() {
    let d = parse(r#"{ "a": { "b": [ObjectId("507f1f77bcf86cd799439011"), "s"] } }"#).unwrap();
    let a = d.get_document("a").unwrap();
    let arr = a.get_array("b").unwrap();
    assert_eq!(arr.len(), 2);
    assert!(matches!(arr[0], Bson::ObjectId(_)));
}

#[test]
fn quotes_bare_keys() {
    assert_eq!(quote_bare_keys(r#"{name:"test"}"#), r#"{"name":"test"}"#);
    assert_eq!(
        quote_bare_keys(r#"{ name : "test", age: 5 }"#),
        r#"{ "name" : "test", "age": 5 }"#
    );
    // Already-quoted keys and string contents (incl. a colon inside a
    // string) are left untouched.
    assert_eq!(
        quote_bare_keys(r#"{"a": "b:c", $or: [{x:1}]}"#),
        r#"{"a": "b:c", "$or": [{"x":1}]}"#
    );
    // No trailing `:` — not a key position, must not be quoted.
    assert_eq!(quote_bare_keys("true"), "true");
}
