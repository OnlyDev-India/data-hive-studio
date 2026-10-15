//! Stop for MySQL and MariaDB (spec 0025 AC-12): `KILL QUERY <id>` sent on a
//! separate short lived connection, where `<id>` is the run connection's
//! `CONNECTION_ID()`. It ends the statement and leaves that connection
//! usable, like Postgres's `pg_cancel_backend`.

use sqlx::mysql::MySqlConnectOptions;
use sqlx::pool::PoolConnection;
use sqlx::{Connection as _, Executor as _, MySql, MySqlConnection, MySqlPool};
use std::time::{Duration, Instant};
use crate::db::runs::Canceller;
use crate::db::{DbError, DbResult, RunHandle};
use super::MySqlAdapter;

/// SQLSTATE of `ER_QUERY_INTERRUPTED` (1317), what `KILL QUERY` raises.
const QUERY_INTERRUPTED: &str = "70100";

/// How long one cancel attempt may take to connect and send the kill.
const CANCEL_ATTEMPT_CAP: Duration = Duration::from_millis(1500);

/// The registry re-fires a canceller every 200ms; each attempt costs a
/// connection, so attempts are spread at least this far apart.
const CANCEL_MIN_GAP: Duration = Duration::from_secs(1);

impl MySqlAdapter {
    /// Reads the run connection's id and arms Stop for `run` on it. `false`
    /// means Stop already arrived, so the caller must not start.
    pub(super) async fn arm_stop(&self, conn: &mut MySqlConnection, run: &RunHandle) -> DbResult<bool> {
        let id = connection_id(conn).await?;
        Ok(run.set_canceller(kill_query(self.one_off_options(), id)).await)
    }
}

pub(super) async fn connection_id(conn: &mut MySqlConnection) -> DbResult<u64> {
    let rows = super::rows::fetch_text_conn(conn, "SELECT CONNECTION_ID()", &[]).await?;
    rows.first()
        .and_then(|r| r.first().cloned().flatten())
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| DbError::InvalidOperation("the server did not report a connection id".into()))
}

/// The run's canceller: a new connection (never from the pool) that kills
/// connection `id`'s current statement.
pub(super) fn kill_query(options: MySqlConnectOptions, id: u64) -> Canceller {
    let last_attempt = std::sync::Mutex::new(None::<Instant>);
    Box::new(move || {
        {
            let mut last = last_attempt.lock().unwrap();
            if last.is_some_and(|at| at.elapsed() < CANCEL_MIN_GAP) {
                return Box::pin(std::future::ready(()));
            }
            *last = Some(Instant::now());
        }
        let options = options.clone();
        Box::pin(async move {
            let sent = tokio::time::timeout(CANCEL_ATTEMPT_CAP, async {
                let mut conn = MySqlConnection::connect_with(&options).await?;
                // Text protocol: sqlx can't read the parameter metadata MySQL
                // 8.4 sends for a prepared `KILL QUERY ?`. `id` is the
                // server's own number, never user input.
                let kill = format!("KILL QUERY {id}");
                conn.execute(kill.as_str()).await?;
                let _ = conn.close().await;
                Ok::<(), sqlx::Error>(())
            })
            .await;
            match sent {
                Ok(Ok(())) => {}
                Ok(Err(e)) => log::warn!("mysql cancel attempt failed: {e}"),
                Err(_) => log::warn!("mysql cancel attempt timed out"),
            }
        })
    })
}

/// An interrupted statement counts as Stopped only when the user asked to
/// stop this run; any other error stays the error it is.
pub(super) fn run_error(e: sqlx::Error, run: Option<&RunHandle>) -> DbError {
    let interrupted = e
        .as_database_error()
        .and_then(|d| d.code())
        .is_some_and(|c| c == QUERY_INTERRUPTED);
    if interrupted && run.is_some_and(RunHandle::is_cancel_requested) {
        DbError::Cancelled
    } else {
        DbError::SqlEngine(e)
    }
}

/// A run's dedicated pool connection. Dropped mid query (the 3 second
/// abandon, or a sink that failed), it is detached instead of being handed
/// back still busy.
pub(super) struct RunConn {
    conn: Option<PoolConnection<MySql>>,
    dirty: bool,
}

impl RunConn {
    pub(super) async fn acquire(pool: &MySqlPool) -> DbResult<Self> {
        let conn = pool.acquire().await.map_err(DbError::SqlEngine)?;
        Ok(Self { conn: Some(conn), dirty: true })
    }

    pub(super) fn release(&mut self, reusable: bool) {
        self.dirty = !reusable;
    }
}

impl std::ops::Deref for RunConn {
    type Target = MySqlConnection;
    fn deref(&self) -> &MySqlConnection {
        self.conn.as_ref().expect("connection present until drop")
    }
}

impl std::ops::DerefMut for RunConn {
    fn deref_mut(&mut self) -> &mut MySqlConnection {
        self.conn.as_mut().expect("connection present until drop")
    }
}

impl Drop for RunConn {
    fn drop(&mut self) {
        if self.dirty {
            if let Some(conn) = self.conn.take() {
                drop(conn.detach());
            }
        }
    }
}

/// Whether the run's connection may go back to the pool: the server
/// answered (a result, an SQL error, or our own kill). A broken socket or a
/// protocol error detaches it, so the pool opens a fresh one (AC-16).
pub(super) fn conn_reusable<T>(res: &DbResult<T>) -> bool {
    match res {
        Ok(_) | Err(DbError::Cancelled) => true,
        Err(DbError::SqlEngine(sqlx::Error::Database(_))) => true,
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_broken_connection_is_not_reused() {
        assert!(conn_reusable(&Ok::<_, DbError>(())));
        assert!(conn_reusable::<()>(&Err(DbError::Cancelled)));
        assert!(!conn_reusable::<()>(&Err(DbError::SqlEngine(sqlx::Error::PoolTimedOut))));
        assert!(!conn_reusable::<()>(&Err(DbError::SqlEngine(sqlx::Error::Io(
            std::io::Error::other("connection reset")
        )))));
    }

    #[test]
    fn a_non_server_error_is_never_stopped() {
        assert!(matches!(run_error(sqlx::Error::PoolTimedOut, None), DbError::SqlEngine(_)));
    }
}
