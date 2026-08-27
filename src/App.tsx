import { lazy, Suspense } from "react";
import { ThemeProvider } from "@/shared/theme/theme";
import { WebGate } from "./web/WebGate";

/** The whole studio shell is code-split behind the theme provider. */
const Studio = lazy(() =>
  import("@/app/studio/studio").then((m) => ({ default: m.Studio })),
);

function App() {
  return (
    <ThemeProvider>
      <Suspense fallback={null}>
        <WebGate>
          <Studio />
        </WebGate>
      </Suspense>
    </ThemeProvider>
  );
}

export default App;
