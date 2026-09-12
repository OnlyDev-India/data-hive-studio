import {
  EditorView,
  GutterMarker,
  RectangleMarker,
  gutter,
  layer,
  type LayerMarker,
} from "@codemirror/view";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Check, PlayIcon } from "lucide-react";
import { statementRanges } from "@/shared/lib/utils";

/** The non-blank statement the cursor currently sits inside, or null between
 *  statements / in trailing whitespace. Shared by the gutter (which
 *  statement is "active") and the frame layer (what to draw a box around). */
function currentStatement(doc: string, cursor: number) {
  const ranges = statementRanges(doc);
  for (const r of ranges) {
    if (
      r.end > r.start &&
      cursor >= r.start &&
      cursor <= r.end &&
      doc.slice(r.start, r.end).trim()
    ) {
      return r;
    }
  }
  // Cursor sitting one position past a statement's own trailing `;` (end of
  // document, or nothing but blank space before whatever's next) — still
  // reads as "in" that statement rather than showing no box at all. When a
  // REAL next statement starts right there instead, the loop above already
  // matched it, so this only fires when there isn't one.
  for (const r of ranges) {
    if (
      r.end > r.start &&
      doc[r.end] === ";" &&
      cursor === r.end + 1 &&
      doc.slice(r.start, r.end).trim()
    ) {
      return r;
    }
  }
  return undefined;
}

/** `statementRanges` gives every statement but the first a `start` sitting
 *  exactly on the newline right after the PREVIOUS statement's `;` —
 *  `Text.lineAt`/pixel measurement at that exact boundary position resolve
 *  to the previous line, not this statement's own first line (confirmed
 *  against `@codemirror/state`'s `Text.lineAt`). Trimming the range down to
 *  its actual (non-whitespace) content first is what the gutter button
 *  anchor and the frame box both need to land on the right line/statement
 *  instead of colliding with the one before it. */
function trimmedRange(text: string, start: number) {
  const lead = text.length - text.trimStart().length;
  const trail = text.length - text.trimEnd().length;
  return { start: start + lead, end: start + text.length - trail };
}

// Same components the rest of the app uses (editor-run-toolbar.tsx's
// PlayIcon, doc-markdown.tsx's Check) — rendered once to static markup so a
// vanilla-DOM GutterMarker (outside the React tree) still shows the real
// Lucide glyph instead of a hand-copied SVG path.
const PLAY_ICON = renderToStaticMarkup(
  createElement(PlayIcon, { size: 10, strokeWidth: 2.5 }),
);
const CHECK_ICON = renderToStaticMarkup(
  createElement(Check, { size: 7, strokeWidth: 3.5 }),
);

/** The range of the statement that most recently finished running
 *  successfully — drives the gutter's checkmark badge. Cleared on any doc
 *  change, since a stale position could land on the wrong (or no) statement
 *  once the text around it shifts. `null` = nothing to show (no run yet, ran
 *  with an error, or the doc has since changed). */
export const setLastRunSuccess = StateEffect.define<{
  from: number;
  to: number;
} | null>();
const lastRunSuccessField = StateField.define<{
  from: number;
  to: number;
} | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLastRunSuccess)) return e.value;
    return tr.docChanged ? null : value;
  },
});

/** Dispatched by the caller (see `QueryEditorHandle.markRunResult`) once a
 *  statement's run resolves — `range: null` clears any existing badge
 *  (e.g. the run failed). */
export function markRunResult(
  view: EditorView,
  range: { from: number; to: number } | null,
) {
  view.dispatch({ effects: setLastRunSuccess.of(range) });
}

class RunButtonMarker extends GutterMarker {
  readonly succeeded: boolean;
  readonly from: number;
  readonly runAtCursor: () => void;
  constructor(succeeded: boolean, from: number, runAtCursor: () => void) {
    super();
    this.succeeded = succeeded;
    this.from = from;
    this.runAtCursor = runAtCursor;
  }
  eq(other: RunButtonMarker) {
    return other.succeeded === this.succeeded && other.from === this.from;
  }
  toDOM(view: EditorView) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = this.succeeded
      ? "cm-statement-run cm-statement-run--success"
      : "cm-statement-run";
    btn.title = "Run this statement";
    btn.innerHTML = this.succeeded
      ? `${PLAY_ICON}<span class="cm-statement-run-badge">${CHECK_ICON}</span>`
      : PLAY_ICON;
    // Keep focus/selection in the editor instead of letting the button steal it.
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = (e) => {
      e.stopPropagation();
      view.dispatch({ selection: { anchor: this.from, head: this.from } });
      this.runAtCursor();
    };
    return btn;
  }
}

