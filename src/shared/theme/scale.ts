/**
 * Font size / interface scale support.
 *
 * Tailwind v4's default scale (text sizes, spacing, icon sizes via
 * `size-*`) is rem-based, so overriding the root element's `font-size`
 * scales the entire UI proportionally — the same technique desktop apps use
 * for a "zoom" setting, applied here at the <html> level via an inline
 * style (percentage of the browser default 16px), same override mechanism
 * `applyAccent`/`applyFont` use for their own CSS properties.
 *
 * Stored and applied as a plain percentage of the 16px browser default —
 * the Settings UI offers a handful of preset stops (see appearance.tsx's
 * `SCALES`), but the stored/applied value is always just that percent.
 */

export const DEFAULT_SCALE_PERCENT = 100;
export const MIN_SCALE_PERCENT = 50;
export const MAX_SCALE_PERCENT = 200;

export function clampScale(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_SCALE_PERCENT;
  return Math.min(MAX_SCALE_PERCENT, Math.max(MIN_SCALE_PERCENT, percent));
}

/** Applies a scale by overriding <html>'s `font-size`. 100% (the default)
 *  clears the override so the browser's own default (16px) applies. */
export function applyScale(percent: number) {
  const root = document.documentElement;
  const clamped = clampScale(percent);

  if (clamped === DEFAULT_SCALE_PERCENT) {
    root.style.removeProperty("font-size");
    return;
  }

  root.style.setProperty("font-size", `${clamped}%`);
}

const SCALE_KEY = "uiScale";

export function readScale(): number {
  const stored = localStorage.getItem(SCALE_KEY);
  const parsed = stored === null ? NaN : Number(stored);
  return Number.isFinite(parsed) ? clampScale(parsed) : DEFAULT_SCALE_PERCENT;
}

export function persistScale(percent: number) {
  localStorage.setItem(SCALE_KEY, String(clampScale(percent)));
}
