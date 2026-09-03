/**
 * Accent color support.
 *
 * `--primary` (and friends) are driven by oklch CSS variables in index.css,
 * defaulting to a near-monochrome "graphite" accent. Selecting a colored accent
 * overrides those variables at runtime via inline styles on <html>, which lets
 * every `bg-primary` / `text-primary` / `border-primary` usage pick up the
 * color without touching components.
 */

export type AccentId =
  | "graphite"
  | "blue"
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
  /** oklch base color for `--primary`. */
  base: string;
  /** Contrasting text color placed on the primary background. */
  foreground: string;
}

const ACCENTS: Accent[] = [
  { id: "graphite", name: "Graphite", base: "", foreground: "" },
  { id: "blue", name: "Blue", base: "oklch(0.55 0.2 250)", foreground: "oklch(0.985 0 0)" },
  { id: "purple", name: "Purple", base: "oklch(0.55 0.22 290)", foreground: "oklch(0.985 0 0)" },
  { id: "pink", name: "Pink", base: "oklch(0.6 0.2 350)", foreground: "oklch(0.985 0 0)" },
  { id: "red", name: "Red", base: "oklch(0.57 0.22 25)", foreground: "oklch(0.985 0 0)" },
  { id: "orange", name: "Orange", base: "oklch(0.65 0.19 55)", foreground: "oklch(0.985 0 0)" },
  { id: "yellow", name: "Yellow", base: "oklch(0.82 0.16 95)", foreground: "oklch(0.16 0 0)" },
  { id: "green", name: "Green", base: "oklch(0.6 0.19 150)", foreground: "oklch(0.985 0 0)" },
  { id: "teal", name: "Teal", base: "oklch(0.62 0.16 190)", foreground: "oklch(0.985 0 0)" },
];

export function getAccent(id: AccentId): Accent {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}

export function listAccents(): Accent[] {
  return [...ACCENTS];
}

/** Applies an accent by overriding the CSS variables on <html>. Graphite
 *  (the default) clears the overrides so index.css supplies the monochrome
 *  values. */
export function applyAccent(id: AccentId) {
  const root = document.documentElement;
  const accent = getAccent(id);
  const vars = [
    "--primary",
    "--primary-foreground",
    "--primary-light",
    "--primary-dark",
    "--selection",
  ] as const;

  if (accent.id === "graphite") {
    for (const v of vars) root.style.removeProperty(v);
    return;
  }

  root.style.setProperty("--primary", accent.base);
  root.style.setProperty("--primary-foreground", accent.foreground);
  root.style.setProperty(
    "--primary-light",
    `color-mix(in oklab, white 85%, ${accent.base})`,
  );
  root.style.setProperty(
    "--primary-dark",
    `color-mix(in oklab, black 55%, ${accent.base})`,
  );
  root.style.setProperty("--selection", accent.base);
}

const ACCENT_KEY = "accent";

export function readAccent(): AccentId {
  const stored = localStorage.getItem(ACCENT_KEY);
  return ACCENTS.some((a) => a.id === stored) ? (stored as AccentId) : "graphite";
}

export function persistAccent(id: AccentId) {
  localStorage.setItem(ACCENT_KEY, id);
}
