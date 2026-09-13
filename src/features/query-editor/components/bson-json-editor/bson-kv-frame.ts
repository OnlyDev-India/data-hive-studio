import { RectangleMarker, layer, type LayerMarker } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { statementRect } from "../editor/statement-runner";

interface KVRange {
  start: number;
  end: number;
}

function skipString(doc: string, from: number): number {
  let j = from + 1;
  while (j < doc.length) {
    if (doc[j] === "\\") {
      j += 2;
      continue;
    }
    if (doc[j] === '"') return j + 1;
    j += 1;
  }
  return doc.length;
}

function skipBracketed(
  doc: string,
  from: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  let j = from;
  while (j < doc.length) {
    const ch = doc[j];
    if (ch === '"') {
      j = skipString(doc, j);
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return j + 1;
    }
    j += 1;
  }
  return doc.length;
}

function skipValue(doc: string, from: number): number {
  let valueStart = from;
  while (valueStart < doc.length && /\s/.test(doc[valueStart])) valueStart += 1;
  if (valueStart >= doc.length) return valueStart;
  const ch = doc[valueStart];
  if (ch === '"') return skipString(doc, valueStart);
  if (ch === "{" || ch === "[") {
    const close = ch === "{" ? "}" : "]";
    return skipBracketed(doc, valueStart, ch, close);
  }
  // number / bool / null / a BSON constructor call, e.g. ObjectId("...")
  let j = valueStart;
  while (j < doc.length && /[A-Za-z0-9_$.+-]/.test(doc[j])) j += 1;
  if (doc[j] === "(") return skipBracketed(doc, j, "(", ")");
  return j;
}

/** Every `"key": value` pair in the document, nested ones included — a plain
 *  bracket-depth scan rather than the syntax tree: a leading `{` at the top
 *  of a JS document parses as a block statement, not an object literal, so
 *  there are no Property nodes to lean on (see bsonDecorator's own comment
 *  in index.tsx for the same issue). */
function scanKeyValuePairs(doc: string): KVRange[] {
  const pairs: KVRange[] = [];
  let i = 0;
  while (i < doc.length) {
    if (doc[i] === '"') {
      const start = i;
      const keyEnd = skipString(doc, i);
      let after = keyEnd;
      while (after < doc.length && /\s/.test(doc[after])) after += 1;
      if (doc[after] === ":") {
        pairs.push({ start, end: skipValue(doc, after + 1) });
      }
      i = keyEnd;
      continue;
    }
    i += 1;
  }
  return pairs;
}

/** The whole `"key": value` pair the cursor sits inside — the innermost
 *  pair wins when nested, regardless of whether the cursor is over the key
 *  or the value. */
export function currentKvFrame(
  doc: string,
  cursor: number,
): { start: number; end: number } | null {
  const pairs = scanKeyValuePairs(doc);
  let best: KVRange | null = null;
  for (const p of pairs) {
    if (cursor >= p.start && cursor <= p.end) {
      if (!best || p.end - p.start < best.end - best.start) best = p;
    }
  }
  if (!best) return null;
  return { start: best.start, end: best.end };
}

export function bsonKvFrameLayer(): Extension {
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
      const frame = currentKvFrame(doc, view.state.selection.main.head);
      if (!frame) return [];
      const rect = statementRect(view, frame.start, frame.end);
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
