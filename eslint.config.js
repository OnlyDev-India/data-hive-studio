import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "**/target/**", "graphify-out"]),
  {
    rules: {
      "react-refresh/only-export-components": "off",
    },
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Cross-feature imports must go through the target feature's barrel
    // (`@/features/x`), never a deep path into its internals — keeps each
    // feature's components/store/lib genuinely private to itself.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/features/*/index.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*/**"],
              message:
                "Import from the feature's barrel instead (`@/features/<name>`), not a deep path into its internals.",
            },
          ],
        },
      ],
    },
  },
  {
    // shared/ is the dependency floor — it must never import from features/,
    // or the layering inverts (a "shared" module depending on app-specific
    // code stops being safely shared).
    files: ["src/shared/**/*.{ts,tsx}"],
    ignores: ["src/shared/store/store.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/**"],
              message:
                "shared/ must not depend on features/ — move the shared piece into shared/ instead, or invert the dependency.",
            },
          ],
        },
      ],
    },
  },
  {
    // The one intentional exception: store.ts is the composition root that
    // assembles each feature's own store slice (features/*/store/*-slice.ts)
    // into the single StudioStore — that's the point of the slice pattern,
    // not an accidental layering violation. Nothing else in shared/ gets
    // this exception.
    files: ["src/shared/store/store.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
]);
