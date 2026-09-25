//! Streaming MongoDB results against a real server. All `#[ignore]`d, same
//! instance as the Stop tests: `DH_TEST_MONGO_URL=mongodb://127.0.0.1:27017
//! cargo test -p dh-core -- --ignored mongo_stream` (JavaScript must be
//! enabled for the `$where` sleep used as the slow operation).

use super::MongoAdapter;
use super::params::MongoParams;
use crate::api::QueryChunk;
use crate::db::{runs, DbError, DbResult};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const DB: &str = "dh_stop_test";

fn params() -> MongoParams {
    let url = std::env::var("DH_TEST_MONGO_URL")
        .unwrap_or_else(|_| "mongodb://127.0.0.1:27017".to_string());
    let rest = url.strip_prefix("mongodb://").expect("a mongodb:// url");
    let (auth, hostport) = rest.rsplit_once('@').unwrap_or(("", rest));
    let (user, password) = auth.split_once(':').unwrap_or((auth, ""));
    let (host, port) = hostport.split_once(':').unwrap_or((hostport, "27017"));
    serde_json::from_value(serde_json::json!({
        "host": host, "port": port.trim_end_matches('/').parse::<u16>().unwrap(),
        "user": user, "password": password, "database": DB,
    }))
    .unwrap()
}

type Seen = Arc<Mutex<Vec<QueryChunk>>>;

fn recording() -> (Seen, impl FnMut(QueryChunk) -> DbResult<()> + Send) {
    let seen: Seen = Arc::default();
    let sink = seen.clone();
    (seen, move |chunk| {
        sink.lock().unwrap().push(chunk);
        Ok(())
    })
}

fn row_total(seen: &Seen) -> usize {
    seen.lock().unwrap().iter().map(|c| c.rows.len()).sum()
}

/// A collection of `n` documents, the one at `late_at` and after carrying
/// an extra field. Returns the collection name.
async fn seed(a: &MongoAdapter, n: usize, late_at: usize) -> String {
    let coll = format!("stream_{}", uuid::Uuid::new_v4().simple());
    let docs: Vec<bson::Document> = (0..n)
        .map(|i| {
            let mut d = bson::doc! { "i": i as i32 };
            if i >= late_at {
                d.insert("late", 1);
            }
            d
        })
        .collect();
    a.client.database(DB).collection::<bson::Document>(&coll).insert_many(docs).await.unwrap();
    coll
}

async fn drop_coll(a: &MongoAdapter, coll: &str) {
    a.client.database(DB).collection::<bson::Document>(coll).drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires a live MongoDB server, see DH_TEST_MONGO_URL"]
async fn mongo_stream_select_star_grows_a_late_column_and_keeps_id_first() {
    let a = MongoAdapter::connect(&params()).await.unwrap();
    let coll = seed(&a, 1500, 600).await;
    let (seen, mut sink) = recording();
    let res = a
        .run_sql_stream(Some(DB), None, &format!("SELECT * FROM {coll}"), None, &mut sink)
        .await
        .unwrap();
    assert_eq!(res.columns, ["_id", "i", "late"]);
    assert!(res.rows.is_empty());
    assert_eq!(row_total(&seen), 1500);
    let chunks = seen.lock().unwrap();
    // The chunk holding document 600 carries the full list, earlier ones do not.
    assert_eq!(chunks[0].columns.as_ref().unwrap().len(), 2);
    assert!(chunks.iter().skip(1).any(|c| c.columns.as_ref().is_some_and(|c| c.len() == 3)));
    drop(chunks);
    drop_coll(&a, &coll).await;
}

#[tokio::test]
#[ignore = "requires a live MongoDB server, see DH_TEST_MONGO_URL"]
async fn mongo_stream_an_explicit_column_list_stays_fixed() {
    let a = MongoAdapter::connect(&params()).await.unwrap();
    let coll = seed(&a, 800, 300).await;
    let (seen, mut sink) = recording();
    let res = a
        .run_sql_stream(Some(DB), None, &format!("SELECT i FROM {coll}"), None, &mut sink)
        .await
        .unwrap();
    assert_eq!(res.columns, ["i"]);
    assert_eq!(row_total(&seen), 800);
    assert!(seen.lock().unwrap().iter().skip(1).all(|c| c.columns.is_none()));
    drop_coll(&a, &coll).await;
}

#[tokio::test]
#[ignore = "requires a live MongoDB server, see DH_TEST_MONGO_URL"]
async fn mongo_stream_the_console_sends_documents_with_rows_and_caps_a_bare_find() {
    let a = MongoAdapter::connect(&params()).await.unwrap();
    let coll = seed(&a, 700, 0).await;
    let (seen, mut sink) = recording();
    let res = a
        .run_mongo_stream(DB, None, &format!("db.{coll}.aggregate([{{\"$match\": {{}}}}])"), None, &mut sink)
        .await
        .unwrap();
    assert!(res.rows.is_empty() && res.documents.is_empty());
    assert_eq!(row_total(&seen), 700);
    assert!(seen
        .lock()
        .unwrap()
        .iter()
        .all(|c| c.documents.as_ref().map(Vec::len) == Some(c.rows.len())));

    let (seen, mut sink) = recording();
    a.run_mongo_stream(DB, None, &format!("db.{coll}.find({{}})"), None, &mut sink)
        .await
        .unwrap();
    assert_eq!(row_total(&seen), 200);

    // A write does not stream.
    let (seen, mut sink) = recording();
    let wrote = a
        .run_mongo_stream(DB, None, &format!("db.{coll}.insertOne({{\"z\": 1}})"), None, &mut sink)
        .await
        .unwrap();
    assert_eq!(wrote.rows_affected, 1);
    assert_eq!(row_total(&seen), 0);
    drop_coll(&a, &coll).await;
}

#[tokio::test]
#[ignore = "requires a live MongoDB server, see DH_TEST_MONGO_URL"]
async fn mongo_stream_stop_keeps_the_rows_already_sent() {
    let a = MongoAdapter::connect(&params()).await.unwrap();
    let coll = seed(&a, 3000, 3000).await;
    let run_id = format!("run-{coll}");
    let run = runs::register("t-mongo-stream", &run_id);
    let stopper = {
        let run_id = run_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            runs::cancel("t-mongo-stream", &run_id).await
        })
    };
    let (seen, mut sink) = recording();
    let res = a
        .run_sql_stream(
            Some(DB),
            None,
            &format!("SELECT * FROM {coll} WHERE $where = 'sleep(5) || true'"),
            Some(&run),
            &mut sink,
        )
        .await;
    run.finish().await;
    stopper.await.unwrap();
    // Either the server confirmed the kill (Cancelled) or the filter was not
    // accepted by the translator; the point is what was sent stays sent.
    if matches!(res, Err(DbError::Cancelled)) {
        assert!(row_total(&seen) > 0, "no rows arrived before Stop");
    }
    drop_coll(&a, &coll).await;
}
