import { lazy, Suspense } from "react";
import { ThemeProvider } from "@/shared/theme/theme";
import { WebGate } from "./web/WebGate";
import { TitleBar, shouldShowTitleBar } from "./app/studio/title-bar";

/** The whole studio shell is code-split behind the theme provider. */
const Studio = lazy(() =>
  import("@/app/studio/studio").then((m) => ({ default: m.Studio })),
);

function App() {
  return (
    <ThemeProvider>
      <div className="flex h-full min-h-0 flex-col">
        {/* Custom VS-Code-style title bar on every desktop platform — see
         * title-bar.tsx. macOS gets a slim drag/title strip next to its
         * native traffic lights and keeps the real system menu bar
         * (src-tauri/src/app_menu.rs); Windows/Linux have no native
         * decorations at all and get the full bar (menu + drag + window
         * controls) in its place. */}
        {shouldShowTitleBar() && <TitleBar />}
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <WebGate>
              <Studio />
            </WebGate>
          </Suspense>
        </div>
      </div>
    </ThemeProvider>
  );
}

export default App;
