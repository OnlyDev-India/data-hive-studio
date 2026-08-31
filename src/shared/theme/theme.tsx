import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  applyAccent,
  getAccent,
  persistAccent,
  readAccent,
  type Accent as AccentColor,
  type AccentId,
} from "./accent";

const STORAGE_KEY = "darkmode";

export type ThemeMode = "system" | "light" | "dark";
export type { AccentColor, AccentId };

/** Resolve the tri-state mode to a concrete boolean. Falls back to the OS
 *  preference when unset or "system". */
function resolveDark(mode: ThemeMode | null): boolean {
  if (mode === "light") return false;
  if (mode === "dark") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "true") return "dark";
  if (stored === "false") return "light";
  return "system";
}

interface ThemeState {
  /** Current resolved appearance (system preference folded in). */
  dark: boolean;
  /** The stored preference: "system" | "light" | "dark". */
  mode: ThemeMode;
  /** Currently selected accent id. */
  accent: AccentId;
  /** The selected accent color (derived from `accent`). */
  accentColor: AccentColor;
  /** Toggle light/dark relative to the CURRENT resolved value; pins the
   *  opposite preference (i.e. an explicit light or dark mode). */
  toggle: () => void;
  /** Set the stored preference explicitly. */
  setMode: (mode: ThemeMode) => void;
  /** Set a concrete resolved value (pins light/dark). */
  setDark: (dark: boolean) => void;
  /** Set and persist an accent color. */
  setAccent: (id: AccentId) => void;
}

const ThemeCtx = createContext<ThemeState | null>(null);

function applyClass(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Tracks whether we've read the stored preference. Until then we never touch
  // the DOM with the default (light) value.
  const [loaded, setLoaded] = useState(false);
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [dark, setDarkState] = useState(false);
  const [accent, setAccentState] = useState<AccentId>("graphite");

  // Hydrate once from storage / system on mount.
  useEffect(() => {
    (() => {
      const m = readMode();
      setModeState(m);
      setDarkState(resolveDark(m));
      const a = readAccent();
      setAccentState(a);
      applyAccent(a);
      setLoaded(true);
    })();
  }, []);

  // Follow OS theme changes while in "system" mode.
  useEffect(() => {
    if (!loaded || mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setDarkState(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [loaded, mode]);

  // Apply whatever `dark` resolves to.
  useEffect(() => {
    if (!loaded) return;
    applyClass(dark);
  }, [dark, loaded]);

  const toggle = useCallback(() => {
    setDarkState((d) => {
      const next = !d;
      applyClass(next);
      // Toggling from a resolved state pins an explicit dark/light value.
      const nextMode: ThemeMode = next ? "dark" : "light";
      localStorage.setItem(STORAGE_KEY, String(next));
      setModeState(nextMode);
      return next;
    });
  }, []);

  const setMode = useCallback((nextMode: ThemeMode) => {
    localStorage.setItem(
      STORAGE_KEY,
      nextMode === "system" ? "" : String(nextMode === "dark"),
    );
    setModeState(nextMode);
    setDarkState(resolveDark(nextMode));
  }, []);

  const setDarkPinned = useCallback((next: boolean) => {
    applyClass(next);
    localStorage.setItem(STORAGE_KEY, String(next));
    setModeState(next ? "dark" : "light");
    setDarkState(next);
  }, []);

  const setAccent = useCallback((id: AccentId) => {
    applyAccent(id);
    persistAccent(id);
    setAccentState(id);
  }, []);

  const value = useMemo<ThemeState>(
    () => ({
      dark,
      mode,
      accent,
      accentColor: getAccent(accent),
      toggle,
      setMode,
      setDark: setDarkPinned,
      setAccent,
    }),
    [dark, mode, accent, toggle, setMode, setDarkPinned, setAccent],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
