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
    // Web-mode dev (`bun run dev -- --mode web`): proxy API calls to a
    // locally running dh-server so enrollment/gateway paths are same-origin.
    proxy: process.env.DH_DEV_SERVER_URL
      ? { "/v1": { target: process.env.DH_DEV_SERVER_URL, changeOrigin: true } }
      : { "/v1": { target: "http://localhost:8080", changeOrigin: true } },
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
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return "react-vendor";
          }
        },
      },
    },
  },
}));
