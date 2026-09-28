//! SQLite backend for the database layer.
//!
//! The database lives in a temp file. On [`SqliteAdapter::open`] the incoming
//! bytes are written to that file; [`SqliteAdapter::save_bytes`] checkpoints
//! the WAL and reads the file back so the original DB can be downloaded
//! byte-for-byte.

mod interrupt;
mod catalog;
mod query;
mod explain;
mod edit;
mod schema_ops;
mod alter;
mod duplicate;
mod import_rows;
mod adapter;
#[cfg(test)]
mod import_tests;
#[cfg(test)]
mod tests;

use std::path::PathBuf;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool};
use crate::api::ConnGuard;
use super::read_only::ReadOnlyGuard;
use super::{DbError, DbResult};
use super::{OpOutcome, inline_placeholders};

/// Rows per streamed IPC chunk. Big enough to amortize channel overhead,
/// small enough that the first paint lands almost immediately.
const STREAM_BATCH_ROWS: usize = 256;

pub struct SqliteAdapter {
    pool: SqlitePool,
    path: PathBuf,
    /// Refuses writes on a read only connection (spec 0007). Fixed for the
    /// life of the adapter.
    guard: ReadOnlyGuard,
}

impl SqliteAdapter {
    /// Open (or create) a database backed by a temp file. `bytes` seeds the
    /// file if provided (existing db), otherwise a fresh empty db is created.
    ///
    /// A read only connection sets `query_only` on every pooled connection
    /// (the file is our own temp copy, so it cannot be opened read only and
    /// still be seeded). The SQL check refuses the PRAGMA that turns it off.
    pub async fn open(name: &str, bytes: Option<&[u8]>, guard: &ConnGuard) -> DbResult<Self> {
        let path = temp_path(name)?;
        if let Some(b) = bytes {
            std::fs::write(&path, b)?;
        }
        Self::connect_guarded(path, ReadOnlyGuard::new(guard.read_only), false).await
    }

    /// Open a database directly at `real_path` (the file the user picked).
    /// The connection works against the original file, so every change is
    /// persisted in place — no separate save step is required.
    ///
    /// A read only connection opens the file with the read only flag, which no
    /// statement can undo, and never touches the journal mode (switching it is
    /// itself a write). A missing file is an error, not a new empty database.
    pub async fn open_at(real_path: &std::path::Path, guard: &ConnGuard) -> DbResult<Self> {
        Self::connect_guarded(real_path.to_path_buf(), ReadOnlyGuard::new(guard.read_only), true).await
    }

    #[cfg(test)]
    pub(super) async fn connect(path: PathBuf) -> DbResult<Self> {
        Self::connect_guarded(path, ReadOnlyGuard::default(), false).await
    }

    /// `file_backed`: the path is the user's own file, not a temp copy.
    async fn connect_guarded(path: PathBuf, guard: ReadOnlyGuard, file_backed: bool) -> DbResult<Self> {
        let options = SqliteConnectOptions::new().filename(&path).foreign_keys(true);
        let options = match (guard.is_on(), file_backed) {
            (true, true) => options.read_only(true),
            (true, false) => options
                .create_if_missing(true)
                .journal_mode(SqliteJournalMode::Wal)
                .pragma("query_only", "ON"),
            (false, _) => options.create_if_missing(true).journal_mode(SqliteJournalMode::Wal),
        };
        let pool = SqlitePool::connect_with(options).await.map_err(DbError::SqlEngine)?;
        Ok(Self { pool, path, guard })
    }

    /// Whether this connection is backed by a real user file (vs a temp copy
    /// that should be cleaned up on close).
    pub fn has_real_path(&self) -> bool {
        let dir = std::env::temp_dir().join("dh-studio");
        !self.path.starts_with(&dir)
    }

    /// The underlying database file. Also used to clean up temp files.
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    pub fn display_name(&self) -> &str {
        "SQLite"
    }

    /// Merge the WAL into the main database file so the file alone holds all
    /// changes (used before save and before closing a connection).
    pub async fn checkpoint(&self) -> DbResult<()> {
        let merged = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&self.pool)
            .await
            .map_err(DbError::SqlEngine);
        // A read only connection never wrote anything to merge, and the
        // database may refuse the checkpoint: that is not a failure.
        match merged {
            Err(_) if self.guard.is_on() => Ok(()),
            other => other.map(|_| ()),
        }
    }

    /// Serialize the full database contents to bytes (for download/save).
    pub async fn save_bytes(&self) -> DbResult<Vec<u8>> {
        // Flush WAL into the main db file so the file alone is the whole database.
        self.checkpoint().await?;
        std::fs::read(&self.path).map_err(DbError::Io)
    }

    /// Close the pool, waiting for any in-flight queries to finish. SQLite
    /// normally removes `.db-wal`/`.db-shm` once the last handle is closed.
    pub async fn close_pool(&self) {
        self.pool.close().await;
    }

    /// Remove any leftover WAL/shared-memory sibling files (the `.db` itself
    /// is kept). SQLite names these `<db>-wal` and `<db>-shm`.
    pub fn remove_aux_files(&self) {
        let _ = std::fs::remove_file(format!("{}-wal", self.path().display()));
        let _ = std::fs::remove_file(format!("{}-shm", self.path().display()));
    }

    /// Remove the database file and any leftover WAL/shared-memory siblings.
    pub fn remove_files(&self) {
        self.remove_aux_files();
        let _ = std::fs::remove_file(self.path());
    }
}

fn temp_path(name: &str) -> DbResult<PathBuf> {
    let dir = std::env::temp_dir().join("dh-studio");
    std::fs::create_dir_all(&dir)?;
    let safe = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    let path = dir.join(format!("{}-{}.db", safe, uuid::Uuid::new_v4()));
    Ok(path)
}
