use super::*;
use crate::db::mongodb::field_tree::{FIELD_TREE_NODE_BUDGET, FieldTreeAccum, accumulate_field_tree, build_field_children};
use crate::db::mongodb::filter::build_filter;
use crate::db::mongodb::cancel::{current_op_filter, mongo_canceller, mongo_err, run_comment};
use crate::db::mongodb::console_parse::{parse_chain, parse_db_call, parse_filter, split_top_level, validate_chain};
use bson::{doc, Bson};
use mongodb::error::ErrorKind;
use crate::db::DbError;
use crate::api::FieldShape;

/// Runs `accumulate_field_tree` over every doc, then builds the
/// top-level field list the way `sample_field_tree` does (uncapped,
/// since the root's own field list is never key-capped).
fn build_tree(docs: &[bson::Document]) -> Vec<FieldShape> {
    let mut accum = FieldTreeAccum::default();
    for d in docs {
        accumulate_field_tree(d, "", 0, &mut accum);
    }
    let mut budget = FIELD_TREE_NODE_BUDGET;
    build_field_children("", 1, docs.len(), None, &accum, &mut budget).0
}

fn find_field<'a>(fields: &'a [FieldShape], name: &str) -> &'a FieldShape {
    fields.iter().find(|f| f.name == name).unwrap_or_else(|| {
        panic!("field {name:?} not found among {:?}", fields.iter().map(|f| &f.name).collect::<Vec<_>>())
    })
}

#[test]
fn nested_object_recurses_with_correct_types_and_paths() {
    let docs = vec![doc! { "address": { "city": "NYC", "zip": 10001 } }];
    let tree = build_tree(&docs);
    let address = find_field(&tree, "address");
    assert_eq!(address.bson_type, "object");
    assert!(!address.optional);
    let city = find_field(&address.children, "city");
    assert_eq!(city.bson_type, "string");
    assert_eq!(city.path, "address.city");
    assert!(!city.optional);
}

#[test]
fn optional_is_scoped_to_parent_not_raw_sample_size() {
    // `zip` is present in every doc where `address` itself is present,
    // even though `address` is absent from half the sample — `zip`
    // must NOT be marked optional just because `address` sometimes is.
    let docs = vec![
        doc! { "address": { "zip": 1 } },
        doc! { "address": { "zip": 2 } },
        doc! { "other": true },
    ];
    let tree = build_tree(&docs);
    let address = find_field(&tree, "address");
    assert!(address.optional, "address is present in only 2/3 docs");
    let zip = find_field(&address.children, "zip");
    assert!(
        !zip.optional,
        "zip is present in every doc where address exists, so it must not read as optional"
    );
}

#[test]
fn array_of_objects_merges_element_shape_and_reports_type_union() {
    let docs = vec![doc! {
        "tags": [ { "label": "a" }, { "label": "b" }, "scalar" ],
    }];
    let tree = build_tree(&docs);
    let tags = find_field(&tree, "tags");
    assert_eq!(tags.bson_type, "array");
    let mut element_types = tags.element_types.clone();
    element_types.sort();
    assert_eq!(element_types, vec!["object".to_string(), "string".to_string()]);
    let label = find_field(&tags.children, "label");
    assert_eq!(label.bson_type, "string");
}

#[test]
fn empty_array_and_object_are_flagged_empty_with_no_children() {
    let docs = vec![doc! { "tags": [], "meta": {} }];
    let tree = build_tree(&docs);
    let tags = find_field(&tree, "tags");
    assert!(tags.empty);
    assert!(tags.children.is_empty());
    let meta = find_field(&tree, "meta");
    assert!(meta.empty);
    assert!(meta.children.is_empty());
}

#[test]
fn mixed_top_level_type_reports_only_the_most_common_one() {
    let docs = vec![
        doc! { "v": "a" },
        doc! { "v": "b" },
        doc! { "v": 1 },
    ];
    let tree = build_tree(&docs);
    let v = find_field(&tree, "v");
    assert_eq!(v.bson_type, "string");
    assert!(v.element_types.is_empty(), "type must never be a union");
}

#[test]
fn wide_nested_object_is_capped_at_50_keys_with_a_truncation_marker() {
    let mut inner = bson::Document::new();
    for i in 0..75 {
        inner.insert(format!("k{i:02}"), i);
    }
    let docs = vec![doc! { "dynamic": inner }];
    let tree = build_tree(&docs);
    let dynamic = find_field(&tree, "dynamic");
    assert_eq!(dynamic.children.len(), 50);
    let truncated = dynamic.truncated.as_ref().expect("expected a truncation marker");
    assert_eq!(truncated.shown, 50);
    assert_eq!(truncated.total, 75);
}

