/**
 * Corner-style (border-radius) presets.
 *
 * `--radius-sm/md/lg/xl` (index.css's `@theme inline` block) each resolve
 * through a plain `--radius-*-active` custom property on `:root` — same
 * indirection `--font-sans` uses for `--font-sans-active` — so selecting a
 * style overrides those four at runtime via inline styles on <html>, and
 * every `rounded-sm`/`rounded-md`/`rounded-lg`/`rounded-xl` usage app-wide
 * picks up the change without touching components.
 *
 * The four steps aren't a linear scale (sm and md share a value, as do lg
 * and xl), so each preset lists its own four literals rather than deriving
 * them from a single base number.
 */

export type CornerStyleId = "sharp" | "soft" | "round";

export interface CornerStyle {
  id: CornerStyleId;
  name: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
}

const CORNER_STYLES: CornerStyle[] = [
  { id: "sharp", name: "Sharp", sm: "0px", md: "0px", lg: "0px", xl: "0px" },
  { id: "soft", name: "Soft", sm: "4px", md: "4px", lg: "6px", xl: "6px" },
  { id: "round", name: "Round", sm: "6px", md: "6px", lg: "10px", xl: "14px" },
];

export function getCornerStyle(id: CornerStyleId): CornerStyle {
  return CORNER_STYLES.find((c) => c.id === id) ?? CORNER_STYLES[2];
}

export function listCornerStyles(): CornerStyle[] {
  return [...CORNER_STYLES];
}

/** Applies a corner style by overriding the four `--radius-*-active` vars
 *  on <html>. Round (the default) clears the overrides so index.css
 *  supplies its literal values. */
export function applyCornerStyle(id: CornerStyleId) {
  const root = document.documentElement;
  const style = getCornerStyle(id);

  if (style.id === "round") {
    root.style.removeProperty("--radius-sm-active");
    root.style.removeProperty("--radius-md-active");
    root.style.removeProperty("--radius-lg-active");
    root.style.removeProperty("--radius-xl-active");
    return;
  }

  root.style.setProperty("--radius-sm-active", style.sm);
  root.style.setProperty("--radius-md-active", style.md);
  root.style.setProperty("--radius-lg-active", style.lg);
  root.style.setProperty("--radius-xl-active", style.xl);
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
