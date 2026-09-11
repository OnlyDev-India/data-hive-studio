import { invoke } from "@tauri-apps/api/core";
import { WEB } from "@/shared/api/web";
import { useStudioStore } from "@/shared/store";
import { pickSqlFile } from "@/shared/lib/platform";
import {
  activeConn,
  openMongoDatabaseAndConsole,
} from "./command-palette-items";

/** Dispatches a `"menu-action"` event id (see `src-tauri/src/app_menu.rs`)
 *  into the store — the native menu bar is just another front-end for
 *  actions that already exist via the command palette / tab-bar dropdown. */
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
            void openMongoDatabaseAndConsole(conn.id, file.text, file.name);
          } else {
            s.openSql(conn.id, file.text, file.name);
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
      s.toggleRightSidebar();
      break;
    case "view.command_palette":
      s.setCommandPaletteOpen(!s.commandPaletteOpen);
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