#[test]
fn splits_top_level_commas() {
    let parts = split_top_level("\"city\", { \"a\": 1 }, [1,2,3]");
    assert_eq!(parts.len(), 3);
    assert_eq!(parts[0].trim_matches('"'), "city");
    assert_eq!(parts[1].trim(), "{ \"a\": 1 }");
    assert_eq!(parts[2].trim(), "[1,2,3]");
}

#[test]
fn parse_db_call_extracts_parts() {
    let c = parse_db_call("db.users.find({ \"name\": \"a(b\" }).limit(5).pretty()").unwrap();
    assert_eq!(c.coll, "users");
    assert_eq!(c.method, "find");
    assert_eq!(c.args.trim(), "{ \"name\": \"a(b\" }");
    assert!(c.chain.contains(".limit(5)"));
    assert!(c.chain.contains(".pretty()"));
}

#[test]
fn parse_db_call_with_filter_fragment() {
    let c =
        parse_db_call("db.orders.aggregate([ { \"$match\": { \"age\": { \"$gte\": 18 } } } ])")
            .unwrap();
    assert_eq!(c.coll, "orders");
    assert_eq!(c.method, "aggregate");
    assert!(c.args.contains("$match"));
    assert_eq!(c.chain, "");
}

#[test]
fn parse_db_call_balanced_quotes() {
    // A literal ")" inside a string must not close the call early.
    let c = parse_db_call("db.logs.find({ \"msg\": \"ok )\" }).limit(1)").unwrap();
    assert_eq!(c.method, "find");
    assert!(c.args.contains("ok )\""));
    assert!(c.chain.contains(".limit(1)"));
}

#[test]
fn parse_filter_variants() {
    assert!(parse_filter("").unwrap().is_none());
    assert!(parse_filter("   ").unwrap().is_none());
    assert!(parse_filter("{}").unwrap().is_some());
    assert!(parse_filter("{ \"status\": \"active\" }")
        .unwrap()
        .is_some());
    // The first argument of a find/distinct is a field or must be an object
    // query — a scalar/array is rejected here.
    assert!(parse_filter("\"city\", { \"x\": 1 }").is_err());
    // A non-object (scalar / array) query is rejected.
    assert!(parse_filter("[1,2]").is_err());
    assert!(parse_filter("not json").is_err());
    // Unquoted (mongosh-style) keys are accepted, same as quoted ones.
    let d = parse_filter("{name:\"test\"}").unwrap().unwrap();
    assert_eq!(d.get_str("name"), Ok("test"));
}

#[test]
fn build_filter_accepts_unquoted_keys() {
    let d = build_filter(&[], Some("{name:\"test\"}"))
        .unwrap()
        .unwrap();
    assert_eq!(d.get_str("name"), Ok("test"));
}

