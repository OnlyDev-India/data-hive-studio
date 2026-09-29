/**
 * Font family support.
 *
 * IBM Plex Sans ships with the app (src/shared/theme/fonts.css) and is the
 * :root default in index.css. System UI is the `[data-font="system"]` block.
 * Any other stored value (older builds offered Inter, Georgia and Verdana)
 * reads as Plex. Keep in step with the pre paint script in index.html.
 */

export type FontId = "plex" | "system";

export interface Font {
  id: FontId;
  name: string;
  /** CSS font-family stack, for the Settings swatch. */
  stack: string;
}

const FONTS: Font[] = [
  {
    id: "plex",
    name: "IBM Plex Sans",
    stack: `"IBM Plex Sans Variable", ui-sans-serif, system-ui, sans-serif`,
  },
  {
    id: "system",
    name: "System UI",
    stack: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
  },
];

export function getFont(id: FontId): Font {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

export function listFonts(): Font[] {
  return [...FONTS];
}

export function applyFont(id: FontId) {
  const root = document.documentElement;
  // Older builds set this inline, which would outrank the CSS block.
  root.style.removeProperty("--font-sans-active");
  root.dataset.font = getFont(id).id;
}

const FONT_KEY = "font";

export function readFont(): FontId {
  return localStorage.getItem(FONT_KEY) === "system" ? "system" : "plex";
}

export function persistFont(id: FontId) {
  localStorage.setItem(FONT_KEY, id);
}
