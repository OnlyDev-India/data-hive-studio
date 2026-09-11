import { lazy, Suspense, useEffect, useState } from "react";
import { ThemeProvider } from "@/shared/theme/theme";
import { WEB } from "@/shared/api/web";
import { WebGate } from "./web/WebGate";
import { TitleBar, shouldShowTitleBar } from "./app/studio/title-bar";
import { SplashScreen } from "./app/splash-screen";
import { runStartupBootstrap } from "./app/bootstrap";
import { checkForUpdate } from "@/features/updater";

// Re-check on this cadence for sessions left open a long time — the
// startup check (`runStartupBootstrap`) only ever runs once, at launch.
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** The whole studio shell is code-split behind the theme provider. */
const Studio = lazy(() =>
  import("@/app/studio/studio").then((m) => ({ default: m.Studio })),
);

function App() {
  // Gates the first real paint on `runStartupBootstrap` (saved connections +
  // persisted workspace state, and finishing any OS-handed file open) so the
  // user never sees an empty-then-populated flash or a blank window while a
  // double-clicked database file is still opening — see splash-screen.tsx.
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<string>();
  useEffect(() => {
    void runStartupBootstrap(setStatus).finally(() => setReady(true));
  }, []);

  // Desktop release builds only (never web, never `tauri dev`): the raw
  // WebView context menu ("Reload", "Back", "Inspect Element"...) looks
  // like a bug in a packaged app and lets a stray right-click reload the
  // whole window, dropping every open connection/tab. Our own ContextMenu
  // components (tab strip, grid rows, …) already call preventDefault()
  // themselves — see @base-ui/react's ContextMenuTrigger — so they're
  // unaffected by this; editable text (CodeMirror, inputs, textareas) is
  // explicitly exempted so native cut/copy/paste still works there.
  useEffect(() => {
    if (WEB || import.meta.env.DEV) return;
    const on_context_menu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(
          "input, textarea, [contenteditable='true'], .cm-editor",
        )
      ) {
        return;
      }
      e.preventDefault();
    };
    document.addEventListener("contextmenu", on_context_menu);
    return () => document.removeEventListener("contextmenu", on_context_menu);
  }, []);

  // Periodic re-check for sessions that stay open across the interval —
  // `runStartupBootstrap`'s own check only ever fires once, at launch.
  useEffect(() => {
    if (WEB) return;
    const id = setInterval(() => void checkForUpdate(), UPDATE_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <ThemeProvider>
      <div className="flex h-full min-h-0 flex-col">
        {/* Custom VS-Code-style title bar on every desktop platform — see
         * title-bar.tsx. macOS gets a slim drag/title strip next to its
         * native traffic lights and keeps the real system menu bar
         * (src-tauri/src/app_menu.rs); Windows/Linux have no native
         * decorations at all and get the full bar (menu + drag + window
         * controls) in its place. Rendered unconditionally so the window
         * stays draggable/movable immediately, even during the splash. */}
        {shouldShowTitleBar() && <TitleBar />}
        <div className="min-h-0 flex-1">
          {ready ? (
            <Suspense fallback={null}>
              <WebGate>
                <Studio />
              </WebGate>
            </Suspense>
          ) : (
            <SplashScreen status={status} />
          )}
        </div>
      </div>
    </ThemeProvider>
  );
}

export default App;
