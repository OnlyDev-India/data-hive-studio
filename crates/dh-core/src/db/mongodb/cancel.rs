use futures_util::TryStreamExt;
use bson::{doc, Bson};
use mongodb::error::{ErrorKind, WriteFailure};
use mongodb::Client;
use crate::db::runs::Canceller;
use crate::db::{DbError, DbResult, RunHandle};
use super::MongoAdapter;

// ---- Stop a running query (spec 0006) ----

/// Server error codes a killed operation reports: `Interrupted` (what
/// `killOp` produces) and `CursorKilled`.
const MONGO_INTERRUPT_CODES: [i32; 2] = [11601, 237];

/// How long one cancel attempt (`currentOp` then `killOp`) may take before it
/// gives up; the run's 3 second confirm cap then frees the tab anyway.
const MONGO_CANCEL_ATTEMPT_CAP: std::time::Duration = std::time::Duration::from_millis(1500);

/// The run id as the `comment` every operation of the run carries, so
/// `currentOp` can find them again. `None` for a run Stop cannot reach.
pub(super) fn run_comment(run: Option<&RunHandle>) -> Option<Bson> {
    run.map(|r| Bson::String(r.run_id().to_string()))
}

/// A driver error becomes `Cancelled` only when the server interrupted the
/// operation AND the user asked to stop this run; anything else stays the
/// error it is (AC-13).
pub(super) fn mongo_err(e: mongodb::error::Error, run: Option<&RunHandle>) -> DbError {
    if run.is_some_and(RunHandle::is_cancel_requested) && is_interrupt_error(&e) {
        return DbError::Cancelled;
    }
    DbError::InvalidOperation(format!("mongo: {e}"))
}

fn is_interrupt_error(e: &mongodb::error::Error) -> bool {
    let code = match e.kind.as_ref() {
        ErrorKind::Command(ce) => Some(ce.code),
        ErrorKind::Write(WriteFailure::WriteError(we)) => Some(we.code),
        _ => None,
    };
    match code {
        Some(c) => MONGO_INTERRUPT_CODES.contains(&c),
        // Bulk shaped errors bury the code; the server's own words are stable.
        None => e.to_string().to_lowercase().contains("operation was interrupted"),
    }
}

/// The `currentOp` filter that finds a run's operations: the operation
/// itself, or (for a getMore) the command that opened its cursor.
pub(super) fn current_op_filter(run_id: &str) -> bson::Document {
    doc! { "$or": [
        { "command.comment": run_id },
        { "originatingCommand.comment": run_id },
    ] }
}

/// Builds the run's canceller: find the run's operations through
/// `$currentOp` (only this user's, so it needs no extra privilege) and
/// `killOp` each. Any failure (typically a missing privilege) is logged and
/// swallowed: the 3 second cap then frees the tab and the tab says the
/// server may keep running it (AC-6).
pub(super) fn mongo_canceller(client: Client, run_id: String) -> Canceller {
    Box::new(move || {
        let client = client.clone();
        let run_id = run_id.clone();
        Box::pin(async move {
            let attempt = async {
                let admin = client.database("admin");
                let pipeline = vec![
                    doc! { "$currentOp": { "allUsers": false, "idleConnections": false } },
                    doc! { "$match": current_op_filter(&run_id) },
                ];
                let mut cursor = admin.aggregate(pipeline).await?;
                while let Some(op) = cursor.try_next().await? {
                    if let Some(opid) = op.get("opid") {
                        admin.run_command(doc! { "killOp": 1, "op": opid.clone() }).await?;
                    }
                }
                Ok::<(), mongodb::error::Error>(())
            };
            match tokio::time::timeout(MONGO_CANCEL_ATTEMPT_CAP, attempt).await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => log::warn!("mongo cancel attempt failed: {e}"),
                Err(_) => log::warn!("mongo cancel attempt timed out"),
            }
        })
    })
}

impl MongoAdapter {
    /// Arm Stop for a run before its first operation. Fails with `Cancelled`
    /// when Stop already arrived, so nothing starts.
    pub(super) async fn arm_kill_op(&self, run: Option<&RunHandle>) -> DbResult<()> {
        let Some(run) = run else { return Ok(()) };
        let canceller = mongo_canceller(self.client.clone(), run.run_id().to_string());
        if run.set_canceller(canceller).await {
            Ok(())
        } else {
            Err(DbError::Cancelled)
        }
    }
}

