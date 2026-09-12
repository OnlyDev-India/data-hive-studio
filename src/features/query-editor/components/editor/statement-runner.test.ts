import { describe, it, expect } from "vitest";
import { Text } from "@codemirror/state";
import { statementRanges } from "@/shared/lib/utils";

/** Regression check for the bug where every statement after the first lost
 *  its gutter run button: `statementRanges` gives statement N>1 a `start`
 *  sitting exactly on the newline right after statement N-1's `;`, and
 *  `Text.lineAt` attributes that boundary position to the PREVIOUS line —
 *  so anchoring a button by `doc.lineAt(stmt.start)` put every non-first
 *  statement's button on the wrong (already-taken) line. The fix trims each
 *  range down to its real content before anchoring. */
function trimmedRange(text: string, start: number) {
  const lead = text.length - text.trimStart().length;
  const trail = text.length - text.trimEnd().length;
  return { start: start + lead, end: start + text.length - trail };
}

describe("statement line anchoring", () => {
  it("raw statementRanges boundary lands on the previous line (the bug)", () => {
    const doc = Text.of("SELECT 1;\nSELECT 2;\nSELECT 3;".split("\n"));
    // statementRanges always appends a trailing range after the final `;`
    // too (empty here) — the 3 real statements plus that one blank tail.
    const ranges = statementRanges(doc.toString());
    expect(ranges).toHaveLength(4);
    const stmt2 = ranges[1];
    // This is the bug: the raw start resolves to line 1, not line 2.
    expect(doc.lineAt(stmt2.start).number).toBe(1);
  });

  it("trimmedRange fixes every statement's anchor onto its own line", () => {
    const raw = "SELECT 1;\nSELECT 2;\nSELECT 3;";
    const doc = Text.of(raw.split("\n"));
    const ranges = statementRanges(raw).filter((r) =>
      raw.slice(r.start, r.end).trim(),
    );
    expect(ranges).toHaveLength(3);
    const lines = ranges.map((r) => {
      const trimmed = trimmedRange(raw.slice(r.start, r.end), r.start);
      return doc.lineAt(trimmed.start).number;
    });
    expect(lines).toEqual([1, 2, 3]);
  });
});
