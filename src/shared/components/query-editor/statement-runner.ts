import {
  EditorView,
  GutterMarker,
  RectangleMarker,
  gutter,
  layer,
  type LayerMarker,
} from "@codemirror/view";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  codeFolding,
  foldEffect,
  foldState,
  foldable,
  foldedRanges,
  unfoldEffect,
} from "@codemirror/language";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Check, ChevronRight, PlayIcon } from "lucide-react";
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
const FOLD_ICON = renderToStaticMarkup(
  createElement(ChevronRight, { size: 12, strokeWidth: 2.5 }),
);

/** The currently-folded range overlapping `[from, to)`, or null. Not
 *  exported by `@codemirror/language` itself (only `foldedRanges`, the
 *  whole-document decoration set, is) — this is the same lookup
 *  `foldGutter()`'s own internals do, just without its private helper. */
function findFoldedRange(
  view: EditorView,
  from: number,
  to: number,
): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  foldedRanges(view.state).between(from, to, (rFrom, rTo) => {
    found = { from: rFrom, to: rTo };
    return false;
  });
  return found;
}

class FoldMarker extends GutterMarker {
  readonly open: boolean;
  // The LINE's own span (`foldable()`'s `lineStart`/`lineEnd` params — not
  // the fold range itself, which starts/ends mid-line, e.g. right after an
  // opening brace) — needed to recompute the same fold range on click that
  // `lineMarker` used to decide this marker's `open` state in the first
  // place.
  readonly lineFrom: number;
  readonly lineTo: number;
  constructor(open: boolean, lineFrom: number, lineTo: number) {
    super();
    this.open = open;
    this.lineFrom = lineFrom;
    this.lineTo = lineTo;
  }
  eq(other: FoldMarker) {
    return (
      other.open === this.open &&
      other.lineFrom === this.lineFrom &&
      other.lineTo === this.lineTo
    );
  }
  toDOM(view: EditorView) {
    const span = document.createElement("span");
    span.className = this.open
      ? "cm-fold-marker cm-fold-marker--open"
      : "cm-fold-marker";
    span.innerHTML = FOLD_ICON;
    span.title = this.open ? "Fold line" : "Unfold line";
    // `mousedown`, not `click` — see the identical note on the statement
    // run button above. `foldGutter()`'s own built-in toggle is hardcoded
    // to `click` internally with no way to override it, which is why this
    // is a from-scratch gutter (reusing its lower-level fold/unfold
    // primitives) instead of that helper with a custom `markerDOM`.
    span.onmousedown = (e) => {
      e.stopPropagation();
      if (this.open) {
        const range = foldable(view.state, this.lineFrom, this.lineTo);
        if (range) view.dispatch({ effects: foldEffect.of(range) });
      } else {
        const folded = findFoldedRange(view, this.lineFrom, this.lineTo);
        if (folded) view.dispatch({ effects: unfoldEffect.of(folded) });
      }
    };
    return span;
  }
}

/** Same fold gutter as `basicSetup`'s own (`@codemirror/language`'s
 *  `foldGutter()`), just with the app's actual chevron icon instead of the
 *  library's plain "▾"/"▸" text markers — same one icon rotated 90° when
 *  open, matching the sidebar's tree-toggle chevrons (`TreeToggleRow`)
 *  rather than two different icon shapes for open/closed. */
export function lucideFoldGutter(): Extension {
  return [
    codeFolding(),
    gutter({
      class: "cm-foldGutter",
      lineMarker(view, line) {
        const folded = findFoldedRange(view, line.from, line.to);
        if (folded) return new FoldMarker(false, line.from, line.to);
        const range = foldable(view.state, line.from, line.to);
        return range ? new FoldMarker(true, line.from, line.to) : null;
      },
      lineMarkerChange: (update) =>
        update.docChanged ||
        update.viewportChanged ||
        update.startState.field(foldState, false) !==
          update.state.field(foldState, false),
    }),
  ];
}

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
    // Triggered on `mousedown`, not `click` — `click` is unreliable here on
    // Tauri's macOS webview (WebKit): a `preventDefault()` anywhere in the
    // event's bubble path (ours or CodeMirror's own handler) can suppress
    // the "activation" `click` depends on. `mousedown` sidesteps that.
    btn.onmousedown = (e) => {
      e.stopPropagation();
      view.dispatch({ selection: { anchor: this.from, head: this.from } });
      this.runAtCursor();
      view.focus();
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
  // Sampled at a stride, not just each logical line's two endpoints — a long
  // value can soft-wrap onto several VISUAL rows within one logical line,
  // each with its own left/right extent (e.g. a wrapped row that starts
  // further left, or reaches further right, than either endpoint). A short
  // row can be as narrow as a handful of characters, so the stride needs to
  // be small enough to always land at least one sample on it — a coarser
  // stride reliably SKIPS PAST short rows' actual start/end entirely,
  // undershooting the box on exactly the wrapped-text cases this exists
  // for. Every-character is still cheap: this only ever walks one
  // statement's/pair's own span, not the whole document.
  const SAMPLE_STRIDE = 1;
  for (let ln = doc.lineAt(from).number; ln <= doc.lineAt(to).number; ln++) {
    const line = doc.line(ln);
    const lineFrom = Math.max(line.from, from);
    const lineTo = Math.min(line.to, to);
    for (let pos = lineFrom; pos < lineTo; pos += SAMPLE_STRIDE) {
      const c = view.coordsAtPos(pos, 1);
      if (c) {
        left = Math.min(left, c.left);
        right = Math.max(right, c.right);
      }
    }
    const rc = view.coordsAtPos(lineTo, -1);
    if (rc) {
      left = Math.min(left, rc.left);
      right = Math.max(right, rc.right);
    }
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