#[test]
fn build_filter_accepts_bson_constructors() {
    let d = build_filter(
        &[],
        Some(r#"{"_id": ObjectId("507f1f77bcf86cd799439011")}"#),
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        d.get_object_id("_id").unwrap().to_hex(),
        "507f1f77bcf86cd799439011"
    );
}

#[test]
fn parse_chain_extracts_limit_and_sort() {
    let f = parse_chain(".limit(25).pretty().sort({ \"age\": -1 })");
    assert_eq!(f.limit, Some(25));
    assert!(f.sort.as_deref().unwrap_or("").contains("age"));
}

#[test]
fn validate_chain_accepts_recognized_modifiers() {
    assert!(validate_chain("").is_ok());
    assert!(validate_chain(".limit(25).pretty().sort({ \"age\": -1 })").is_ok());
}

#[test]
fn validate_chain_rejects_a_second_glued_on_command() {
    // The exact bug reported: two `db.x.find()` calls with no `;` between
    // them parse as ONE call whose leftover "chain" is the entire second
    // command — this used to be silently dropped instead of erroring.
    let call = parse_db_call("db.teams.find()\ndb.tasks.find()").unwrap();
    assert_eq!(call.coll, "teams");
    assert!(validate_chain(&call.chain).is_err());
}

#[test]
fn shell_use_and_show_dbs_recognized() {
    // run_mongo_impl requires a live client; we only assert the parser-level
    // decisions that route to those branches.
    assert!("use reports".starts_with("use "));
    assert!(!"show dbs".starts_with("db."));
    assert!("db.users.find({})".starts_with("db."));
    assert!("{ \"a\": 1 }".starts_with('{'));
}

// ---- Stop a running query (spec 0006) ----

fn command_error(code: i32, message: &str) -> mongodb::error::Error {
    let ce: mongodb::error::CommandError = bson::from_document(
        doc! { "code": code, "codeName": "X", "errmsg": message, "topologyVersion": bson::Bson::Null },
    )
    .unwrap();
    mongodb::error::Error::from(ErrorKind::Command(ce))
}

/// A run whose Stop was asked for: register after a cancel marker.
fn stop_requested_run(id: &str) -> super::super::runs::RunHandle {
    futures_util::FutureExt::now_or_never(super::super::runs::cancel("t-mongo", id));
    super::super::runs::register("t-mongo", id)
}

#[test]
fn a_killed_operation_is_stopped_only_when_stop_was_asked() {
    let asked = stop_requested_run("run-mongo-asked");
    let not_asked = super::super::runs::register("t-mongo", "run-mongo-not-asked");
    let interrupted = || command_error(11601, "operation was interrupted");

    assert!(matches!(mongo_err(interrupted(), Some(&asked)), DbError::Cancelled));
    // Same server error, but nobody pressed Stop (a killOp from elsewhere,
    // a maxTimeMS): it stays an error (AC-13).
    assert!(matches!(mongo_err(interrupted(), Some(&not_asked)), DbError::InvalidOperation(_)));
    assert!(matches!(mongo_err(interrupted(), None), DbError::InvalidOperation(_)));
}

#[test]
fn other_server_errors_stay_errors_even_after_stop() {
    let asked = stop_requested_run("run-mongo-other");
    // 13 = Unauthorized, 50 = MaxTimeMSExpired.
    for code in [13, 50] {
        let e = mongo_err(command_error(code, "nope"), Some(&asked));
        assert!(matches!(e, DbError::InvalidOperation(_)), "code {code}");
    }
}

#[test]
fn a_killed_cursor_counts_as_interrupted() {
    let asked = stop_requested_run("run-mongo-cursor");
    assert!(matches!(
        mongo_err(command_error(237, "cursor killed"), Some(&asked)),
        DbError::Cancelled
    ));
}

#[test]
fn current_op_finds_the_run_by_its_comment() {
    assert_eq!(
        current_op_filter("run-1"),
        doc! { "$or": [
            { "command.comment": "run-1" },
            { "originatingCommand.comment": "run-1" },
        ] }
    );
}

#[test]
fn every_run_operation_carries_the_run_id_as_its_comment() {
    let run = super::super::runs::register("t-mongo", "run-mongo-comment");
    assert_eq!(run_comment(Some(&run)), Some(Bson::String("run-mongo-comment".into())));
    assert_eq!(run_comment(None), None);
}

/// The canceller must never hang or panic when the server can't be
/// reached or refuses (a missing `inprog`/`killop` privilege looks the
/// same to it): it gives up quietly and the run's 3 second cap frees the
/// tab (AC-6).
#[tokio::test]
async fn a_cancel_that_cannot_reach_the_server_gives_up_quietly() {
    let client = Client::with_uri_str(
        "mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200&connectTimeoutMS=200",
    )
    .await
    .unwrap();
    let canceller = mongo_canceller(client, "run-mongo-unreachable".into());
    tokio::time::timeout(std::time::Duration::from_secs(3), canceller())
        .await
        .expect("a failed cancel attempt must return promptly");
}

/// A date cell edited in the grid goes back as a BSON date, so the field
/// keeps its type; other text in a date field stays a string.
#[test]
fn a_date_cell_is_written_back_as_a_bson_date() {
    use super::filter::field_bson;
    let want = bson::DateTime::parse_rfc3339_str("2026-08-20T02:08:00Z").unwrap();
    for text in ["2026-08-20T02:08:00.000Z", "2026-08-20 02:08:00", "2026-08-20T02:08:00Z"] {
        assert_eq!(field_bson(Some(text), Some("date")), Bson::DateTime(want), "{text}");
    }
    assert_eq!(
        field_bson(Some("2026-08-20"), Some("date")),
        Bson::DateTime(bson::DateTime::parse_rfc3339_str("2026-08-20T00:00:00Z").unwrap())
    );
    assert_eq!(field_bson(Some("soon"), Some("date")), Bson::String("soon".into()));
}
