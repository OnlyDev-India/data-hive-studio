use super::*;

fn plan(sql: &str) -> SelectPlan {
    translate_select(sql).unwrap_or_else(|e| panic!("translate failed for `{sql}`: {e}"))
}

#[test]
fn select_star_no_where() {
    let p = plan("SELECT * FROM users");
    assert_eq!(p.table, "users");
    assert_eq!(p.columns, None);
    assert_eq!(p.filter, None);
}

#[test]
fn select_columns() {
    let p = plan("SELECT name, age FROM users");
    assert_eq!(p.columns, Some(vec!["name".into(), "age".into()]));
}

#[test]
fn simple_equality_where() {
    let p = plan("SELECT * FROM users WHERE status = 'active'");
    assert_eq!(p.filter, Some(bson::doc! { "status": "active" }));
}

#[test]
fn numeric_comparison() {
    let p = plan("SELECT * FROM users WHERE age > 18");
    assert_eq!(p.filter, Some(bson::doc! { "age": { "$gt": 18i64 } }));
}

#[test]
fn and_combines_into_and_array() {
    let p = plan("SELECT * FROM users WHERE age > 18 AND status = 'active'");
    assert_eq!(
        p.filter,
        Some(bson::doc! { "$and": [
            { "age": { "$gt": 18i64 } },
            { "status": "active" },
        ] })
    );
}

#[test]
fn or_has_lower_precedence_than_and() {
    // a AND b OR c  ==  (a AND b) OR c
    let p = plan("SELECT * FROM t WHERE a = 1 AND b = 2 OR c = 3");
    assert_eq!(
        p.filter,
        Some(bson::doc! { "$or": [
            { "$and": [ { "a": 1i64 }, { "b": 2i64 } ] },
            { "c": 3i64 },
        ] })
    );
}

#[test]
fn parens_group_explicitly() {
    let p = plan("SELECT * FROM t WHERE a = 1 AND (b = 2 OR c = 3)");
    assert_eq!(
        p.filter,
        Some(bson::doc! { "$and": [
            { "a": 1i64 },
            { "$or": [ { "b": 2i64 }, { "c": 3i64 } ] },
        ] })
    );
}

#[test]
fn is_null_and_is_not_null() {
    assert_eq!(
        plan("SELECT * FROM t WHERE a IS NULL").filter,
        Some(bson::doc! { "a": bson::Bson::Null })
    );
    assert_eq!(
        plan("SELECT * FROM t WHERE a IS NOT NULL").filter,
        Some(bson::doc! { "a": { "$ne": bson::Bson::Null } })
    );
}

#[test]
fn in_and_not_in() {
    assert_eq!(
        plan("SELECT * FROM t WHERE a IN (1, 2, 3)").filter,
        Some(bson::doc! { "a": { "$in": [1i64, 2i64, 3i64] } })
    );
    assert_eq!(
        plan("SELECT * FROM t WHERE a NOT IN ('x', 'y')").filter,
        Some(bson::doc! { "a": { "$nin": ["x", "y"] } })
    );
}

#[test]
fn like_translates_to_anchored_regex() {
    let p = plan("SELECT * FROM t WHERE name LIKE 'Jo%'");
    assert_eq!(
        p.filter,
        Some(bson::doc! { "name": { "$regex": "^Jo.*$" } })
    );
}

#[test]
fn escaped_quote_in_string_literal() {
    let p = plan("SELECT * FROM t WHERE name = 'O''Brien'");
    assert_eq!(p.filter, Some(bson::doc! { "name": "O'Brien" }));
}

#[test]
fn order_by_limit_offset() {
    let p = plan("SELECT * FROM users ORDER BY age DESC, name LIMIT 10 OFFSET 5");
    assert_eq!(p.sort, Some(bson::doc! { "age": -1, "name": 1 }));
    assert_eq!(p.limit, Some(10));
    assert_eq!(p.offset, Some(5));
}

#[test]
fn dotted_nested_field_path() {
    let p = plan("SELECT * FROM users WHERE address.city = 'NYC'");
    assert_eq!(p.filter, Some(bson::doc! { "address.city": "NYC" }));
}

#[test]
fn boolean_and_null_literals() {
    let p = plan("SELECT * FROM t WHERE active = true");
    assert_eq!(p.filter, Some(bson::doc! { "active": true }));
}

#[test]
fn semicolon_and_trailing_whitespace_tolerated() {
    let p = plan("SELECT * FROM users ;  ");
    assert_eq!(p.table, "users");
}

#[test]
fn rejects_non_select() {
    assert!(translate_select("UPDATE users SET a = 1").is_err());
    assert!(translate_select("DELETE FROM users").is_err());
}

#[test]
fn is_select_detects_select_statements() {
    assert!(is_select("  SELECT * FROM t"));
    assert!(is_select("-- comment\nSELECT * FROM t"));
    assert!(!is_select("UPDATE t SET a = 1"));
    assert!(!is_select("INSERT INTO t VALUES (1)"));
}

#[test]
fn rejects_join() {
    // JOINs are explicitly out of scope for this translator.
    assert!(translate_select("SELECT * FROM a JOIN b ON a.id = b.id").is_err());
}

#[test]
fn rejects_malformed_where() {
    assert!(translate_select("SELECT * FROM t WHERE").is_err());
    assert!(translate_select("SELECT * FROM t WHERE a =").is_err());
}
