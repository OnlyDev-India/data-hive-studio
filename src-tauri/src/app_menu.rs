//! Native menu bar — the real macOS menu bar, an in-window menu on Windows,
//! and a GTK-native one on Linux. Custom items (File/View/Connection) emit
//! a `"menu-action"` event carrying the item's id string; the frontend
//! listens for it and dispatches into the store (see
//! `app/studio/native-menu.ts`). Anything OS-conventional (Edit, Window, the
//! macOS app menu, About) reuses `tauri::menu`'s own predefined items
//! instead of reinventing them — same items `Menu::default()` would build.
//!
//! Deliberately no accelerator on anything that already has an in-app
//! keyboard shortcut (`Cmd+P`/`Cmd+Shift+P` for the command palette, etc.)
//! — a native accelerator AND a JS-level `useShortcuts` binding on the same
//! key would both fire on one keypress, double-triggering toggle actions.

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

/// File-menu items that only make sense with a connection open — grayed out
/// on the Home screen via `set_menu_context`, rather than always enabled
/// and silently no-op'ing when clicked with nothing open.
pub struct FileMenuItems<R: Runtime> {
    new_sql: MenuItem<R>,
    new_table: MenuItem<R>,
    new_mongo_console: MenuItem<R>,
    open_file: MenuItem<R>,
}

impl<R: Runtime> FileMenuItems<R> {
    fn set_enabled(&self, enabled: bool) -> tauri::Result<()> {
        self.new_sql.set_enabled(enabled)?;
        self.new_table.set_enabled(enabled)?;
        self.new_mongo_console.set_enabled(enabled)?;
        self.open_file.set_enabled(enabled)?;
        Ok(())
    }
}

/// Enable/disable the connection-only File-menu items — called by the
/// frontend whenever it switches between the Home screen and a connection's
/// workspace (see `native-menu.ts`).
#[tauri::command]
pub fn set_menu_context(
    state: tauri::State<FileMenuItems<tauri::Wry>>,
    has_connection: bool,
) -> Result<(), String> {
    state.set_enabled(has_connection).map_err(|e| e.to_string())
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<(Menu<R>, FileMenuItems<R>)> {
    let pkg_info = app.package_info();
    let about = AboutMetadata {
        name: Some(pkg_info.name.clone()),
        version: Some(pkg_info.version.to_string()),
        ..Default::default()
    };

    // Disabled by default — nothing's open until the frontend's first
    // `set_menu_context(true)` call once a connection is active.
    let new_sql = MenuItem::with_id(app, "file.new_sql", "New SQL Editor", false, Some("CmdOrCtrl+T"))?;
    let new_table = MenuItem::with_id(app, "file.new_table", "New Table", false, None::<&str>)?;
    let new_mongo_console = MenuItem::with_id(
        app,
        "file.new_mongo_console",
        "New NoSQL Console",
        false,
        None::<&str>,
    )?;
    let open_file = MenuItem::with_id(app, "file.open_file", "Open File…", false, Some("CmdOrCtrl+O"))?;

    let file_menu = Submenu::with_id_and_items(
        app,
        "file",
        "File",
        true,
        &[
            &new_sql,
            &new_table,
            &new_mongo_console,
            &PredefinedMenuItem::separator(app)?,
            &open_file,
            &PredefinedMenuItem::separator(app)?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_id_and_items(
        app,
        "edit",
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_id_and_items(
        app,
        "view",
        "View",
        true,
        &[
            // One item, not two — the sidebar and the activity panel share
            // a single left-panel slot with one open/closed flag (see
            // `leftPanelOpen`/`toggleLeftPanelOpen` in the store), so
            // "Toggle Sidebar" and "Toggle Activity Panel" would just be two
            // names for the exact same action.
            &MenuItem::with_id(app, "view.toggle_left_panel", "Toggle Sidebar", true, None::<&str>)?,
            &MenuItem::with_id(app, "view.toggle_json", "Toggle JSON Panel", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            // No accelerator — Cmd/Ctrl+P and Cmd/Ctrl+Shift+P already open
            // this in-app (see command-palette.tsx's own useShortcuts).
            &MenuItem::with_id(app, "view.command_palette", "Command Palette", true, None::<&str>)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let connection_menu = Submenu::with_id_and_items(
        app,
        "connection",
        "Connection",
        true,
        &[
            &MenuItem::with_id(
                app,
                "connection.disconnect",
                "Disconnect Current",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, "connection.home", "Go to Home", true, None::<&str>)?,
        ],
    )?;

    let window_menu = Submenu::with_id_and_items(
        app,
        "window",
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let help_menu = Submenu::with_id_and_items(
        app,
        "help",
        "Help",
        true,
        &[
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::about(app, None, Some(about.clone()))?,
        ],
    )?;

    let menu = Menu::with_items(
        app,
        &[
            #[cfg(target_os = "macos")]
            &Submenu::with_items(
                app,
                pkg_info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            &file_menu,
            &edit_menu,
            &view_menu,
            &connection_menu,
            &window_menu,
            &help_menu,
        ],
    )?;

    Ok((
        menu,
        FileMenuItems {
            new_sql,
            new_table,
            new_mongo_console,
            open_file,
        },
    ))
}
