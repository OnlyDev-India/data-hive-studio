import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "darkmode";

function readIsDark(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "true") return true;
  if (stored === "false") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

interface ThemeState {
  dark: boolean;
  toggle: () => void;
  setDark: (dark: boolean) => void;
}

const ThemeCtx = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Tracks whether we've read the stored preference. Until then we never touch
  // the DOM with the default (light) value.
  const [loaded, setLoaded] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    (() => {
      setDark(readIsDark());
      setLoaded(true);
    })();
  }, []);

  // Apply whatever `dark` resolves to; but don't persist the system-derived
  // value — only an explicit toggle pins a preference in localStorage.
  useEffect(() => {
    if (!loaded) return;
    document.documentElement.classList.toggle("dark", dark);
  }, [dark, loaded]);

  const toggle = useCallback(() => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const setDarkPinned = useCallback((next: boolean) => {
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(STORAGE_KEY, String(next));
    setDark(next);
  }, []);

  const value = useMemo<ThemeState>(
    () => ({ dark, toggle, setDark: setDarkPinned }),
    [dark, toggle, setDarkPinned],
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
