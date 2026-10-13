import { describe, expect, it } from "vitest";
import type { AggregationStage } from "@/shared/store";
import {
  ADD_NODE_WIDTH,
  CARD_WIDTH,
  CHAIN_GAP,
  chainLayout,
  dragSlot,
  ESTIMATED_HEIGHT,
  linkAt,
  MAIN_ADD,
} from "@/shared/components/builder-canvas";
import {
  addId,
  BRANCH_GAP,
  COLUMN_GAP,
  HEAD_HEIGHT,
  headId,
  joinId,
  pipelineLayout,
} from "../layout";
import { newStage } from "../model";

const card = (id: string, op = "$match"): AggregationStage => ({
  ...newStage(op, true),
  id,
});

const step = ESTIMATED_HEIGHT + CHAIN_GAP;
const addX = (CARD_WIDTH - ADD_NODE_WIDTH) / 2;

describe("chainLayout", () => {
  it("stacks cards by their measured heights, estimating the rest", () => {
    const { cards, add } = chainLayout(["a", "b", "c"], { a: 100 });
    expect(cards).toEqual({
      a: { x: 0, y: 0 },
      b: { x: 0, y: 100 + CHAIN_GAP },
      c: { x: 0, y: 100 + CHAIN_GAP + step },
    });
    expect(add).toEqual({ x: addX, y: 100 + CHAIN_GAP + 2 * step });
  });

  it("puts the add button at the top of an empty chain", () => {
    expect(chainLayout([], {})).toEqual({ cards: {}, add: { x: addX, y: 0 } });
  });
});

describe("dragSlot", () => {
  const others = ["a", "b", "c"];
  const at = chainLayout(others, {}).cards;

  it("lands before the first card whose middle is below the dragged card's", () => {
    expect(dragSlot(others, at, {}, -200, ESTIMATED_HEIGHT)).toBe(0);
    expect(dragSlot(others, at, {}, step + 10, ESTIMATED_HEIGHT)).toBe(2);
    expect(dragSlot(others, at, {}, 10 * step, ESTIMATED_HEIGHT)).toBe(3);
  });

  it("skips cards that have no place yet", () => {
    expect(dragSlot(["a", "x"], at, {}, 10 * step, 100)).toBe(1);
  });
});

describe("linkAt", () => {
  const ids = ["a", "b"];
  const at = chainLayout(ids, {}).cards;
  const gapMid = ESTIMATED_HEIGHT + CHAIN_GAP / 2;

  it("finds the link between two cards, with a little slack", () => {
    expect(linkAt(ids, at, {}, { x: 100, y: gapMid })).toBe(1);
    expect(linkAt(ids, at, {}, { x: 100, y: ESTIMATED_HEIGHT - 12 })).toBe(1);
    expect(linkAt(ids, at, {}, { x: 100, y: step + 12 })).toBe(1);
  });

  it("is null on a card or beside the column", () => {
    expect(linkAt(ids, at, {}, { x: 100, y: 50 })).toBeNull();
    expect(linkAt(ids, at, {}, { x: CARD_WIDTH + 41, y: gapMid })).toBeNull();
    expect(linkAt(ids, at, {}, { x: -41, y: gapMid })).toBeNull();
  });

  it("checks against the column the chain sits in", () => {
    const x = CARD_WIDTH + COLUMN_GAP;
    expect(linkAt(ids, at, {}, { x: x + 10, y: gapMid }, x)).toBe(1);
    expect(linkAt(ids, at, {}, { x: 10, y: gapMid }, x)).toBeNull();
  });

  it("is null for a chain with one card", () => {
    expect(linkAt(["a"], at, {}, { x: 100, y: gapMid })).toBeNull();
  });
});

describe("pipelineLayout", () => {
  const col = (n: number) => n * (CARD_WIDTH + COLUMN_GAP);
  const facet: AggregationStage = {
    ...card("f", "$facet"),
    branches: [
      { key: "top", stages: [card("t1")] },
      { key: "meta", stages: [] },
    ],
  };
  const stages = [card("m"), facet, card("l", "$lookup")];
  const { at, chains } = pipelineLayout(stages, {});

  it("lays the main chain out in column 0 with its add button last", () => {
    expect(at.m).toEqual({ x: 0, y: 0 });
    expect(at.f).toEqual({ x: 0, y: step });
    expect(at.l).toEqual({ x: 0, y: 2 * step });
    expect(at[MAIN_ADD]).toEqual({ x: addX, y: 3 * step });
    expect(chains[0]).toEqual({ ref: null, x: 0, ids: ["m", "f", "l"] });
  });

  it("puts each $facet output in its own column, level with its parent", () => {
    const top = headId("f", "top");
    const meta = headId("f", "meta");
    expect(at[top]).toEqual({ x: col(1), y: step });
    expect(at.t1).toEqual({ x: col(1), y: step + HEAD_HEIGHT + CHAIN_GAP });
    expect(at[addId({ parent: "f", key: "top" })]).toEqual({
      x: col(1) + addX,
      y: step + HEAD_HEIGHT + CHAIN_GAP + step,
    });
    expect(at[meta]).toEqual({ x: col(2), y: step });
    expect(chains.slice(1)).toEqual([
      { ref: { parent: "f", key: "top" }, x: col(1), ids: [top, "t1"] },
      { ref: { parent: "f", key: "meta" }, x: col(2), ids: [meta] },
    ]);
  });

  it("pushes a simple $lookup's join card below an earlier side chain in its column", () => {
    const sideBottom = step + HEAD_HEIGHT + CHAIN_GAP + step + HEAD_HEIGHT;
    expect(at[joinId("l")]).toEqual({
      x: col(1),
      y: Math.max(2 * step, sideBottom + BRANCH_GAP),
    });
  });

  it("names the main add button apart from side chain ones", () => {
    expect(addId(null)).toBe(MAIN_ADD);
    expect(addId({ parent: "p", key: "k" })).toBe("add:p:k");
  });
});
