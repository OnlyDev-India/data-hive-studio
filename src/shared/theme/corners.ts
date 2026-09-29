/**
 * Corner style (border radius) presets.
 *
 * Radius follows an element's role: `inset` (items inside menus and lists),
 * `control` (buttons, inputs), `surface` (popovers, cards), `dialog`, and
 * `pill`. Round is the :root default in index.css; Soft and Sharp are
 * `[data-corners]` blocks there. Keep in step with index.css and the pre
 * paint script in index.html.
 */

export type CornerStyleId = "sharp" | "soft" | "round";

export interface CornerStyle {
  id: CornerStyleId;
  name: string;
  /** The role values, for the Settings swatch. */
  inset: string;
  control: string;
  surface: string;
  dialog: string;
}

const CORNER_STYLES: CornerStyle[] = [
  {
    id: "sharp",
    name: "Sharp",
    inset: "0px",
    control: "2px",
    surface: "2px",
    dialog: "4px",
  },
  {
    id: "soft",
    name: "Soft",
    inset: "3px",
    control: "4px",
    surface: "6px",
    dialog: "8px",
  },
  {
    id: "round",
    name: "Round",
    inset: "4px",
    control: "6px",
    surface: "8px",
    dialog: "12px",
  },
];

export function getCornerStyle(id: CornerStyleId): CornerStyle {
  return CORNER_STYLES.find((c) => c.id === id) ?? CORNER_STYLES[2];
}

export function listCornerStyles(): CornerStyle[] {
  return [...CORNER_STYLES];
}

// Older builds set these inline on <html>, which would outrank the CSS blocks.
const LEGACY_INLINE_VARS = [
  "--radius-sm-active",
  "--radius-md-active",
  "--radius-lg-active",
  "--radius-xl-active",
] as const;

export function applyCornerStyle(id: CornerStyleId) {
  const root = document.documentElement;
  for (const v of LEGACY_INLINE_VARS) root.style.removeProperty(v);
  root.dataset.corners = getCornerStyle(id).id;
}

const CORNER_STYLE_KEY = "cornerStyle";

export function readCornerStyle(): CornerStyleId {
  const stored = localStorage.getItem(CORNER_STYLE_KEY);
  return CORNER_STYLES.some((c) => c.id === stored)
    ? (stored as CornerStyleId)
    : "round";
}

export function persistCornerStyle(id: CornerStyleId) {
  localStorage.setItem(CORNER_STYLE_KEY, id);
}