/// Stop a running query (spec 0006) against a real MongoDB. All `#[ignore]`d:
/// run with `DH_TEST_MONGO_URL=mongodb://127.0.0.1:27017 cargo test -p dh-core
/// -- --ignored mongo_stop` (default URL below; JavaScript must be enabled
/// on the server for the `$where` sleep used as the slow operation).
#[cfg(test)]
mod stop_tests {
    use super::*;
    use crate::db::mongodb::params::MongoParams;
    use crate::db::QueryChunk;
    use crate::db::runs;
    use std::time::{Duration, Instant};

    fn params() -> MongoParams {
        let url = std::env::var("DH_TEST_MONGO_URL")
            .unwrap_or_else(|_| "mongodb://127.0.0.1:27017".to_string());
        let rest = url.strip_prefix("mongodb://").expect("a mongodb:// url");
        let (auth, hostport) = rest.rsplit_once('@').unwrap_or(("", rest));
        let (user, password) = auth.split_once(':').unwrap_or((auth, ""));
        let (host, port) = hostport.split_once(':').unwrap_or((hostport, "27017"));
        serde_json::from_value(serde_json::json!({
            "host": host, "port": port.trim_end_matches('/').parse::<u16>().unwrap(),
            "user": user, "password": password, "database": "dh_stop_test",
        }))
        .unwrap()
    }

    fn sink() -> impl FnMut(QueryChunk) -> DbResult<()> + Send {
        |_chunk: QueryChunk| Ok(())
    }

    /// AC-3, AC-6: Stop kills the operation on the server (it is gone from
    /// `$currentOp` and stops using the database), and the console runs the
    /// next command right away.
    #[tokio::test]
    #[ignore = "requires a live MongoDB server, see DH_TEST_MONGO_URL"]
    async fn mongo_stop_kills_the_operation_on_the_server() {
        let a = MongoAdapter::connect(&params()).await.unwrap();
        let coll = format!("stop_{}", uuid::Uuid::new_v4().simple());
        a.run_mongo("dh_stop_test", None, &format!("db.{coll}.insertOne({{\"a\": 1}})"), None)
            .await
            .unwrap();

        let run_id = format!("run-{coll}");
        let run = runs::register("t-mongo-live", &run_id);
        let stopper = {
            let run_id = run_id.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(600)).await;
                runs::cancel("t-mongo-live", &run_id).await
            })
        };
        let started = Instant::now();
        let res = a
            .run_mongo(
                "dh_stop_test",
                None,
                &format!("db.{coll}.find({{\"$where\": \"sleep(60000) || true\"}})"),
                Some(&run),
            )
            .await;
        assert!(matches!(res, Err(DbError::Cancelled)), "got {res:?}");
        assert!(started.elapsed() < Duration::from_secs(5), "killOp should land fast");
        assert_eq!(stopper.await.unwrap().state, runs::CancelState::Stopped);

        // Gone from $currentOp, not merely ignored by the app.
        let admin = a.client.database("admin");
        let mut cursor = admin
            .aggregate(vec![
                doc! { "$currentOp": { "allUsers": false } },
                doc! { "$match": current_op_filter(&run_id) },
            ])
            .await
            .unwrap();
        assert!(cursor.try_next().await.unwrap().is_none(), "the operation is still running");

        let next = a
            .run_mongo("dh_stop_test", None, &format!("db.{coll}.countDocuments({{}})"), None)
            .await
            .unwrap();
        assert!(next.error.is_none());
        a.run_mongo("dh_stop_test", None, &format!("db.{coll}.drop()"), None).await.unwrap();
    }

    /// A Stop that arrives before the command does: nothing runs (this is the
    /// SQL editor's path, a SELECT translated to a find).
    #[tokio::test]
    #[ignore = "requires a live MongoDB server, see DH_TEST_MONGO_URL"]
    async fn mongo_stop_before_start_never_runs() {
        let a = MongoAdapter::connect(&params()).await.unwrap();
        runs::cancel("t-mongo-live", "run-mongo-early").await;
        let run = runs::register("t-mongo-live", "run-mongo-early");
        let mut on_batch = sink();
        let res = a
            .run_sql_stream(Some("dh_stop_test"), None, "SELECT * FROM anything", Some(&run), &mut on_batch)
            .await;
        assert!(matches!(res, Err(DbError::Cancelled)), "got {res:?}");
    }
}
