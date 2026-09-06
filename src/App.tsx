import { lazy, Suspense, useEffect, useState } from "react";
import { ThemeProvider } from "@/shared/theme/theme";
import { WebGate } from "./web/WebGate";
import { TitleBar, shouldShowTitleBar } from "./app/studio/title-bar";
import { SplashScreen } from "./app/splash-screen";
import { runStartupBootstrap } from "./app/bootstrap";

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
