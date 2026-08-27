//! Desktop shell. All core logic lives in the `dh-core` crate; these
//! re-exports keep `crate::api` / `crate::db` / `crate::activity` paths in
//! `commands.rs` valid.

use tauri::Listener;
pub use dh_core::{activity, api, db};
pub mod commands;
pub mod servers;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .setup(|app| {
      // Forward activity entries to the frontend as Tauri events.
      let handle = app.handle().clone();
      activity::set_emitter(std::sync::Arc::new(move |entry| {
        {
          use tauri::Emitter;
          let _ = handle.emit("activity://entry", entry);
        }
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
      commands::open_database_path,
      commands::set_database_path,
      commands::create_database,
      commands::close_connection,
      commands::list_tables,
      commands::list_schemas,
      commands::list_databases,
      commands::catalog_overview,
      commands::create_pg_database,
      commands::drop_pg_database,
      commands::create_pg_schema,
      commands::drop_pg_schema,
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
      servers::servers_admin_devices,
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
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}