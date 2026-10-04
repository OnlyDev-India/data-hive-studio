//! Previews and Run against a real MongoDB. All `#[ignore]`d: run with
//! `DH_TEST_MONGO_URL=mongodb://127.0.0.1:27017 cargo test -p dh-core -- --ignored pipeline_live`.

use crate::api::{PipelinePreviewRequest, PipelineRunRequest, PipelineSpec, PreviewChunk, QueryChunk, StageSpec};
use crate::db::mongodb::cancel::stop_tests::params;
use crate::db::mongodb::MongoAdapter;

const DB: &str = "dh_stop_test";

fn stage(id: &str, op: &str, body: &str) -> StageSpec {
    StageSpec { id: id.into(), op: op.into(), body: body.into(), enabled: true, title: None, note: None, branches: vec![] }
}

/// A fresh collection holding `{ n: 0..30, g: n % 3 }` in insert order.
async fn seeded() -> (MongoAdapter, String) {
    let a = MongoAdapter::connect(&params()).await.unwrap();
    let coll = format!("pipe_{}", uuid::Uuid::new_v4().simple());
    let docs: Vec<String> = (0..30).map(|n| format!("{{\"n\": {n}, \"g\": {}}}", n % 3)).collect();
    a.run_mongo(DB, None, &format!("db.{coll}.insertMany([{}])", docs.join(",")), None).await.unwrap();
    (a, coll)
}

fn spec() -> PipelineSpec {
    PipelineSpec {
        stages: vec![
            stage("m", "$match", "{ n: { $gte: 10 } }"),
            stage("g", "$group", "{ _id: \"$g\", c: { $sum: 1 } }"),
            stage("s", "$sort", "{ _id: 1 }"),
        ],
    }
}

#[tokio::test]
#[ignore = "requires a live MongoDB server, see DH_TEST_MONGO_URL"]
async fn pipeline_live_previews_every_card_on_the_capped_input() {
    let (a, coll) = seeded().await;
    let req = PipelinePreviewRequest {
        database: DB.into(),
        collection: coll.clone(),
        spec: spec(),
        from: None,
        cap: 25,
        time_ms: 10_000,
        show: 2,
        concurrency: 2,
        run_id: None,
    };
    let mut chunks: Vec<PreviewChunk> = Vec::new();
    let summary = a.pipeline_preview(&req, None, &mut |c| {
        chunks.push(c);
        Ok(())
    })
    .await
    .unwrap();
    chunks.sort_by_key(|c| ["m", "g", "s"].iter().position(|id| *id == c.stage_id));
    assert_eq!(chunks.iter().map(|c| c.count).collect::<Vec<_>>(), [15, 3, 3]);
    assert!(chunks.iter().all(|c| c.error.is_none()));
    assert_eq!(chunks[0].documents.len(), 2, "show caps the documents sent");
    assert_eq!(chunks[2].documents[0]["_id"], 0);
    assert_eq!(summary.source_estimate, Some(30));
    a.run_mongo(DB, None, &format!("db.{coll}.drop()"), None).await.unwrap();
}

#[tokio::test]
#[ignore = "requires a live MongoDB server, see DH_TEST_MONGO_URL"]
async fn pipeline_live_a_server_error_stops_the_cards_behind_it() {
    let (a, coll) = seeded().await;
    let mut spec = spec();
    spec.stages[1].body = "{ _id: \"$g\", c: { $nope: 1 } }".into();
    let req = PipelinePreviewRequest {
        database: DB.into(),
        collection: coll.clone(),
        spec,
        from: None,
        cap: 1000,
        time_ms: 10_000,
        show: 20,
        concurrency: 1,
        run_id: None,
    };
    let mut chunks: Vec<PreviewChunk> = Vec::new();
    a.pipeline_preview(&req, None, &mut |c| {
        chunks.push(c);
        Ok(())
    })
    .await
    .unwrap();
    let ids: Vec<&str> = chunks.iter().map(|c| c.stage_id.as_str()).collect();
    assert_eq!(ids, ["m", "g"]);
    assert!(chunks[1].error.as_deref().unwrap().contains("$nope"));
    a.run_mongo(DB, None, &format!("db.{coll}.drop()"), None).await.unwrap();
}

#[tokio::test]
#[ignore = "requires a live MongoDB server, see DH_TEST_MONGO_URL"]
async fn pipeline_live_run_streams_the_whole_result_with_no_cap() {
    let (a, coll) = seeded().await;
    let req = PipelineRunRequest {
        database: DB.into(),
        collection: coll.clone(),
        spec: PipelineSpec { stages: vec![stage("m", "$match", "{ n: { $gte: 10 } }")] },
        allow_disk_use: true,
        run_id: None,
    };
    let mut rows = 0;
    let res = a.pipeline_run(&req, None, &mut |c: QueryChunk| {
        rows += c.rows.len();
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(rows, 20);
    assert!(res.error.is_none());
    assert!(res.command.starts_with(&format!("db.{coll}.aggregate(")));
    a.run_mongo(DB, None, &format!("db.{coll}.drop()"), None).await.unwrap();
}
