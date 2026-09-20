//! Database layer for the Tauri backend.
//!
//! Every connection works against a temporary file so the file can always be
//! serialized back for download. Connections are held in a process-wide
//! registry keyed by a connection id.

/// Runs a single-name, no-result operation through `with_connection` and logs
/// success/failure to the activity log — the shape shared by every simple
/// server-catalog DDL op below (only the adapter method, activity kind, and
/// target label text differ per call). All sidebar/schema-designer actions,
/// never the editor — always logged as app-initiated.
macro_rules! named_ddl_op {
    ($fn_name:ident, $adapter_method:ident, $kind:literal, $target_fmt:literal) => {
        pub async fn $fn_name(conn_id: &str, name: &str) -> DbResult<()> {
            let t = std::time::Instant::now();
            let target = format!($target_fmt, name);
            let name = name.to_string();
            let res = with_connection(conn_id, move |a| async move {
                a.$adapter_method(&name).await
            })
            .await;
            match &res {
                Ok(()) => crate::activity::log_ok_origin(conn_id, $kind, &target, t, 0, "app"),
                Err(e) => crate::activity::log_err_origin(conn_id, $kind, &target, t, e, "app"),
            }
            res
        }
    };
}

mod mongo_json;
mod mongo_sql;
mod mongodb;
mod postgres;
mod read_only;
mod runs;
mod sqlite;
mod types;
mod adapter;
mod registry;
mod activity_log;
mod catalog;
mod documents;
mod query;
mod ddl;

pub use types::*;
pub use adapter::*;
pub use registry::*;
pub(crate) use activity_log::*;
pub use catalog::*;
pub use documents::*;
pub use query::*;
pub use ddl::*;

use crate::api::QueryChunk;
pub use mongo_json::{parse as parse_mongo_json, render as render_mongo_json};
pub use mongodb::{MongoAdapter, MongoParams};
pub use postgres::{PgAdapter, PgParams};
pub use read_only::{Dialect, ReadOnlyGuard, READ_ONLY_PREFIX};
pub use runs::{cancel as cancel_run, CancelOutcome, CancelState, RunHandle};
pub use self::sqlite::SqliteAdapter;
