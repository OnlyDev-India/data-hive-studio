import { invoke } from "@tauri-apps/api/core";
import { WEB } from "@/shared/api/web";
import { useStudioStore } from "@/shared/store";
import { pickSqlFile } from "@/shared/lib/platform";
import {
  activeConn,
  openMongoDatabaseAndConsole,
} from "./command-palette-items";
import { runEditAction, type EditAction } from "./edit-actions";

/** Runs `fn` against this window. Imported lazily, like the title bar's own
 *  window buttons, so importing this module never needs the window API. */
function withWindow(
  fn: (
    w: Awaited<
      ReturnType<typeof import("@tauri-apps/api/window").getCurrentWindow>
    >,
  ) => Promise<void>,
) {
  void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
    fn(getCurrentWindow()),
  );
}

/** The native About panel's stand in for the custom title bar (macOS gets the
 *  real one from the app menu): name and version in a plain message dialog. */
async function showAbout() {
  const [{ getName, getVersion }, { message }] = await Promise.all([
    import("@tauri-apps/api/app"),
    import("@tauri-apps/plugin-dialog"),
  ]);
  const [name, version] = await Promise.all([getName(), getVersion()]);
  await message(`${name}\nVersion ${version}`, { title: `About ${name}` });
}

/** Dispatches a menu item id into the store — the native menu bar (via the
 *  `"menu-action"` event, see `src-tauri/src/app_menu.rs`) and the custom
 *  Windows/Linux title bar are just front-ends for actions that already exist
 *  via the command palette / tab-bar dropdown. The `app.*`, `edit.*` and
 *  `window.*` ids, `view.toggle_devtools`/`view.toggle_fullscreen` and
 *  `help.about` only come from the custom bar: the native menu runs those
 *  itself through its predefined items. */
export function handleMenuAction(id: string) {
  const s = useStudioStore.getState();
  switch (id) {
    case "file.new_window": {
      void invoke("open_new_window");
      break;
    }
    case "file.new_sql": {
      const conn = activeConn();
      if (conn) s.openSql(conn.id);
      break;
    }
    case "file.new_table": {
      const conn = activeConn();
      if (conn) s.openNewTable(conn.id);
      break;
    }
    case "file.new_mongo_console": {
      const conn = activeConn();
      if (conn) void openMongoDatabaseAndConsole(conn.id);
      break;
    }
    case "file.open_file": {
      const conn = activeConn();
      if (!conn) break;
      void (async () => {
        try {
          const file = await pickSqlFile();
          if (!file) return;
          if (file.name.toLowerCase().endsWith(".js")) {
            void openMongoDatabaseAndConsole(conn.id, file.text, file.path);
          } else {
            s.openSql(conn.id, file.text, file.path);
          }
        } catch (e) {
          useStudioStore.getState().pushNotification({
            kind: "error",
            title: "Could not open file",
            detail: String(e),
          });
        }
      })();
      break;
    }
    case "view.toggle_left_panel":
      s.toggleLeftPanelOpen();
      break;
    case "view.toggle_json":
      s.toggleBottomPanel();
      break;
    case "view.command_palette":
      s.setCommandPaletteOpen(!s.commandPaletteOpen);
      break;
    case "view.toggle_devtools":
      void invoke("toggle_devtools_window");
      break;
    case "view.toggle_fullscreen":
      withWindow(async (w) => w.setFullscreen(!(await w.isFullscreen())));
      break;
    case "app.quit":
      void invoke("quit_app");
      break;
    case "edit.undo":
    case "edit.redo":
    case "edit.cut":
    case "edit.copy":
    case "edit.paste":
    case "edit.select_all":
      runEditAction(id.slice("edit.".length) as EditAction);
      break;
    case "window.minimize":
      withWindow((w) => w.minimize());
      break;
    case "window.maximize":
      withWindow((w) => w.toggleMaximize());
      break;
    case "window.close":
      withWindow((w) => w.close());
      break;
    case "connection.disconnect": {
      const conn = activeConn();
      if (conn) s.setDisconnectPendingId(conn.id);
      break;
    }
    case "connection.home":
      s.setView("home");
      break;
    case "help.check_updates":
      // An explicit menu click, unlike the passive title-bar badge, always
      // deserves an answer — the dialog itself runs a fresh on-demand check
      // when it opens with no `updateInfo` yet (see UpdateDialog) and shows
      // "You're up to date" rather than nothing.
      s.setUpdateDialogOpen(true);
      break;
    case "help.about":
      void showAbout();
      break;
  }
}

/** Keeps the native File menu's connection-only items (New SQL Editor, New
 *  Table, New NoSQL Console, Open File…) enabled only while a connection's
 *  workspace is actually showing, not on the Home screen; New NoSQL Console
 *  additionally needs `isNoSql` (the active connection is MongoDB) — see
 *  `set_menu_context` in `src-tauri/src/app_menu.rs`. */
export async function syncMenuContext(
  hasConnection: boolean,
  isNoSql: boolean,
) {
  if (WEB) return;
  try {
    await invoke("set_menu_context", { hasConnection, isNoSql });
  } catch {
    /* backend not ready yet */
  }
}
