//! Desktop shell. All core logic lives in the `dh-core` crate; these
//! re-exports keep `crate::api` / `crate::db` / `crate::activity` paths in
//! `commands.rs` valid.

use tauri::Listener;
// Only used by the macOS-only native-menu setup below (`app.manage(...)`) —
// Windows/Linux never call a `Manager` method, so an unconditional import
// warns as unused on those targets.
#[cfg(target_os = "macos")]
use tauri::Manager;
pub use dh_core::{activity, api, db};
pub mod activity_store;
pub mod app_menu;
pub mod commands;
pub mod file_open;
pub mod local_connections;
pub mod servers;
pub mod workspace_state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .on_menu_event(|app_handle, event| {
      use tauri::Emitter;
      let _ = app_handle.emit("menu-action", event.id().as_ref());
    })
    .setup(|app| {
      // macOS only: the real system menu bar. Windows/Linux get a custom,
      // VS-Code-style title bar drawn by the frontend instead (see
      // `src/app/studio/title-bar.tsx`) — those platforms run with
      // `decorations: false` (tauri.windows.conf.json / tauri.linux.conf.json)
      // and no native menu at all, since the custom one lives entirely in
      // the webview and dispatches straight into the store without needing
      // this round trip.
      #[cfg(target_os = "macos")]
      {
        let (menu, file_menu_items) = app_menu::build(app.handle())?;
        app.set_menu(menu)?;
        app.manage(file_menu_items);
      }

      // Windows/Linux: "Open with DH Studio" on a .db/.sqlite/.sqlite3 file
      // passes the path as a CLI argument on cold start. (macOS instead
      // delivers it via RunEvent::Opened, handled in run() below.)
      file_open::check_argv();

      // Hydrate the in-memory activity log from the previous run's
      // persisted snapshot before anything can log a fresh entry.
      let handle = app.handle().clone();
      activity::restore(activity_store::load(&handle));

      // Lets every logged entry carry a STABLE connection identity (see
      // `db::connection_stable_key`) instead of just the ephemeral runtime
      // conn_id — a fresh UUID every connect, so it can never match a past
      // session's entries for the same database. `db` owns the connection
      // registry this needs; `activity` stays free of a `db` dependency
      // otherwise (this indirection is the same reasoning as `set_emitter`).
      activity::set_conn_key_resolver(std::sync::Arc::new(db::connection_stable_key));

      // Forward activity entries to the frontend as Tauri events, and
      // persist the updated snapshot to disk so query history survives a
      // restart.
      activity::set_emitter(std::sync::Arc::new(move |entry| {
        {
          use tauri::Emitter;
          let _ = handle.emit("activity://entry", entry);
        }
        activity_store::persist(&handle);
      }));

      // Gracefully close all database pools on app shutdown.
      let app_handle = app.handle().clone();
      app.listen("tauri://close-requested", move |_| {
        let h = app_handle.clone();
        tauri::async_runtime::spawn(async move {
          db::close_all().await;
          h.exit(0);
        });
      });
      // Visible proof of which backend build is running — bump Cargo.toml
      // version when touching backend behavior so staleness is detectable.
      println!(
        "dh-studio backend v{} (activity: full-SQL capture ON)",
        env!("CARGO_PKG_VERSION")
      );
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            // sqlx warns when a pooled acquire waits >2s — expected for
            // remote databases (Neon TLS handshake per cold connection),
            // so silence just that target.
            .filter(|meta| {
                !(meta.target().starts_with("sqlx::pool::acquire")
                    && meta.level() == log::Level::Warn)
            })
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::get_activity,
      commands::clear_activity,
      commands::open_database,
      commands::connect_postgres,
      commands::connect_mongodb,
      commands::open_database_path,
      commands::set_database_path,
      commands::create_database,
      commands::close_connection,
      commands::list_tables,
      commands::list_schemas,
      commands::list_databases,
      commands::list_documents,
      commands::list_documents_ext,
      commands::save_document,
      commands::insert_document,
      commands::run_mongo,
      commands::catalog_overview,
      commands::create_pg_database,
      commands::drop_pg_database,
      commands::create_pg_schema,
      commands::drop_pg_schema,
      commands::create_mongo_collection,
      commands::refresh_matview,
      commands::set_active_schema,
      commands::active_schema,
      commands::table_schema,
      commands::run_sql,
      commands::run_sql_params,
      commands::execute_params,
      commands::execute_op,
      commands::execute_op_stream,
      commands::run_sql_stream,
      commands::save_database,
      commands::duplicate_table,
      commands::apply_schema_ops,
      commands::read_file,
      commands::write_file,
      local_connections::list_local_connections,
      local_connections::save_local_connection,
      local_connections::update_local_connection,
      local_connections::delete_local_connection,
      local_connections::get_local_connection_secret,
      local_connections::migrate_local_connections,
      file_open::take_pending_open_path,
      #[cfg(target_os = "macos")]
      app_menu::set_menu_context,
      workspace_state::load_workspace_state,
      workspace_state::save_workspace_state,
      workspace_state::clear_workspace_state,
      servers::servers_list,
      servers::servers_add,
      servers::servers_remove,
      servers::servers_connect,
      servers::servers_disconnect,
      servers::server_list_tables,
      servers::server_list_schemas,
      servers::server_table_schema,
      servers::server_run_sql,
      servers::server_execute_op,
      servers::server_list_databases,
      servers::server_catalog_overview,
      servers::server_active_schema,
      servers::server_set_active_schema,
      servers::server_apply_schema_ops_batch,
      servers::server_duplicate_table,
      servers::server_list_documents,
      servers::server_list_documents_ext,
      servers::server_save_document,
      servers::server_insert_document,
      servers::server_run_mongo,
      servers::server_create_collection,
      servers::servers_admin_devices,
      servers::servers_admin_revoke_device,
      servers::servers_admin_tokens_list,
      servers::servers_admin_mint_token,
      servers::servers_admin_delete_token,
      servers::servers_admin_grants,
      servers::servers_admin_set_grant,
      servers::servers_admin_revoke_grant,
      servers::servers_admin_connections,
      servers::servers_update_connection,
      servers::servers_create_connection,
      servers::servers_delete_connection,
      servers::servers_fetch_credentials,
      servers::servers_admin_audit,
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app_handle, _event| {
      // macOS (any start) and a warm second-open on any platform: the OS
      // hands us the file via this event instead of argv. Buffer it the
      // same way as the argv case (file_open::check_argv) and also emit a
      // live event for the (already-running) frontend to pick up right
      // away. `RunEvent::Opened` only exists on macOS/iOS/Android —
      // Windows/Linux deliver the file path via argv instead (see
      // `file_open::check_argv` above), leaving both closure params unused
      // there.
      #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
      if let tauri::RunEvent::Opened { urls } = _event {
        if let Some(path) = urls.first().and_then(|u| u.to_file_path().ok()) {
          let path = path.to_string_lossy().to_string();
          file_open::set_pending(path.clone());
          use tauri::Emitter;
          let _ = _app_handle.emit("file-associations://open", path);
        }
      }
    });
}