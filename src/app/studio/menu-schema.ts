/** Drives the custom title-bar menu on Windows/Linux (`title-bar.tsx`).
 *  Kept in sync BY HAND with the native macOS menu bar's custom items in
 *  `src-tauri/src/app_menu.rs` — the two can't share a literal data
 *  structure across the Rust/TS boundary, so any change to one's items
 *  should be mirrored in the other. Ids match `native-menu.ts`'s
 *  `handleMenuAction` switch exactly.
 *
 *  Deliberately excludes Edit (native Ctrl+C/V/X/A already work in any
 *  input without a menu) and Window (minimize/maximize/close are the
 *  title-bar buttons themselves here, not a dropdown) — those only exist
 *  as of the native menu, which this custom bar replaces. */
export interface MenuAction {
  id: string;
  label: string;
  /** Display-only hint text — no actual key binding is registered for it
   *  here; either it's not bound at all, or (like the command palette) it's
   *  already handled by the app's own `useShortcuts` call. */
  accel?: string;
  /** Grayed out outside a connection's workspace (Home screen). */
  requiresConnection?: boolean;
}

export type MenuEntry = MenuAction | { separator: true };

export interface MenuDef {
  label: string;
  items: MenuEntry[];
}

export const TITLE_BAR_MENUS: MenuDef[] = [
  {
    label: "File",
    items: [
      {
        id: "file.new_sql",
        label: "New SQL Editor",
        accel: "Ctrl+T",
        requiresConnection: true,
      },
      { id: "file.new_table", label: "New Table", requiresConnection: true },
      {
        id: "file.new_mongo_console",
        label: "New NoSQL Console",
        requiresConnection: true,
      },
      { separator: true },
      {
        id: "file.open_file",
        label: "Open File…",
        accel: "Ctrl+O",
        requiresConnection: true,
      },
    ],
  },
  {
    label: "View",
    items: [
      { id: "view.toggle_left_panel", label: "Toggle Sidebar" },
      { id: "view.toggle_json", label: "Toggle JSON Panel" },
      { separator: true },
      { id: "view.command_palette", label: "Command Palette", accel: "Ctrl+Shift+P" },
    ],
  },
  {
    label: "Connection",
    items: [
      {
        id: "connection.disconnect",
        label: "Disconnect Current",
        requiresConnection: true,
      },
      { id: "connection.home", label: "Go to Home" },
    ],
  },
];
