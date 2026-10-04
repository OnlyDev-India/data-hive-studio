/**
 * Accent color support.
 *
 * Each accent's `--primary` family lives in index.css as a
 * `[data-accent="<id>"]` block plus a `.dark[data-accent="<id>"]` block, so
 * switching light and dark updates the accent with no script. DH Blue
 * (`blue`) is the :root / .dark default and has no block. Keep the ids in
 * step with index.css and the pre paint script in index.html.
 */

export type AccentId =
  | "blue"
  | "graphite"
  | "purple"
  | "pink"
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "teal";

export interface Accent {
  id: AccentId;
  name: string;
  /** The `--primary` values, for the Settings swatch. */
  swatch: { light: string; dark: string };
}

const ACCENTS: Accent[] = [
  {
    id: "blue",
    name: "DH Blue",
    swatch: { light: "oklch(0.53 0.19 262)", dark: "oklch(0.72 0.15 258)" },
  },
  {
    id: "graphite",
    name: "Graphite",
    swatch: { light: "oklch(0.3 0.006 265)", dark: "oklch(0.86 0.005 265)" },
  },
  {
    id: "purple",
    name: "Purple",
    swatch: { light: "oklch(0.52 0.2 295)", dark: "oklch(0.74 0.13 295)" },
  },
  {
    id: "pink",
    name: "Pink",
    swatch: { light: "oklch(0.55 0.2 350)", dark: "oklch(0.76 0.14 350)" },
  },
  {
    id: "red",
    name: "Red",
    swatch: { light: "oklch(0.54 0.2 25)", dark: "oklch(0.72 0.16 25)" },
  },
  {
    id: "orange",
    name: "Orange",
    swatch: { light: "oklch(0.56 0.16 50)", dark: "oklch(0.76 0.14 55)" },
  },
  {
    id: "yellow",
    name: "Gold",
    swatch: { light: "oklch(0.52 0.11 90)", dark: "oklch(0.85 0.15 95)" },
  },
  {
    id: "green",
    name: "Green",
    swatch: { light: "oklch(0.52 0.14 150)", dark: "oklch(0.76 0.15 150)" },
  },
  {
    id: "teal",
    name: "Teal",
    swatch: { light: "oklch(0.52 0.1 190)", dark: "oklch(0.76 0.11 190)" },
  },
];

export function getAccent(id: AccentId): Accent {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}

export function listAccents(): Accent[] {
  return [...ACCENTS];
}

// Older builds set these inline on <html>, which would outrank the CSS blocks.
const LEGACY_INLINE_VARS = [
  "--primary",
  "--primary-foreground",
  "--primary-light",
  "--primary-dark",
  "--selection",
] as const;

export function applyAccent(id: AccentId) {
  const root = document.documentElement;
  for (const v of LEGACY_INLINE_VARS) root.style.removeProperty(v);
  root.dataset.accent = getAccent(id).id;
}

const ACCENT_KEY = "accent";

export function readAccent(): AccentId {
  const stored = localStorage.getItem(ACCENT_KEY);
  return ACCENTS.some((a) => a.id === stored) ? (stored as AccentId) : "blue";
}

export function persistAccent(id: AccentId) {
  localStorage.setItem(ACCENT_KEY, id);
}
