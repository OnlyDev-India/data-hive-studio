/**
 * True when running inside the Tauri webview (desktop app). The browser build
 * (e.g. Vercel) uses a WASM-backed SQLite fallback instead.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
