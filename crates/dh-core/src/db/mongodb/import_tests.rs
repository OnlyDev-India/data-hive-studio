//! Mongo import (spec 0008). The conversion tests run anywhere. The server
//! tests are `#[ignore]`d: run `cargo test -p dh-core -- --ignored mongo_import`
//! with `DH_TEST_MONGO_HOST` and `DH_TEST_MONGO_PORT` pointing at a throwaway server (replica set for
//! the transaction cases, standalone for the not atomic ones).
use std::collections::HashMap;

use bson::Bson;
use serde_json::{json, Map, Value};

use super::import_docs::to_document;

fn map(v: Value) -> Map<String, Value> {
    v.as_object().unwrap().clone()
}

fn types(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs.iter().map(|(k, t)| (k.to_string(), t.to_string())).collect()
}

#[test]
fn empty_id_is_left_out_so_the_server_makes_one() {
    for id in [json!(null), json!(""), json!("  ")] {
        let d = to_document(&map(json!({ "_id": id, "a": "x" })), &types(&[])).unwrap();
        assert!(!d.contains_key("_id"));
        assert_eq!(d.get_str("a"), Ok("x"));
    }
}

#[test]
fn id_hex_becomes_an_object_id_and_other_ids_stay_text() {
    let hex = "64b7f0c2a1b2c3d4e5f60718";
    let d = to_document(&map(json!({ "_id": hex })), &types(&[])).unwrap();
    assert!(matches!(d.get("_id"), Some(Bson::ObjectId(_))));
    let d = to_document(&map(json!({ "_id": "abc" })), &types(&[("_id", "objectid")])).unwrap();
    assert_eq!(d.get_str("_id"), Ok("abc"));
}

#[test]
fn strings_follow_the_collections_field_types() {
    let t = types(&[("n", "integer"), ("x", "double"), ("ok", "boolean"), ("s", "string"), ("d", "date")]);
    let d = to_document(
        &map(json!({ "n": "42", "x": "1.5", "ok": "yes_no", "s": "007", "d": "2024-03-01" })),
        &t,
    );
    // "yes_no" is not a boolean, so the whole document is refused, naming the field.
    assert_eq!(d.err().unwrap().column, "ok");
    let d = to_document(
        &map(json!({ "n": "42", "x": "1.5", "ok": "true", "s": "007", "d": "2024-03-01" })),
        &t,
    )
    .unwrap();
    assert_eq!(d.get("n"), Some(&Bson::Int64(42)));
    assert_eq!(d.get("x"), Some(&Bson::Double(1.5)));
    assert_eq!(d.get("ok"), Some(&Bson::Boolean(true)));
    assert_eq!(d.get_str("s"), Ok("007"));
    assert!(matches!(d.get("d"), Some(Bson::DateTime(_))));
}

#[test]
fn a_field_with_no_known_type_stays_text() {
    let d = to_document(&map(json!({ "code": "1", "flag": "true" })), &types(&[])).unwrap();
    assert_eq!(d.get_str("code"), Ok("1"));
    assert_eq!(d.get_str("flag"), Ok("true"));
}

#[test]
fn a_bad_whole_number_names_its_field() {
    let e = to_document(&map(json!({ "n": "abc" })), &types(&[("n", "integer")])).err().unwrap();
    assert_eq!(e.column, "n");
    assert!(e.message.contains("abc"));
}

#[test]
fn typed_json_and_nested_documents_convert_natively() {
    let d = to_document(
        &map(json!({
            "n": 3, "f": 2.5, "b": true, "when": { "$date": "2024-03-01T00:00:00Z" },
            "nest": { "a": [1, { "b": null }] }, "gone": null
        })),
        &types(&[]),
    )
    .unwrap();
    assert_eq!(d.get("n"), Some(&Bson::Int64(3)));
    assert_eq!(d.get("f"), Some(&Bson::Double(2.5)));
    assert_eq!(d.get("b"), Some(&Bson::Boolean(true)));
    assert!(matches!(d.get("when"), Some(Bson::DateTime(_))));
    assert!(matches!(d.get("nest"), Some(Bson::Document(_))));
    assert_eq!(d.get("gone"), Some(&Bson::Null));
}