/** Per-statement run buttons in the gutter — one on the first line of every
 *  `;`-delimited statement, matching the target `getTargets()` would pick if
 *  the cursor were on that line. Clicking one moves the cursor there and
 *  runs it via the same path Ctrl+Shift+Enter uses. The checkmark badge
 *  marks whichever statement last finished running successfully (see
 *  `markRunResult`) — independent of where the cursor currently is. */
export function statementGutter(runAtCursor: () => void): Extension {
  return [
    lastRunSuccessField,
    gutter({
      class: "cm-statement-gutter",
      lineMarker(view, line) {
        const doc = view.state.doc.toString();
        const stmt = statementRanges(doc).find((r) => {
          if (r.end <= r.start) return false;
          const trimmed = trimmedRange(doc.slice(r.start, r.end), r.start);
          if (trimmed.end <= trimmed.start) return false;
          return view.state.doc.lineAt(trimmed.start).from === line.from;
        });
        if (!stmt) return null;
        const success = view.state.field(lastRunSuccessField);
        const succeeded =
          !!success && success.from === stmt.start && success.to === stmt.end;
        return new RunButtonMarker(succeeded, stmt.start, runAtCursor);
      },
      lineMarkerChange: (update) =>
        update.docChanged ||
        update.startState.field(lastRunSuccessField) !==
          update.state.field(lastRunSuccessField),
    }),
  ];
}

// ponytail: bounding box is the union of each line's own text extent —
// correct for normal single-viewport statements, but (unlike DBX's original)
// doesn't estimate off-viewport line positions or guard against
// thousand-line statements. Add that if queries ever get that large.
export function statementRect(
  view: EditorView,
  rawFrom: number,
  rawTo: number,
) {
  if (rawTo <= rawFrom) return null;
  const { start: from, end: to } = trimmedRange(
    view.state.sliceDoc(rawFrom, rawTo),
    rawFrom,
  );
  if (to <= from) return null;
  const startCoords = view.coordsAtPos(from, 1);
  const endCoords = view.coordsAtPos(to, -1);
  if (!startCoords || !endCoords) return null;
  const scrollBox = view.scrollDOM.getBoundingClientRect();
  const top = startCoords.top - scrollBox.top + view.scrollDOM.scrollTop;
  const bottom = endCoords.bottom - scrollBox.top + view.scrollDOM.scrollTop;
  if (bottom <= top) return null;

  let left = Infinity;
  let right = -Infinity;
  const doc = view.state.doc;
  for (let ln = doc.lineAt(from).number; ln <= doc.lineAt(to).number; ln++) {
    const line = doc.line(ln);
    const lineFrom = Math.max(line.from, from);
    const lineTo = Math.min(line.to, to);
    const lc = view.coordsAtPos(lineFrom, 1);
    if (lc) left = Math.min(left, lc.left);
    const rc = view.coordsAtPos(Math.max(lineFrom, lineTo), -1);
    if (rc) right = Math.max(right, rc.right);
  }
  if (!isFinite(left) || !isFinite(right)) return null;

  const INSET = 3;
  return {
    left: left - scrollBox.left + view.scrollDOM.scrollLeft - INSET,
    top: top - INSET,
    width: Math.max(right - left, 4) + INSET * 2,
    height: bottom - top + INSET * 2,
  };
}

/** Rounded border box around the statement the cursor is currently inside —
 *  the CodeMirror `layer()` equivalent of a decoration, redrawn on scroll/
 *  resize/selection/doc changes. */
export function statementFrameLayer(): Extension {
  return layer({
    above: true,
    class: "cm-statement-frame-layer",
    update: (update) =>
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged ||
      update.geometryChanged,
    markers(view): readonly LayerMarker[] {
      const doc = view.state.doc.toString();
      const stmt = currentStatement(doc, view.state.selection.main.head);
      if (!stmt) return [];
      // `statementRanges` ends a statement's range AT the `;` (excluding
      // it, so it can start the next range right after) — visually that
      // left the terminator sitting just outside the box. Include it here
      // when there is one (the last statement in the doc may have none).
      const to = doc[stmt.end] === ";" ? stmt.end + 1 : stmt.end;
      const rect = statementRect(view, stmt.start, to);
      return rect
        ? [
            new RectangleMarker(
              "cm-statement-frame",
              rect.left,
              rect.top,
              rect.width,
              rect.height,
            ),
          ]
        : [];
    },
  });
}
