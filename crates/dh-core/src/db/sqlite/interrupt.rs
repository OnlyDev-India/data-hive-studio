use std::ptr::NonNull;
use sqlx::sqlite::SqliteConnection;
use crate::db::{DbError, DbResult, RunHandle};

/// SQLite's `SQLITE_INTERRUPT` result code, what a statement returns after
/// `sqlite3_interrupt`.
const SQLITE_INTERRUPT_CODE: &str = "9";

/// A run's connection handle, kept so Stop can interrupt its statement from
/// another thread.
#[derive(Clone, Copy)]
pub(super) struct InterruptHandle(pub(super) NonNull<libsqlite3_sys::sqlite3>);

// SAFETY: `sqlite3_interrupt` is documented as safe to call from any thread
// while the connection is open. The pointer is only ever used through the
// run registry's canceller, which is dropped (`RunHandle::finish`) before the
// run's connection returns to the pool, so it never outlives the connection.
unsafe impl Send for InterruptHandle {}

unsafe impl Sync for InterruptHandle {}

impl InterruptHandle {
    pub(super) fn interrupt(self) {
        // SAFETY: see the impl-level note above.
        unsafe { libsqlite3_sys::sqlite3_interrupt(self.0.as_ptr()) }
    }
}

/// Arm Stop for a run: register an interrupt for its connection. Fails with
/// `Cancelled` when Stop already arrived, so the statement never starts.
pub(super) async fn arm_interrupt(conn: &mut SqliteConnection, run: Option<&RunHandle>) -> DbResult<()> {
    let Some(run) = run else { return Ok(()) };
    let handle = InterruptHandle(
        conn.lock_handle().await.map_err(DbError::SqlEngine)?.as_raw_handle(),
    );
    let armed = run
        .set_canceller(Box::new(move || {
            handle.interrupt();
            Box::pin(std::future::ready(()))
        }))
        .await;
    if armed {
        Ok(())
    } else {
        Err(DbError::Cancelled)
    }
}

/// An engine error becomes `Cancelled` only when it is an interrupt AND the
/// user asked to stop this run; any other interrupt-shaped or engine error
/// stays the error it is.
pub(super) fn run_error(e: sqlx::Error, run: Option<&RunHandle>) -> DbError {
    let interrupted = e
        .as_database_error()
        .and_then(|d| d.code())
        .is_some_and(|c| c == SQLITE_INTERRUPT_CODE);
    if interrupted && run.is_some_and(RunHandle::is_cancel_requested) {
        DbError::Cancelled
    } else {
        DbError::SqlEngine(e)
    }
}

/// Unregister the run's canceller. Called BEFORE the run's connection goes
/// back to the pool, so a late Stop can never interrupt a later query.
pub(super) async fn release_run(run: Option<&RunHandle>) {
    if let Some(run) = run {
        run.finish().await;
    }
}
