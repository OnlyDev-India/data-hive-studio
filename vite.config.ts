import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    watch: {
      ignored: ["**/src-tauri/**"],
    },
    // Web-mode dev (`bun run dev -- --mode web`): proxy API and sign in calls
    // to a locally running dh-server so the page is same origin with it (the
    // web build talks only to the origin that served it, and its renewal
    // cookie is scoped to `/auth`). Set the server's DH_PUBLIC_URL to this
    // dev server's address so the sign in redirect may return here.
    proxy: Object.fromEntries(
      ["/v1", "/auth"].map((path) => [
        path,
        {
          target: process.env.DH_DEV_SERVER_URL ?? "http://localhost:8080",
          changeOrigin: true,
        },
      ]),
    ),
  },
  // Tauri expects a fixed port on dev.
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    // Web UI build (`bun run build:web`) lands in its own directory so it
    // never clobbers the desktop bundle in dist/.
    outDir: mode === "web" ? "dist-web" : "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Without this, Rolldown's automatic chunking has split React's
        // CJS-interop wrapper into an app chunk (observed: "store") that
        // another chunk (observed: "utils") also needs — but loads BEFORE,
        // since nothing pins load order between two app chunks. That chunk
        // then calls the not-yet-initialized export as a function
        // ("TypeError: n is not a function") on first paint, blanking the
        // whole app. Pinning React into its own vendor chunk (no app-code
        // back-reference) guarantees it's independent of any app chunk's
        // internal load order.
        //
        // Same failure, second instance: lucide-react's `createLucideIcon`
        // was auto-placed in the shared "preload-helper" chunk, which also
        // holds Vite's preload helper — and that helper imports back into
        // "api". That closed a cycle (preload-helper → api → query-editor →
        // preload-helper) whose entry-driven evaluation order ran
        // query-editor's top-level `createLucideIcon(...)` calls before
        // preload-helper had initialized ("TypeError: Fe is not a function"
        // in release builds only). Pinning lucide into its own leaf chunk
        // (no app-code import) removes it from any such cycle.
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return "react-vendor";
          }
          if (/node_modules\/lucide-react\//.test(id)) {
            return "lucide-vendor";
          }
        },
      },
    },
  },
}));
