import { useEffect, useRef } from "react";

export interface Shortcut {
  /** `KeyboardEvent.key`, case-insensitive (e.g. "s", "Enter", "p", "F5"). */
  key: string;
  /** Cmd on macOS / Ctrl elsewhere — the conventional app-shortcut modifier.
   *  Every modifier not set here must also be UNheld for a match, so plain
   *  "Escape" never fires while Cmd/Shift/Alt are also down. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: () => void;
  /** Default true — prevents the browser's own handling (e.g. Cmd+S save-page). */
  preventDefault?: boolean;
  /** Rarely needed — stop the event from reaching other listeners. */
  stopPropagation?: boolean;
}

export interface UseShortcutsOptions {
  /** False tears down nothing but skips matching — for "only while this
   *  dialog/panel is open" shortcuts, so the caller doesn't need its own
   *  early-return inside a raw effect. Default true. */
  enabled?: boolean;
  /** Attach during the capture phase instead of bubble — needed to intercept
   *  a browser-level shortcut (e.g. Cmd+R reload) before the browser acts on
   *  it. Default false. */
  capture?: boolean;
}

function matches(e: KeyboardEvent, s: Shortcut): boolean {
  return (
    e.key.toLowerCase() === s.key.toLowerCase() &&
    !!s.mod === (e.metaKey || e.ctrlKey) &&
    !!s.shift === e.shiftKey &&
    !!s.alt === e.altKey
  );
}

/**
 * Declarative keyboard shortcuts, attached once to `window` for the
 * component's lifetime — the single hook every app-wide/global shortcut
 * should register through, rather than each feature hand-rolling its own
 * `window.addEventListener("keydown", ...)`.
 *
 * The shortcuts array (and `enabled`) are read through a ref on each
 * keystroke instead of re-subscribing the listener every render — callers
 * don't need to `useMemo`/`useCallback` anything to keep this cheap.
 *
 * Not a fit for per-element navigation state machines (arrow-key movement,
 * multi-key sequences) — see `data-grid/use-grid-keyboard.ts` for that shape
 * instead. This hook is for "key combo -> run one callback" commands.
 */
export function useShortcuts(
  shortcuts: Shortcut[],
  { enabled = true, capture = false }: UseShortcutsOptions = {},
): void {
  const state = useRef({ shortcuts, enabled });
  useEffect(() => {
    state.current = { shortcuts, enabled };
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!state.current.enabled) return;
      for (const s of state.current.shortcuts) {
        if (!matches(e, s)) continue;
        if (s.preventDefault !== false) e.preventDefault();
        if (s.stopPropagation) e.stopPropagation();
        s.handler();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown, capture);
    return () => window.removeEventListener("keydown", onKeyDown, capture);
  }, [capture]);
}
