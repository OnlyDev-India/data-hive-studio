import { maskStringsAndComments } from "@/shared/lib/utils";

/** `__dh_sub_<n>` sits in a card's body where a whole parenthesized
 *  subquery goes; its chain holds the subquery's cards. */
export const markerName = (n: number) => `__dh_sub_${n}`;

const MARKER_RE = /__dh_sub_(\d+)\b/g;

export const isMarker = (name: string) => /^__dh_sub_\d+$/.test(name);

/** The markers in `text` in order, outside strings and comments. */
export function markersIn(text: string): { n: number; at: number }[] {
  const masked = maskStringsAndComments(text);
  return [...masked.matchAll(MARKER_RE)].map((m) => ({
    n: Number(m[1]),
    at: m.index,
  }));
}

/** `text` with each marker replaced by `fn(n)`. */
export function replaceMarkers(
  text: string,
  fn: (n: number) => string,
): string {
  let out = "";
  let last = 0;
  for (const { n, at } of markersIn(text)) {
    out += text.slice(last, at) + fn(n);
    last = at + markerName(n).length;
  }
  return out + text.slice(last);
}

/** Each marker as `(SELECT __dh_sub_<n>)`, so the parser reads it as the
 *  subquery it stands for, in any position. */
export const maskMarkers = (text: string) =>
  replaceMarkers(text, (n) => `(SELECT ${markerName(n)})`);

/** Undo `maskMarkers` in text a form wrote back. */
export const unmaskMarkers = (text: string) =>
  text.replace(/\(\s*select\s+(__dh_sub_\d+)\s*\)/gi, "$1");

/** The marker a masked subquery node's text stands for, if it is one. */
export function maskedMarker(text: string): number | null {
  const m = /^\(\s*select\s+__dh_sub_(\d+)\s*\)$/i.exec(text.trim());
  return m ? Number(m[1]) : null;
}
