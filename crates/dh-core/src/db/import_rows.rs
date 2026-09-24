use std::sync::Arc;
use std::time::Instant;
use crate::api::{ImportData, ImportProgress, ImportReport, ImportRequest};
use super::import::{ImportCtl, IMPORT_CTL};
use super::registry::with_connection;
use super::runs;
use super::types::DbResult;

/// Import rows into a table in one transaction (spec 0008). One summary entry
/// goes to the activity log, never one per row. A Check run (`dry_run`) is
/// logged too, since it still ran against the database.
///
/// A `run_id` makes the import stoppable through `cancel_run` (checked between
/// batches, so a cancelled import rolls back and reports `cancelled`).
/// `progress` hears `done of total` rows before each batch.
pub async fn import_rows(
    conn_id: &str,
    database: Option<&str>,
    schema: Option<&str>,
    request: &ImportRequest,
    progress: Option<Box<dyn Fn(ImportProgress) + Send + Sync>>,
) -> DbResult<ImportReport> {
    let t = Instant::now();
    let label = summary_text(request);
    let database = database.map(str::to_string);
    let schema = schema.map(str::to_string);
    let req = request.clone();
    let ctl = Arc::new(ImportCtl {
        run: request.run_id.as_deref().map(|id| runs::register(conn_id, id)),
        progress,
    });
    let res = IMPORT_CTL
        .scope(ctl.clone(), with_connection(conn_id, move |a| async move {
            a.import_rows(database.as_deref(), schema.as_deref(), &req).await
        }))
        .await;
    if let Some(run) = &ctl.run {
        run.finish().await;
    }
    match &res {
        Ok(r) => crate::activity::log_ok_origin(
            conn_id,
            "import",
            &format!(
                "{label}{}",
                if r.cancelled {
                    " (cancelled)"
                } else if r.committed {
                    ""
                } else {
                    " (rolled back)"
                }
            ),
            t,
            r.inserted as i64,
            "app",
        ),
        Err(e) => crate::activity::log_err_origin(conn_id, "import", &label, t, e, "app"),
    }
    res
}

/// `IMPORT n rows INTO table (file name)`.
fn summary_text(req: &ImportRequest) -> String {
    let n = match &req.data {
        ImportData::Rows { rows, .. } => rows.len(),
        ImportData::Docs { docs } => docs.len(),
    };
    let file = req.source_label.as_deref().map(|f| format!(" ({f})")).unwrap_or_default();
    format!("IMPORT {n} rows INTO {}{file}", req.table)
}

/// What an import into this connection can promise (spec 0008): whether a
/// rollback undoes everything. Not logged, it writes nothing.
pub async fn import_capabilities(
    conn_id: &str,
    database: Option<&str>,
) -> DbResult<crate::api::ImportCapabilities> {
    let database = database.map(str::to_string);
    with_connection(conn_id, move |a| async move {
        a.import_capabilities(database.as_deref()).await
    })
    .await
}
