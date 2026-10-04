import type { AggregationStage } from "@/shared/store";
import { isBranching, type ChainRef } from "./model";

export const CARD_WIDTH = 380;
/** Room between two cards for the link and its "+" button. */
export const CHAIN_GAP = 56;
/** A card's height until React Flow has measured it. */
export const ESTIMATED_HEIGHT = 150;
export const ADD_NODE_WIDTH = 140;
/** Room between columns for the link from a parent to its side chain. */
export const COLUMN_GAP = 72;
/** Room between two side chains stacked in one column. */
export const BRANCH_GAP = 40;
/** A side chain head's height until React Flow has measured it. */
export const HEAD_HEIGHT = 32;

export interface XY {
  x: number;
  y: number;
}

/** Where a card dragged with its top at `y` lands among `others` (the chain
 *  without it): before the first card whose middle is below its own. */
export function dragSlot(
  others: string[],
  at: Record<string, XY>,
  heights: Record<string, number>,
  y: number,
  height: number,
): number {
  const mid = y + height / 2;
  return others.filter(
    (id) => at[id] && at[id].y + (heights[id] ?? ESTIMATED_HEIGHT) / 2 < mid,
  ).length;
}

/** The link a point on the canvas sits on, as the index a stage dropped
 *  there takes; null when it is on no link. */
export function linkAt(
  ids: string[],
  at: Record<string, XY>,
  heights: Record<string, number>,
  p: XY,
  x = 0,
): number | null {
  if (p.x < x - 40 || p.x > x + CARD_WIDTH + 40) return null;
  for (let i = 0; i + 1 < ids.length; i++) {
    const bottom = at[ids[i]].y + (heights[ids[i]] ?? ESTIMATED_HEIGHT);
    const top = at[ids[i + 1]].y;
    if (p.y >= bottom - 12 && p.y <= top + 12) return i + 1;
  }
  return null;
}

/** The main chain top to bottom in column 0, each card below the measured
 *  height of the one above, then the add button under the last card. */
export function chainLayout(
  ids: string[],
  heights: Record<string, number>,
): { cards: Record<string, XY>; add: XY } {
  const cards: Record<string, XY> = {};
  let y = 0;
  for (const id of ids) {
    cards[id] = { x: 0, y };
    y += (heights[id] ?? ESTIMATED_HEIGHT) + CHAIN_GAP;
  }
  return { cards, add: { x: (CARD_WIDTH - ADD_NODE_WIDTH) / 2, y } };
}

export const MAIN_ADD = "__add";
export const headId = (parent: string, key: string) => `head:${parent}:${key}`;
export const addId = (ref: ChainRef) =>
  ref ? `add:${ref.parent}:${ref.key}` : MAIN_ADD;
export const joinId = (parent: string) => `join:${parent}`;

/** One chain as laid out: its column and its nodes top to bottom, a side
 *  chain's head first. */
export interface ChainPlace {
  ref: ChainRef;
  x: number;
  ids: string[];
}

/** Every node's place: the main chain in column 0 as `chainLayout` stacks
 *  it, and each parent's side chains in the columns to its right, side by
 *  side for `$facet` outputs. A side chain starts level with its parent,
 *  pushed below any earlier one in the same column. A simple `$lookup`
 *  gets its small join card the same way. */
export function pipelineLayout(
  stages: AggregationStage[],
  heights: Record<string, number>,
): { at: Record<string, XY>; chains: ChainPlace[] } {
  const h = (id: string, fallback = ESTIMATED_HEIGHT) =>
    heights[id] ?? fallback;
  const main = chainLayout(
    stages.map((s) => s.id),
    heights,
  );
  const at: Record<string, XY> = { ...main.cards, [MAIN_ADD]: main.add };
  const chains: ChainPlace[] = [
    { ref: null, x: 0, ids: stages.map((s) => s.id) },
  ];
  const bottom: number[] = [];
  const columnX = (col: number) => col * (CARD_WIDTH + COLUMN_GAP);
  const topIn = (col: number, y: number) =>
    bottom[col] === undefined ? y : Math.max(y, bottom[col] + BRANCH_GAP);

  for (const s of stages) {
    const y0 = main.cards[s.id].y;
    if (isBranching(s.op) && s.branches?.length) {
      s.branches.forEach((b, k) => {
        const col = k + 1;
        const x = columnX(col);
        const ref = { parent: s.id, key: b.key };
        const head = headId(s.id, b.key);
        let y = topIn(col, y0);
        at[head] = { x, y };
        y += h(head, HEAD_HEIGHT) + CHAIN_GAP;
        for (const c of b.stages) {
          at[c.id] = { x, y };
          y += h(c.id) + CHAIN_GAP;
        }
        const add = addId(ref);
        at[add] = { x: x + (CARD_WIDTH - ADD_NODE_WIDTH) / 2, y };
        bottom[col] = y + h(add, HEAD_HEIGHT);
        chains.push({ ref, x, ids: [head, ...b.stages.map((c) => c.id)] });
      });
    } else if (s.op === "$lookup") {
      const join = joinId(s.id);
      const y = topIn(1, y0);
      at[join] = { x: columnX(1), y };
      bottom[1] = y + h(join, HEAD_HEIGHT * 2);
    }
  }
  return { at, chains };
}
