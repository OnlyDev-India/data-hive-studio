import { EditorView, hoverTooltip } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/** One documented symbol (a SQL keyword/function, or a Mongo shell
 *  method/keyword) — `summary` is the one-liner shown in the hover card,
 *  everything else is only rendered in the "View details" popup. */
export interface DocEntry {
  name: string;
  signature: string;
  summary: string;
  description: string;
  examples: string[];
}

/** The `[\w$]` run containing (or immediately before) `pos`, matching how
 *  `getTargets`/completions already treat word characters elsewhere in this
 *  editor. Returns null between words (e.g. on whitespace/punctuation) —
 *  there's nothing to document there. */
export function wordAt(
  text: string,
  pos: number,
): { text: string; from: number; to: number } | null {
  const isWord = (c: string | undefined) => !!c && /[\w$]/.test(c);
  let from = pos;
  let to = pos;
  while (from > 0 && isWord(text[from - 1])) from--;
  while (to < text.length && isWord(text[to])) to++;
  if (from === to) return null;
  return { text: text.slice(from, to), from, to };
}

/** A resolver decides, given the full (already comment-masked) document
 *  text and a hover position, whether there's a documented symbol there —
 *  language-specific (SQL keyword lookup vs. Mongo method/keyword lookup
 *  with call-position awareness), see `sql-docs.ts`/`nosql-docs.ts`. */
export type DocResolver = (
  text: string,
  pos: number,
) => { entry: DocEntry; from: number; to: number } | null;

/** Hover tooltip: a short card (signature + one-line summary) with a "View
 *  details" button that hands the full `DocEntry` to `onOpenDetails` — the
 *  caller owns turning that into an actual popup (a Dialog in React-land;
 *  this file only builds vanilla DOM, same as `inline-diagnostics.ts`,
 *  since CodeMirror tooltip content lives outside the React tree). */
export function docHoverTooltip(
  resolve: DocResolver,
  onOpenDetails: (entry: DocEntry) => void,
): Extension {
  return hoverTooltip((view, pos) => {
    const hit = resolve(view.state.doc.toString(), pos);
    if (!hit) return null;
    return {
      pos: hit.from,
      end: hit.to,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-doc-hover";

        const sig = document.createElement("div");
        sig.className = "cm-doc-hover-sig";
        sig.textContent = hit.entry.signature;
        dom.appendChild(sig);

        const summary = document.createElement("div");
        summary.className = "cm-doc-hover-summary";
        summary.textContent = hit.entry.summary;
        dom.appendChild(summary);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cm-doc-hover-btn";
        btn.textContent = "View details ›";
        // Hover tooltips close on most editor interactions but not on a
        // click inside their own DOM — this fires before that click could
        // otherwise fall through to the editor and move the cursor.
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          onOpenDetails(hit.entry);
        });
        dom.appendChild(btn);

        return { dom };
      },
    };
  });
}

/** `.cm-tooltip`'s own background/border/radius (see `codemirror-theme.ts`)
 *  already apply to hover tooltips — this only styles this card's inner
 *  content. */
export const docHoverTheme = EditorView.baseTheme({
  ".cm-doc-hover": {
    padding: "8px 10px",
    maxWidth: "360px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  ".cm-doc-hover-sig": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "12.5px",
    fontWeight: "600",
    color: "var(--info-dark)",
  },
  ".cm-doc-hover-summary": {
    fontSize: "12.5px",
    color: "var(--popover-foreground)",
    lineHeight: "1.4",
  },
  ".cm-doc-hover-btn": {
    alignSelf: "flex-start",
    marginTop: "2px",
    fontSize: "11.5px",
    color: "var(--info-dark)",
    cursor: "pointer",
    background: "none",
    border: "none",
    padding: "0",
  },
  ".cm-doc-hover-btn:hover": {
    textDecoration: "underline",
  },
});
