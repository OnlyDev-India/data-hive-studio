//! Shared setup for `dh-core` integration tests. Goes through the same
//! public registry API `src-tauri/commands.rs` uses (not adapter internals,
//! which aren't `pub`), so tests exercise the real dispatch path.

use dh_core::api::DbKind;

/// Open a fresh, empty, temp-file-backed SQLite connection and return its
/// registry `conn_id`. Each call gets its own isolated database.
pub async fn temp_sqlite_conn() -> String {
    let name = format!("dh-core-test-{}", uuid::Uuid::new_v4());
    let info = dh_core::db::open_database(&DbKind::Sqlite, &name, None)
        .await
        .expect("open temp sqlite connection");
    info.id
}