#[test]
fn a_whole_number_in_a_double_field_is_stored_as_a_double() {
    let d = to_document(&map(json!({ "x": 5 })), &types(&[("x", "double")])).unwrap();
    assert_eq!(d.get("x"), Some(&Bson::Double(5.0)));
}

// ---- Against a real server -------------------------------------------------

#[cfg(test)]
mod live {
    use super::*;
    use crate::api::{ImportData, ImportOnError, ImportRequest};
    use crate::db::mongodb::{MongoAdapter, MongoParams};

    const LIVE: &str = "requires a live MongoDB, see DH_TEST_MONGO_HOST";

    async fn adapter() -> MongoAdapter {
        let host = std::env::var("DH_TEST_MONGO_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
        let port: u16 = std::env::var("DH_TEST_MONGO_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(27017);
        let params: MongoParams = serde_json::from_value(json!({
            "host": host, "port": port, "user": "", "password": "", "database": "dh_import_test",
        }))
        .expect("params");
        MongoAdapter::connect(&params).await.expect("connect")
    }

    fn request(coll: &str, docs: Vec<Value>, on_error: ImportOnError, dry_run: bool) -> ImportRequest {
        ImportRequest {
            table: coll.into(),
            create_sql: None,
            data: ImportData::Docs { docs: docs.into_iter().map(map).collect() },
            on_error,
            dry_run,
            run_id: None,
            source_label: None,
        }
    }

    async fn count(a: &MongoAdapter, coll: &str) -> u64 {
        a.client
            .database(&a.cur_database())
            .collection::<bson::Document>(coll)
            .count_documents(bson::doc! {})
            .await
            .unwrap()
    }

    #[tokio::test]
    #[ignore = "requires a live MongoDB, see DH_TEST_MONGO_HOST"]
    async fn mongo_import_skip_lists_every_duplicate_id() {
        let _ = LIVE;
        let a = adapter().await;
        let coll = format!("imp_skip_{}", std::process::id());
        let docs = vec![json!({"_id": 1, "a": "x"}), json!({"_id": 1, "a": "y"}), json!({"a": "z"}), json!({"_id": 1})];
        let r = a.import_rows(None, &request(&coll, docs, ImportOnError::Skip, false)).await.unwrap();
        assert_eq!((r.inserted, r.failed_total, r.atomic), (2, 2, false));
        assert_eq!(r.failed.iter().map(|f| f.index).collect::<Vec<_>>(), vec![1, 3]);
        assert_eq!(count(&a, &coll).await, 2);
        a.client.database(&a.cur_database()).collection::<bson::Document>(&coll).drop().await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires a live MongoDB replica set, see DH_TEST_MONGO_HOST"]
    async fn mongo_import_rollback_leaves_nothing_on_a_replica_set() {
        let a = adapter().await;
        if !a.import_capabilities().await.unwrap().atomic {
            return;
        }
        let coll = format!("imp_txn_{}", std::process::id());
        let docs = vec![json!({"_id": 1}), json!({"_id": 2}), json!({"_id": 2})];
        let r = a.import_rows(None, &request(&coll, docs, ImportOnError::Rollback, false)).await.unwrap();
        assert!(!r.committed && r.atomic && r.failed_total >= 1);
        assert_eq!(count(&a, &coll).await, 0);
        let ok = vec![json!({"_id": 1}), json!({"_id": 2})];
        let c = a.import_rows(None, &request(&coll, ok.clone(), ImportOnError::Rollback, true)).await.unwrap();
        assert!(c.dry_run && !c.committed);
        assert_eq!(count(&a, &coll).await, 0);
        let r = a.import_rows(None, &request(&coll, ok, ImportOnError::Rollback, false)).await.unwrap();
        assert!(r.committed && r.inserted == 2);
        a.client.database(&a.cur_database()).collection::<bson::Document>(&coll).drop().await.unwrap();
    }
}
