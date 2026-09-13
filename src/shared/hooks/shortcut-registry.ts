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

/** Renders a binding as OS-appropriate glyphs/labels for the Settings UI and
 *  tooltips — display only, never used for actual key matching (that stays
 *  in `use-shortcut.ts`'s `matches()`). */
export function formatBinding(
  b: ShortcutBinding,
  isMac: boolean = IS_MAC,
): string {
  if (isMac) {
    return [
      b.mod ? "⌘" : "",
      b.alt ? "⌥" : "",
      b.shift ? "⇧" : "",
      keyGlyph(b.key, true),
    ].join("");
  }
  return [
    b.mod ? "Ctrl" : "",
    b.alt ? "Alt" : "",
    b.shift ? "Shift" : "",
    keyGlyph(b.key, false),
  ]
    .filter(Boolean)
    .join("+");
}
