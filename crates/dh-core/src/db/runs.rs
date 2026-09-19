//! Registry of stoppable editor runs (spec 0006).
//!
//! Every SQL editor run carries a `run_id` minted by the app. The run's
//! adapter registers a `canceller` here once it holds the connection it will
//! query on; `cancel` then asks the database itself to stop (SQLite
//! interrupt, and later Postgres `pg_cancel_backend` / Mongo `killOp`) rather
//! than just ignoring the result. The registry holds ids and handles only,
//! never SQL text or rows.
//!
//! Cancel and finish are serialized on the entry's own lock: once `finish`
//! has run, a cancel does nothing, so an interrupt can never land on a later
//! query that reused the same connection.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};
use tokio::sync::{watch, Mutex as AsyncMutex};

use super::{DbError, DbResult};

/// How long a cancel waits for the database to confirm before the run is
/// abandoned and the tab freed anyway (AC-9).
pub const CONFIRM_CAP: Duration = Duration::from_secs(3);
/// A cancel that lands before the statement has started is a no-op on some
/// engines (SQLite ignores an interrupt with nothing running), so the
/// canceller is re-fired on this cadence until the run ends.
const RETRY_EVERY: Duration = Duration::from_millis(200);
/// A cancel for a run that has not registered yet leaves a marker this long,
/// so a run whose command arrives late starts already cancelled.
const MARKER_TTL: Duration = Duration::from_secs(10);

/// Asks the engine to stop the run's statement. Called under the entry lock,
/// possibly more than once, so it must be safe to repeat.
pub type Canceller = Box<dyn Fn() -> BoxFuture<'static, ()> + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CancelState {
    /// The run ended after the cancel (the database confirmed it, or it
    /// finished on its own a moment later).
    Stopped,
    /// No confirmation within the cap; the run was abandoned.
    WindingDown,
    /// Nothing to cancel: unknown, wrong connection, or already finished.
    NotRunning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CancelOutcome {
    pub state: CancelState,
}

struct Slot {
    canceller: Option<Canceller>,
    finished: bool,
}

struct RunEntry {
    run_id: String,
    conn_id: String,
    cancel_requested: AtomicBool,
    slot: AsyncMutex<Slot>,
    /// Flips once, when the run finishes.
    done: watch::Sender<bool>,
    /// Flips once, when the cap passes without confirmation.
    abandon: watch::Sender<bool>,
}

#[derive(Default)]
struct Registry {
    runs: HashMap<String, Arc<RunEntry>>,
    markers: HashMap<String, Instant>,
}

fn registry() -> &'static Mutex<Registry> {
    static REG: OnceLock<Mutex<Registry>> = OnceLock::new();
    REG.get_or_init(Default::default)
}

/// One run's side of the registry, held by the code that executes it.
pub struct RunHandle {
    entry: Arc<RunEntry>,
}

/// Register a run before it starts. A `run_id` that was cancelled before it
/// got here starts already cancelled.
pub fn register(conn_id: &str, run_id: &str) -> RunHandle {
    let mut reg = registry().lock().unwrap();
    reg.markers.retain(|_, at| at.elapsed() < MARKER_TTL);
    let pre_cancelled = reg.markers.remove(run_id).is_some();
    let entry = Arc::new(RunEntry {
        run_id: run_id.to_string(),
        conn_id: conn_id.to_string(),
        cancel_requested: AtomicBool::new(pre_cancelled),
        slot: AsyncMutex::new(Slot { canceller: None, finished: false }),
        done: watch::channel(false).0,
        abandon: watch::channel(false).0,
    });
    reg.runs.insert(run_id.to_string(), entry.clone());
    RunHandle { entry }
}

impl RunHandle {
    /// The id the app minted for this run. Mongo tags every operation of the
    /// run with it (as the `comment`) so Stop can find them again.
    pub fn run_id(&self) -> &str {
        &self.entry.run_id
    }

    /// Whether Stop was asked for this run. An engine cancel error only
    /// becomes "stopped" when this is set; otherwise it stays a real error.
    pub fn is_cancel_requested(&self) -> bool {
        self.entry.cancel_requested.load(Ordering::SeqCst)
    }

    /// Arm the run's canceller once its connection is held. Returns `false`
    /// when Stop already arrived, in which case the caller must not start
    /// the statement.
    pub async fn set_canceller(&self, canceller: Canceller) -> bool {
        let mut slot = self.entry.slot.lock().await;
        if self.is_cancel_requested() {
            return false;
        }
        slot.canceller = Some(canceller);
        true
    }

