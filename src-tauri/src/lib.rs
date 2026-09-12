//! Desktop shell. All core logic lives in the `dh-core` crate; these
//! re-exports keep `crate::api` / `crate::db` / `crate::activity` paths in
//! `commands.rs` valid.

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
mod secret_file;
pub mod servers;
pub mod workspace_state;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_os::init())
    // `Builder::default()`'s `StateFlags` include DECORATIONS, which
    // restores a saved `decorated` value on top of the window AFTER it's
    // created — silently overriding `decorations: false` from
    // tauri.windows.conf.json / tauri.linux.conf.json with whatever was
    // last saved (e.g. `true`, from before the custom title bar existed).
    // Decorations here are static per platform, never toggled at runtime,
    // so this plugin has no business tracking or restoring that field.
    .plugin(
      tauri_plugin_window_state::Builder::default()
        .with_state_flags(
          tauri_plugin_window_state::StateFlags::all()
            & !tauri_plugin_window_state::StateFlags::DECORATIONS,
        )
        .build(),
    )
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
      commands::list_schemas_in,
      commands::list_schema_objects,
      commands::list_roles,
      commands::list_role_details,
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
      commands::disconnect_database,
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
      commands::show_snap_overlay,
      commands::open_new_window,
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
      servers::servers_oauth_providers,
      servers::servers_oauth_login,
      servers::servers_reuse_session,
      servers::servers_org_create_new,
      servers::servers_org_redeem_invite_new,
      servers::servers_save_profile,
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
      servers::server_list_schemas_in,
      servers::server_list_schema_objects,
      servers::server_list_roles,
      servers::server_list_role_details,
      servers::server_active_schema,
      servers::server_set_active_schema,
      servers::server_disconnect_database,
      servers::server_apply_schema_ops_batch,
      servers::server_duplicate_table,
      servers::server_list_documents,
      servers::server_list_documents_ext,
      servers::server_save_document,
      servers::server_insert_document,
      servers::server_run_mongo,
      servers::server_create_collection,
      servers::servers_create_connection,
      servers::servers_update_connection,
      servers::servers_delete_connection,
      servers::servers_fetch_credentials,
      servers::servers_org_members,
      servers::servers_org_set_member_role,
      servers::servers_org_remove_member,
      servers::servers_org_invites_list,
      servers::servers_org_invite_create,
      servers::servers_org_invite_revoke,
      servers::servers_org_audit,
      servers::servers_grants_list,
      servers::servers_grant_set,
      servers::servers_grant_revoke,
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      // macOS (any start) and a warm second-open on any platform: the OS
      // hands us the file via this event instead of argv. Buffer it the
      // same way as the argv case (file_open::check_argv) and also emit a
      // live event for the (already-running) frontend to pick up right
      // away. `RunEvent::Opened` only exists on macOS/iOS/Android —
      // Windows/Linux deliver the file path via argv instead (see
      // `file_open::check_argv` above).
      #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
      if let tauri::RunEvent::Opened { urls } = &event {
        if let Some(path) = urls.first().and_then(|u| u.to_file_path().ok()) {
          let path = path.to_string_lossy().to_string();
          file_open::set_pending(path.clone());
          use tauri::Emitter;
          let _ = app_handle.emit("file-associations://open", path);
        }
      }

      // Gracefully close every open database connection (PG pools, SQLite
      // WAL merge…) before the app actually quits, instead of leaving them
      // to a bare process kill. Multi-window aware: `ExitRequested` only
      // fires once, when the app as a whole is really about to exit (e.g.
      // the last window closed, or Cmd+Q) — not per-window, so closing one
      // of several open windows doesn't tear down connections the others
      // still need. `close_all` is async, so the exit is deferred
      // (`prevent_exit`) until it finishes, then `exit(0)` — which itself
      // re-fires `ExitRequested`; `EXITING` stops that second pass from
      // spawning another cleanup and deferring forever.
      if let tauri::RunEvent::ExitRequested { api, .. } = &event {
        use std::sync::atomic::{AtomicBool, Ordering};
        static EXITING: AtomicBool = AtomicBool::new(false);
        if !EXITING.swap(true, Ordering::SeqCst) {
          api.prevent_exit();
          let handle = app_handle.clone();
          tauri::async_runtime::spawn(async move {
            db::close_all().await;
            handle.exit(0);
          });
        }
      }
    });
}