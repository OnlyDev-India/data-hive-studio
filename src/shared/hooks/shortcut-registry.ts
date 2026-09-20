/** Registry of every user-customizable keyboard shortcut in the app — the
 *  single source of truth `useAppShortcut` (below, in `use-shortcut.ts`) and
 *  the Settings → Shortcuts section both read from. Adding a new
 *  customizable shortcut means adding one entry here and resolving its
 *  binding via `useAppShortcut(id)` at the call site, instead of hardcoding
 *  a `{ key, mod, shift }` literal (see `use-shortcut.ts`'s `Shortcut` type
 *  for the raw, non-customizable primitive most one-off shortcuts — dialog
 *  Escape/Enter, the web-mode reload guard — should keep using directly). */

export interface ShortcutBinding {
  /** `KeyboardEvent.key`, case-insensitive (e.g. "s", "Enter", "p"). */
  key: string;
  /** Cmd on macOS / Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutAction {
  id: string;
  label: string;
  default: ShortcutBinding;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    id: "palette.quickOpen",
    label: "Open command palette",
    default: { key: "p", mod: true },
  },
  {
    id: "palette.commands",
    label: "Open command palette (commands)",
    default: { key: "p", mod: true, shift: true },
  },
  {
    id: "grid.reload",
    label: "Reload table data",
    default: { key: "r", mod: true },
  },
  {
    id: "editor.run",
    label: "Run query",
    default: { key: "Enter", mod: true },
  },
  {
    id: "editor.runTarget",
    label: "Run targeted statement",
    default: { key: "Enter", mod: true, shift: true },
  },
  {
    id: "editor.save",
    label: "Save",
    default: { key: "s", mod: true },
  },
  {
    id: "editor.search",
    label: "Find in editor",
    default: { key: "f", mod: true },
  },
  {
    id: "editor.joinLines",
    label: "Join lines",
    default: { key: "j", mod: true },
  },
  {
    id: "editor.deleteBlankLines",
    label: "Delete blank lines",
    default: { key: "j", mod: true, shift: true },
  },
  {
    id: "editor.uppercaseSelection",
    label: "Uppercase selection",
    default: { key: "u", mod: true, shift: true },
  },
  {
    id: "editor.lowercaseSelection",
    label: "Lowercase selection",
    default: { key: "l", mod: true, shift: true },
  },
  {
    id: "editor.cycleNamingStyle",
    label: "Cycle naming style (snake/camel/Pascal)",
    // Not Mod+Shift+N — that's the native "New Window" menu accelerator
    // (see app_menu.rs), intercepted by the OS before JS ever sees it.
    default: { key: "c", mod: true, shift: true },
  },
  {
    id: "editor.zoomIn",
    label: "Editor zoom in",
    default: { key: "=", mod: true },
  },
  {
    id: "editor.zoomOut",
    label: "Editor zoom out",
    default: { key: "-", mod: true },
  },
  {
    id: "editor.zoomReset",
    label: "Editor zoom reset",
    default: { key: "0", mod: true },
  },
  {
    id: "editor.pasteAsInCondition",
    label: "Paste as SQL IN condition",
    default: { key: "v", mod: true, shift: true },
  },
  {
    id: "editor.delimitedList",
    label: "Build delimited list…",
    default: { key: "d", mod: true, shift: true },
  },
];

export function shortcutAction(id: string): ShortcutAction {
  const action = SHORTCUT_ACTIONS.find((a) => a.id === id);
  if (!action) throw new Error(`Unknown shortcut action: ${id}`);
  return action;
}

/** Same-key, same-modifiers comparison — used both to detect a remap
 *  collision against every other action's effective binding, and to know
 *  whether a binding still matches its own default (for a per-row reset
 *  button's disabled state). */
export function bindingEquals(a: ShortcutBinding, b: ShortcutBinding): boolean {
  return (
    a.key.toLowerCase() === b.key.toLowerCase() &&
    !!a.mod === !!b.mod &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt
  );
}

const IS_MAC =
  typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);

function keyGlyph(key: string, isMac: boolean): string {
  if (key === "Enter") return isMac ? "⏎" : "Enter";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** Converts a binding into a CodeMirror `keymap.of([{ key, run }])` binding
 *  string (`"Mod-j"`, `"Mod-U"`) — for shortcuts implemented as a CodeMirror
 *  `Command` (text-editing commands that only make sense while the editor
 *  itself has focus) rather than through `useShortcuts`' window-level
 *  listener.
 *
 *  Shift + a single letter is written as the UPPERCASE letter with no
 *  explicit "Shift-", never `"Mod-Shift-<letter>"` — CodeMirror's own
 *  runtime key resolution (`w3c-keyname`) deliberately does not add a
 *  "Shift-" prefix for character keys (the shift is already "baked into"
 *  the letter's case), so a binding string that spells it out literally
 *  can never match a real keydown; verified empirically (a `Mod-Shift-u`
 *  binding never fires for a real Cmd+Shift+U keypress, `Mod-U` does).
 *  `@codemirror/search`'s own bundled `searchKeymap` ships the broken
 *  `"Mod-Shift-l"` form for `selectSelectionMatches` — which is exactly why
 *  it's unreachable on Mac and safe for this app to reuse for
 *  `editor.lowercaseSelection`. Non-letter keys (`Enter`, digits, symbols)
 *  don't have this issue and keep the literal `Shift-` prefix. */
export function toCodeMirrorKey(b: ShortcutBinding): string {
  const shiftedLetter = b.shift && /^[a-z]$/i.test(b.key);
  const key = shiftedLetter ? b.key.toUpperCase() : b.key;
  return [
    b.mod && "Mod",
    !shiftedLetter && b.shift && "Shift",
    b.alt && "Alt",
    key,
  ]
    .filter(Boolean)
    .join("-");
}

/** Renders a binding as OS-appropriate glyphs/labels for the Settings UI and
 *  tooltips — display only, never used for actual key matching (that stays
 *  in `use-shortcut.ts`'s `matches()`). */
export function formatBinding(
  b: ShortcutBinding,
  isMac: boolean = IS_MAC,
): string[] {
  if (isMac) {
    return [
      b.mod ? "⌘" : "",
      b.alt ? "⌥" : "",
      b.shift ? "⇧" : "",
      keyGlyph(b.key, true),
    ].filter(Boolean);
  }
  return [
    b.mod ? "Ctrl" : "",
    b.alt ? "Alt" : "",
    b.shift ? "Shift" : "",
    keyGlyph(b.key, false),
  ].filter(Boolean);
}
