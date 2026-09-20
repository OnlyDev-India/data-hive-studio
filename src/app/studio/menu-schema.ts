/** Drives the custom title-bar menu on Windows/Linux (`title-bar.tsx`).
 *  Kept in sync BY HAND with the native macOS menu bar in
 *  `src-tauri/src/app_menu.rs` — the two can't share a literal data
 *  structure across the Rust/TS boundary, so any change to one's items
 *  should be mirrored in the other (`__tests__/menu-schema.test.ts` fails
 *  when a custom id in the Rust file is missing here). Ids match
 *  `native-menu.ts`'s `handleMenuAction` switch exactly.
 *
 *  Same menus and items as the macOS bar, except the ones that only exist
 *  there: the app menu's Services / Hide / Hide Others (About lives under
 *  Help and Quit under File here, where the native menu already puts them
 *  on Windows/Linux). Edit and Window items are ours to run, not the OS's
 *  (see `edit-actions.ts`, and `handleMenuAction`'s `window.*` cases). */
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
  /** Items act on the field that was focused before the menu opened (see
   *  `edit-actions.ts`), so closing the menu should return focus there. */
  actsOnFocusedField?: boolean;
}

export const TITLE_BAR_MENUS: MenuDef[] = [
  {
    label: "File",
    items: [
      // Opening another window doesn't need a connection — unlike every
      // other item here, not `requiresConnection`.
      { id: "file.new_window", label: "New Window", accel: "Ctrl+Shift+N" },
      { separator: true },
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
      { separator: true },
      { id: "app.quit", label: "Quit" },
    ],
  },
  {
    label: "Edit",
    actsOnFocusedField: true,
    items: [
      { id: "edit.undo", label: "Undo", accel: "Ctrl+Z" },
      { id: "edit.redo", label: "Redo", accel: "Ctrl+Y" },
      { separator: true },
      { id: "edit.cut", label: "Cut", accel: "Ctrl+X" },
      { id: "edit.copy", label: "Copy", accel: "Ctrl+C" },
      { id: "edit.paste", label: "Paste", accel: "Ctrl+V" },
      { id: "edit.select_all", label: "Select All", accel: "Ctrl+A" },
    ],
  },
  {
    label: "View",
    items: [
      { id: "view.toggle_left_panel", label: "Toggle Sidebar" },
      { id: "view.toggle_json", label: "Toggle Bottom Panel" },
      { separator: true },
      {
        id: "view.command_palette",
        label: "Command Palette",
        accel: "Ctrl+Shift+P",
      },
      // No accel on these two: unlike macOS, where the native menu owns
      // Cmd+Alt+I, nothing here binds a key for them.
      { id: "view.toggle_devtools", label: "Toggle Developer Tools" },
      { separator: true },
      { id: "view.toggle_fullscreen", label: "Toggle Full Screen" },
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
  {
    label: "Window",
    items: [
      { id: "window.minimize", label: "Minimize" },
      { id: "window.maximize", label: "Maximize" },
      { separator: true },
      { id: "window.close", label: "Close Window" },
    ],
  },
  {
    label: "Help",
    items: [
      { id: "help.check_updates", label: "Check for Updates…" },
      { separator: true },
      { id: "help.about", label: "About DH Studio" },
    ],
  },
];
