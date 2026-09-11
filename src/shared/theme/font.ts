/**
 * Font family support.
 *
 * `--font-sans` (index.css's `@theme inline` block) resolves through a
 * plain `--font-sans-active` custom property on `:root`, the same
 * indirection `--color-primary: var(--primary)` uses for accent colors —
 * selecting a font overrides `--font-sans-active` at runtime via an inline
 * style on <html>, so every `font-sans` usage picks up the change without
 * touching components.
 *
 * Presets are limited to fonts every major OS already ships, so no font
 * loading (a `<link>`, `@font-face`, or bundled font files) is needed —
 * unlike `--primary`, a font stack can't be synthesized from a couple of
 * color channels, so adding a preset that isn't preinstalled would need
 * that loading step built out too.
 */

export type FontId = "inter" | "system" | "georgia" | "verdana";

export interface Font {
  id: FontId;
  name: string;
  /** Full CSS font-family stack for `--font-sans-active`. */
  stack: string;
}

const FONTS: Font[] = [
  {
    id: "inter",
    name: "Inter",
    stack: `"Inter", ui-sans-serif, system-ui, sans-serif`,
  },
  {
    id: "system",
    name: "System UI",
    stack: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
  },
  {
    id: "georgia",
    name: "Georgia",
    stack: `Georgia, "Times New Roman", serif`,
  },
  {
    id: "verdana",
    name: "Verdana",
    stack: `Verdana, Geneva, sans-serif`,
  },
];

export function getFont(id: FontId): Font {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

export function listFonts(): Font[] {
  return [...FONTS];
}

/** Applies a font by overriding `--font-sans-active` on <html>. Inter (the
 *  default) clears the override so index.css supplies its literal value. */
export function applyFont(id: FontId) {
  const root = document.documentElement;
  const font = getFont(id);

  if (font.id === "inter") {
    root.style.removeProperty("--font-sans-active");
    return;
  }

  root.style.setProperty("--font-sans-active", font.stack);
}

const FONT_KEY = "font";

export function readFont(): FontId {
  const stored = localStorage.getItem(FONT_KEY);
  return FONTS.some((f) => f.id === stored) ? (stored as FontId) : "inter";
}

export function persistFont(id: FontId) {
  localStorage.setItem(FONT_KEY, id);
}
