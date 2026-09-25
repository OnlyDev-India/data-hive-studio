import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockTauriCore } from "@/test/mock-tauri";

vi.mock("@tauri-apps/api/core", () => mockTauriCore());

import { createRowAccumulator, type RowSnapshot } from "../streaming";

let frames: FrameRequestCallback[] = [];
const runFrame = () => {
  const due = frames;
  frames = [];
  due.forEach((cb) => cb(0));
};

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.splice(id - 1, 1);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createRowAccumulator", () => {
  it("flushes once per frame however many chunks arrived, on one shared rows array", () => {
    const seen: RowSnapshot[] = [];
    const acc = createRowAccumulator((s) => seen.push(s));

    acc.push({ columns: ["a"], rows: [["1"]] });
    acc.push({ rows: [["2"], ["3"]] });
    runFrame();
    acc.push({ rows: [["4"]] });
    runFrame();

    expect(seen).toHaveLength(2);
    expect(seen[0].row_count).toBe(3);
    expect(seen[1].row_count).toBe(4);
    // Never a copy per frame: the table gets the same array and a count.
    expect(seen[1].rows).toBe(seen[0].rows);
  });

  it("does not flush before the columns are known", () => {
    const seen: RowSnapshot[] = [];
    const acc = createRowAccumulator((s) => seen.push(s));

    acc.push({ rows: [["1"]] });
    runFrame();

    expect(seen).toHaveLength(0);
    expect(acc.started()).toBe(true);
  });

  it("appends columns at the end and pads every row to the final list", () => {
    const acc = createRowAccumulator();

    acc.push({ columns: ["_id"], rows: [["1"], ["2"]] });
    acc.push({ columns: ["_id", "late"], rows: [["3", "x"]] });
    const done = acc.finish();

    expect(done.columns).toEqual(["_id", "late"]);
    expect(done.rows).toEqual([
      ["1", null],
      ["2", null],
      ["3", "x"],
    ]);
    expect(done.row_count).toBe(3);
  });

  it("reports an empty result's columns and cancels the pending frame on finish", () => {
    const seen: RowSnapshot[] = [];
    const acc = createRowAccumulator((s) => seen.push(s));

    acc.push({ columns: ["a", "b"], rows: [] });
    const done = acc.finish();
    runFrame();

    expect(done).toEqual({ columns: ["a", "b"], rows: [], row_count: 0 });
    expect(seen).toHaveLength(0);
  });

  it("keeps the documents behind the rows, in order, on one append only array", () => {
    const seen: RowSnapshot[] = [];
    const acc = createRowAccumulator((s) => seen.push(s));

    acc.push({ columns: ["a"], rows: [["1"]], documents: [{ a: 1 }] });
    acc.push({ rows: [["2"]], documents: [{ a: 2 }] });
    runFrame();
    const done = acc.finish();

    expect(seen[0].documents).toEqual([{ a: 1 }, { a: 2 }]);
    expect(done.documents).toBe(seen[0].documents);
    expect(done.documents).toHaveLength(done.row_count);
  });

  it("leaves documents out of a result that has none", () => {
    const acc = createRowAccumulator();
    acc.push({ columns: ["a"], rows: [["1"]] });
    expect(acc.finish()).not.toHaveProperty("documents");
  });
});
