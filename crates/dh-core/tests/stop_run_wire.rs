//! What crosses the wire for Stop (spec 0006): the `cancelled` flag on run
//! results and the cancel outcome. An older server's reply has no `cancelled`
//! field and must still read; the new field must survive a round trip.

use dh_core::api::{MongoRunResult, QueryResult};
use dh_core::db::{CancelOutcome, CancelState};

fn without_cancelled(mut value: serde_json::Value) -> serde_json::Value {
    value.as_object_mut().unwrap().remove("cancelled");
    value
}

#[test]
fn an_older_servers_sql_result_reads_as_not_cancelled() {
    let reply = without_cancelled(serde_json::to_value(QueryResult::default()).unwrap());

    let parsed: QueryResult = serde_json::from_value(reply).unwrap();

    assert!(!parsed.cancelled);
}

#[test]
fn an_older_servers_mongo_result_reads_as_not_cancelled() {
    let reply = without_cancelled(serde_json::to_value(MongoRunResult::default()).unwrap());

    let parsed: MongoRunResult = serde_json::from_value(reply).unwrap();

    assert!(!parsed.cancelled);
}

#[test]
fn a_stopped_result_keeps_its_flag_and_its_rows_through_json() {
    let stopped = QueryResult {
        columns: vec!["n".into()],
        rows: vec![vec![Some("1".into())]],
        is_select: true,
        cancelled: true,
        ..Default::default()
    };

    let back: QueryResult = serde_json::from_str(&serde_json::to_string(&stopped).unwrap()).unwrap();

    assert_eq!(back, stopped);
}

#[test]
fn a_stopped_mongo_result_keeps_its_flag_through_json() {
    let stopped = MongoRunResult { cancelled: true, command: "db.users.find({})".into(), ..Default::default() };

    let back: MongoRunResult = serde_json::from_str(&serde_json::to_string(&stopped).unwrap()).unwrap();

    assert_eq!(back, stopped);
}

#[tokio::test]
async fn cancelling_an_unknown_run_is_a_harmless_not_running() {
    let outcome = dh_core::db::cancel_run("no-such-conn", "no-such-run").await;

    assert_eq!(outcome.state, CancelState::NotRunning);
    assert_eq!(serde_json::to_string(&outcome).unwrap(), r#"{"state":"not_running"}"#);
}

#[test]
fn the_outcome_reads_back_from_the_frontends_json() {
    let parsed: CancelOutcome = serde_json::from_str(r#"{"state":"winding_down"}"#).unwrap();

    assert_eq!(parsed.state, CancelState::WindingDown);
}