    /// Resolves when the cap passed without the database confirming. Race
    /// the query against this and drop it when it fires.
    pub async fn abandoned(&self) {
        let mut rx = self.entry.abandon.subscribe();
        let _ = rx.wait_for(|fired| *fired).await;
    }

    /// Mark the run over. Must be called BEFORE the run's connection goes
    /// back to the pool: it drops the canceller under the entry lock, so no
    /// later cancel can touch a connection that has moved on.
    pub async fn finish(&self) {
        finish_entry(&self.entry).await;
    }
}

impl Drop for RunHandle {
    fn drop(&mut self) {
        // The normal path already finished; this covers a dropped future.
        if *self.entry.done.borrow() {
            return;
        }
        if let Ok(rt) = tokio::runtime::Handle::try_current() {
            let entry = self.entry.clone();
            rt.spawn(async move { finish_entry(&entry).await });
        }
    }
}

async fn finish_entry(entry: &Arc<RunEntry>) {
    {
        let mut slot = entry.slot.lock().await;
        slot.canceller = None;
        slot.finished = true;
    }
    entry.done.send_replace(true);
    let mut reg = registry().lock().unwrap();
    if reg.runs.get(&entry.run_id).is_some_and(|e| Arc::ptr_eq(e, entry)) {
        reg.runs.remove(&entry.run_id);
    }
}

/// Await `call`, but give up on it (dropping it) if the run is abandoned:
/// the database did not confirm the cancel within the cap, so the caller is
/// freed anyway. With no `run` this is just `call.await`.
pub(super) async fn until_abandoned<T>(
    run: Option<&RunHandle>,
    call: impl std::future::Future<Output = DbResult<T>>,
) -> DbResult<T> {
    match run {
        Some(r) => tokio::select! {
            res = call => res,
            _ = r.abandoned() => Err(DbError::Cancelled),
        },
        None => call.await,
    }
}

/// Ask the database to stop `run_id` on `conn_id`, waiting up to the confirm
/// cap. Cancelling a finished, unknown, or other connection's run is not an
/// error, it just reports `NotRunning`.
pub async fn cancel(conn_id: &str, run_id: &str) -> CancelOutcome {
    cancel_within(conn_id, run_id, CONFIRM_CAP).await
}

