import { describe, expect, it } from "vitest";
import {
  EMPTY_HISTORY,
  HISTORY_MAX,
  historyOf,
  record,
  redo,
  setHistory,
  undo,
  type History,
} from "../history";

type Card = { id: string; body: string };

const pipeline = (n: number): Card[] => [{ id: `s${n}`, body: String(n) }];

describe("undo history", () => {
  it("does nothing when there is nothing to undo or redo", () => {
    const current = pipeline(0);
    expect(undo(EMPTY_HISTORY, current)).toEqual([EMPTY_HISTORY, null]);
    expect(redo(EMPTY_HISTORY, current)).toEqual([EMPTY_HISTORY, null]);
  });

  it("walks back through several steps, newest first, and forward again", () => {
    let h = record(EMPTY_HISTORY, pipeline(0));
    h = record(h, pipeline(1));
    let current = pipeline(2);
    let back: Card[] | null;

    [h, back] = undo(h, current);
    expect(back).toEqual(pipeline(1));
    current = back!;
    [h, back] = undo(h, current);
    expect(back).toEqual(pipeline(0));
    current = back!;
    expect(undo(h, current)[1]).toBeNull();

    [h, back] = redo(h, current);
    expect(back).toEqual(pipeline(1));
    [, back] = redo(h, back!);
    expect(back).toEqual(pipeline(2));
  });

  it(`keeps only the newest ${HISTORY_MAX} steps`, () => {
    let h: History<Card[]> = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_MAX + 5; i++) h = record(h, pipeline(i));
    expect(h.past).toHaveLength(HISTORY_MAX);
    expect(h.past[0]).toEqual(pipeline(5));
    expect(h.past.at(-1)).toEqual(pipeline(HISTORY_MAX + 4));
  });

  it("keeps each tab's history apart", () => {
    const h = record(EMPTY_HISTORY, pipeline(0));
    setHistory("aggregation:c:1", h);
    expect(historyOf("aggregation:c:1")).toBe(h);
    expect(historyOf("aggregation:c:2")).toBe(EMPTY_HISTORY);
  });
});
