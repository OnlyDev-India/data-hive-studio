//! In-app updates, split into "download now" and "install later".
//!
//! The plugin's frontend `Update` handle dies with the window, and on
//! Windows/Linux the quit hook runs after the last window is gone, so the
//! downloaded package has to live here in Rust to be installable on quit.
//! Both commands take no URL, path or version from the frontend: the package
//! comes from a fresh check of the endpoint in `tauri.conf.json`, and the
//! plugin verifies its signature against the configured `pubkey` before it
//! is ever held in [`UpdaterState`].

use std::sync::Mutex;

use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::db;

enum Pending {
    Idle,
    Downloading,
    Ready { update: Update, bytes: Vec<u8> },
    Installing,
}

/// The one downloaded-but-not-installed package, if any. `app.manage`d once
/// in `run()`.
pub struct UpdaterState(Mutex<Pending>);

impl Default for UpdaterState {
    fn default() -> Self {
        Self(Mutex::new(Pending::Idle))
    }
}

/// Same wire shape as the plugin's own JS `DownloadEvent`, so the frontend
/// reads it the way it always has.
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum UpdateDownloadEvent {
    Started {
        #[serde(rename = "contentLength")]
        content_length: Option<u64>,
    },
    Progress {
        #[serde(rename = "chunkLength")]
        chunk_length: usize,
    },
    Finished,
}

/// What the package now held is: the version and release notes that were
/// found at download time (which can be newer than what the last background
/// check saw).
#[derive(Clone, Serialize)]
pub struct UpdateSummary {
    version: String,
    notes: Option<String>,
}

impl UpdateSummary {
    fn of(update: &Update) -> Self {
        Self {
            version: update.version.clone(),
            notes: update.body.clone(),
        }
    }
}

/// Builds an updater whose Windows installer-exit path closes databases
/// first. On Windows the plugin's `install` launches the installer and ends
/// the process itself, so nothing after it runs; this hook is the only
/// chance to close connections. It always runs on a blocking thread (see
/// the callers), so `block_on` never stalls an async worker.
fn build_updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    app.updater_builder()
        .on_before_exit(|| tauri::async_runtime::block_on(db::close_all()))
        .build()
        .map_err(|e| e.to_string())
}

fn lock(state: &UpdaterState) -> std::sync::MutexGuard<'_, Pending> {
    state.0.lock().unwrap_or_else(|e| e.into_inner())
}

/// Checks the endpoint again, downloads the package into managed state with
/// progress over `on_event`, and returns what it is. Never installs.
#[tauri::command]
pub async fn updater_download(
    app: AppHandle,
    state: State<'_, UpdaterState>,
    on_event: Channel<UpdateDownloadEvent>,
) -> Result<UpdateSummary, String> {
    {
        let mut pending = lock(&state);
        match &*pending {
            Pending::Idle => *pending = Pending::Downloading,
            Pending::Ready { update, .. } => return Ok(UpdateSummary::of(update)),
            Pending::Downloading => return Err("A download is already running".into()),
            Pending::Installing => return Err("An install is already running".into()),
        }
    }

    let result = download(&app, on_event).await;

    let mut pending = lock(&state);
    match result {
        Ok((update, bytes)) => {
            let summary = UpdateSummary::of(&update);
            *pending = Pending::Ready { update, bytes };
            Ok(summary)
        }
        Err(e) => {
            *pending = Pending::Idle;
            Err(e)
        }
    }
}

async fn download(
    app: &AppHandle,
    on_event: Channel<UpdateDownloadEvent>,
) -> Result<(Update, Vec<u8>), String> {
    let update = build_updater(app)?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update found".to_string())?;

    let mut started = false;
    let progress = on_event.clone();
    let finished = on_event.clone();
    let bytes = update
        .download(
            move |chunk_length, content_length| {
                if !started {
                    started = true;
                    let _ = progress.send(UpdateDownloadEvent::Started { content_length });
                }
                let _ = progress.send(UpdateDownloadEvent::Progress { chunk_length });
            },
            move || {
                let _ = finished.send(UpdateDownloadEvent::Finished);
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok((update, bytes))
}

/// Installs the downloaded package, then closes databases and relaunches.
/// On a failed install the package goes back to `Ready` and connections are
/// left open, so the user can retry.
#[tauri::command]
pub async fn updater_install_and_restart(
    app: AppHandle,
    state: State<'_, UpdaterState>,
) -> Result<(), String> {
    let (update, bytes) = {
        let mut pending = lock(&state);
        match std::mem::replace(&mut *pending, Pending::Installing) {
            Pending::Ready { update, bytes } => (update, bytes),
            other => {
                *pending = other;
                return Err("No update has been downloaded".into());
            }
        }
    };

    // Windows: `install` ends the process itself after running the
    // installer (see `build_updater`), so nothing below runs there.
    let (update, bytes, installed) = tauri::async_runtime::spawn_blocking(move || {
        let installed = update.install(&bytes);
        (update, bytes, installed)
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Err(e) = installed {
        *lock(&state) = Pending::Ready { update, bytes };
        return Err(e.to_string());
    }

    db::close_all().await;
    app.restart()
}

/// Quit hook: installs a waiting package during exit so the next launch runs
/// the new version. Runs after `db::close_all()`. Never blocks the exit: a
/// failure is logged and the caller exits anyway.
pub async fn install_pending_on_quit(app: &AppHandle) {
    let ready = {
        let state = app.state::<UpdaterState>();
        let mut pending = lock(&state);
        match std::mem::replace(&mut *pending, Pending::Installing) {
            Pending::Ready { update, bytes } => Some((update, bytes)),
            other => {
                *pending = other;
                None
            }
        }
    };
    let Some((update, bytes)) = ready else { return };

    match tauri::async_runtime::spawn_blocking(move || update.install(&bytes)).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => log::error!("update install on quit failed: {e}"),
        Err(e) => log::error!("update install on quit did not finish: {e}"),
    }
}