async fn cancel_within(conn_id: &str, run_id: &str, cap: Duration) -> CancelOutcome {
    let entry = {
        let mut reg = registry().lock().unwrap();
        match reg.runs.get(run_id) {
            Some(e) if e.conn_id == conn_id => e.clone(),
            Some(_) => return CancelOutcome { state: CancelState::NotRunning },
            None => {
                reg.markers.insert(run_id.to_string(), Instant::now());
                return CancelOutcome { state: CancelState::NotRunning };
            }
        }
    };
    entry.cancel_requested.store(true, Ordering::SeqCst);

    let started = Instant::now();
    let mut done = entry.done.subscribe();
    let mut first = true;
    loop {
        {
            let slot = entry.slot.lock().await;
            if slot.finished {
                // Finished before we got the lock: it beat the cancel.
                let state = if first { CancelState::NotRunning } else { CancelState::Stopped };
                return CancelOutcome { state };
            }
            if let Some(canceller) = slot.canceller.as_ref() {
                canceller().await;
            }
        }
        first = false;
        let remaining = cap.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            entry.abandon.send_replace(true);
            return CancelOutcome { state: CancelState::WindingDown };
        }
        tokio::select! {
            _ = done.wait_for(|d| *d) => return CancelOutcome { state: CancelState::Stopped },
            _ = tokio::time::sleep(RETRY_EVERY.min(remaining)) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn counting_canceller(hits: Arc<AtomicUsize>) -> Canceller {
        Box::new(move || {
            hits.fetch_add(1, Ordering::SeqCst);
            Box::pin(std::future::ready(()))
        })
    }

    #[tokio::test]
    async fn unknown_run_is_not_running_and_leaves_a_marker() {
        let out = cancel("conn-a", "run-unknown-1").await;
        assert_eq!(out.state, CancelState::NotRunning);
        // The command shows up late: it starts already cancelled.
        let run = register("conn-a", "run-unknown-1");
        assert!(run.is_cancel_requested());
        assert!(!run.set_canceller(counting_canceller(Default::default())).await);
        run.finish().await;
    }

    #[tokio::test]
    async fn cancel_fires_the_canceller_and_reports_stopped_on_finish() {
        let run = register("conn-a", "run-fire-1");
        let hits = Arc::new(AtomicUsize::new(0));
        assert!(run.set_canceller(counting_canceller(hits.clone())).await);

        let finisher = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            run.finish().await;
        });
        let out = cancel_within("conn-a", "run-fire-1", Duration::from_secs(2)).await;
        finisher.await.unwrap();
        assert_eq!(out.state, CancelState::Stopped);
        assert!(hits.load(Ordering::SeqCst) >= 1);
    }

    #[tokio::test]
    async fn cancel_after_finish_does_nothing() {
        let run = register("conn-a", "run-late-1");
        let hits = Arc::new(AtomicUsize::new(0));
        assert!(run.set_canceller(counting_canceller(hits.clone())).await);
        run.finish().await;
        let out = cancel("conn-a", "run-late-1").await;
        assert_eq!(out.state, CancelState::NotRunning);
        assert_eq!(hits.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn another_connections_run_cannot_be_cancelled() {
        let run = register("conn-a", "run-conn-1");
        let out = cancel("conn-b", "run-conn-1").await;
        assert_eq!(out.state, CancelState::NotRunning);
        assert!(!run.is_cancel_requested());
        run.finish().await;
    }

    /// AC-9: a query the database never stops is dropped at the cap, so the
    /// caller is freed with `Cancelled` instead of waiting on it forever.
    #[tokio::test]
    async fn a_stuck_query_is_dropped_when_the_run_is_abandoned() {
        let run = register("conn-a", "run-stuck-1");
        let stuck = std::future::pending::<DbResult<()>>();
        let stopper = cancel_within("conn-a", "run-stuck-1", Duration::from_millis(400));
        let (res, out) = tokio::join!(until_abandoned(Some(&run), stuck), stopper);
        assert!(matches!(res, Err(DbError::Cancelled)));
        assert_eq!(out.state, CancelState::WindingDown);
        run.finish().await;
    }

    #[tokio::test]
    async fn without_a_run_the_call_is_simply_awaited() {
        let res = until_abandoned(None, async { Ok::<_, DbError>(7) }).await;
        assert!(matches!(res, Ok(7)));
    }

    #[tokio::test]
    async fn no_confirmation_within_the_cap_abandons_the_run() {
        let run = register("conn-a", "run-cap-1");
        // No canceller armed, so nothing can confirm.
        let waiter = async {
            run.abandoned().await;
        };
        let out = cancel_within("conn-a", "run-cap-1", Duration::from_millis(400));
        let (out, ()) = tokio::join!(out, waiter);
        assert_eq!(out.state, CancelState::WindingDown);
        run.finish().await;
    }

    /// SQLite ignores an interrupt that lands before the statement starts, so
    /// the canceller is fired again until the run ends, not once.
    #[tokio::test]
    async fn cancel_fires_the_canceller_again_until_the_run_ends() {
        let run = register("conn-a", "run-retry-1");
        let hits = Arc::new(AtomicUsize::new(0));
        assert!(run.set_canceller(counting_canceller(hits.clone())).await);

        let finisher = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(700)).await;
            run.finish().await;
        });
        let out = cancel_within("conn-a", "run-retry-1", Duration::from_secs(3)).await;
        finisher.await.unwrap();

        assert_eq!(out.state, CancelState::Stopped);
        assert!(hits.load(Ordering::SeqCst) >= 2, "fired {} time(s)", hits.load(Ordering::SeqCst));
    }

    /// AC-7 groundwork: a run still waiting for its connection has no
    /// canceller yet. Stop marks it, and when it later tries to arm itself it
    /// is told not to start.
    #[tokio::test]
    async fn a_queued_run_that_was_stopped_is_told_not_to_start() {
        let run = register("conn-a", "run-queued-1");
        let stopper = tokio::spawn(cancel_within("conn-a", "run-queued-1", Duration::from_secs(2)));
        tokio::time::sleep(Duration::from_millis(50)).await;

        assert!(run.is_cancel_requested());
        let hits = Arc::new(AtomicUsize::new(0));
        assert!(!run.set_canceller(counting_canceller(hits.clone())).await);
        run.finish().await;

        assert_eq!(stopper.await.unwrap().state, CancelState::Stopped);
        assert_eq!(hits.load(Ordering::SeqCst), 0, "a run that never started has nothing to interrupt");
    }

    /// AC-13: only a real Stop turns an engine cancel error into "stopped".
    #[tokio::test]
    async fn a_run_is_only_flagged_as_stopped_once_stop_was_asked() {
        let run = register("conn-a", "run-flag-1");
        assert!(!run.is_cancel_requested());

        let out = cancel_within("conn-a", "run-flag-1", Duration::from_millis(100)).await;

        assert_eq!(out.state, CancelState::WindingDown);
        assert!(run.is_cancel_requested());
        run.finish().await;
    }

    #[tokio::test]
    async fn a_dropped_run_lets_go_of_its_canceller() {
        let run = register("conn-a", "run-drop-1");
        let hits = Arc::new(AtomicUsize::new(0));
        assert!(run.set_canceller(counting_canceller(hits.clone())).await);

        // The caller's future was dropped before it could call `finish`.
        drop(run);
        tokio::time::sleep(Duration::from_millis(100)).await;
        let out = cancel("conn-a", "run-drop-1").await;

        assert_eq!(out.state, CancelState::NotRunning);
        assert_eq!(hits.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn finishing_twice_is_harmless() {
        let run = register("conn-a", "run-twice-1");
        run.finish().await;
        run.finish().await;

        assert_eq!(cancel("conn-a", "run-twice-1").await.state, CancelState::NotRunning);
    }

    #[tokio::test]
    async fn a_finished_run_id_can_be_used_again_without_being_flagged() {
        let first = register("conn-a", "run-reuse-1");
        first.finish().await;

        let second = register("conn-a", "run-reuse-1");

        assert!(!second.is_cancel_requested());
        assert!(second.set_canceller(counting_canceller(Default::default())).await);
        second.finish().await;
    }

    /// An older run finishing must not unregister a newer run that picked up
    /// the same id, or that run could no longer be stopped.
    #[tokio::test]
    async fn an_older_run_finishing_leaves_a_newer_run_with_the_same_id_stoppable() {
        let older = register("conn-a", "run-same-id-1");
        let newer = register("conn-a", "run-same-id-1");
        let hits = Arc::new(AtomicUsize::new(0));
        assert!(newer.set_canceller(counting_canceller(hits.clone())).await);

        older.finish().await;
        let out = cancel_within("conn-a", "run-same-id-1", Duration::from_millis(250)).await;

        assert_eq!(out.state, CancelState::WindingDown);
        assert!(hits.load(Ordering::SeqCst) >= 1);
        newer.finish().await;
    }

    #[tokio::test]
    async fn two_stops_for_one_run_both_resolve() {
        let run = register("conn-a", "run-double-1");
        assert!(run.set_canceller(counting_canceller(Default::default())).await);

        let finisher = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            run.finish().await;
        });
        let (a, b) = tokio::join!(
            cancel_within("conn-a", "run-double-1", Duration::from_secs(2)),
            cancel_within("conn-a", "run-double-1", Duration::from_secs(2)),
        );
        finisher.await.unwrap();

        assert_eq!(a.state, CancelState::Stopped);
        assert_eq!(b.state, CancelState::Stopped);
    }

    #[tokio::test]
    async fn a_healthy_run_is_not_reported_as_abandoned() {
        let run = register("conn-a", "run-healthy-1");

        let waited = tokio::time::timeout(Duration::from_millis(150), run.abandoned()).await;

        assert!(waited.is_err(), "abandoned() must stay pending until a cancel runs out of time");
        run.finish().await;
    }

    #[tokio::test]
    async fn a_query_that_ends_before_the_cap_keeps_its_own_result_and_error() {
        let run = register("conn-a", "run-own-error-1");

        let res = until_abandoned(Some(&run), async {
            Err::<(), _>(DbError::InvalidOperation("boom".into()))
        })
        .await;

        assert!(matches!(res, Err(DbError::InvalidOperation(m)) if m == "boom"));
        run.finish().await;
    }

    /// The desktop frontend reads this shape (`CancelOutcome` in
    /// `src/shared/api/types.ts`), so the wire names are part of the contract.
    #[test]
    fn the_outcome_is_sent_to_the_frontend_with_snake_case_states() {
        let wire = |state| serde_json::to_string(&CancelOutcome { state }).unwrap();

        assert_eq!(wire(CancelState::Stopped), r#"{"state":"stopped"}"#);
        assert_eq!(wire(CancelState::WindingDown), r#"{"state":"winding_down"}"#);
        assert_eq!(wire(CancelState::NotRunning), r#"{"state":"not_running"}"#);
    }
}
