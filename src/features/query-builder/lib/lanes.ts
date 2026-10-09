import type { Clause, SubChain } from "@/shared/store";
import {
  ADD_NODE_WIDTH,
  CARD_WIDTH,
  CHAIN_GAP,
  ESTIMATED_HEIGHT,
  type XY,
} from "@/shared/components/builder-canvas";

/** Room between two query columns. */
export const LANE_GAP = 72;
/** A column header's height until React Flow has measured it. */
export const HEADER_HEIGHT = 40;
/** Room between a header and its first card. */
const HEADER_GAP = 28;
/** Room between a card and its chains' column. */
const CHAIN_COLUMN_GAP = 56;
/** Room between two chains stacked in one column. */
const CHAIN_STACK_GAP = 32;
/** A chain head's height until React Flow has measured it. */
const CHAIN_HEAD_HEIGHT = 36;
/** An add button's height until React Flow has measured it. */
const ADD_HEIGHT = 32;
/** The "+ Query" button after the last column. */
export const ADD_QUERY = "__add_query";

export const headerId = (query: string) => `header:${query}`;
/** The add button under a query's or a chain's cards. */
export const addId = (list: string) => `__add:${list}`;
export const chainHeadId = (chain: string) => `chain:${chain}`;

export interface Lanes {
  headers: Record<string, XY>;
  /** Cards, chain heads and add buttons. */
  at: Record<string, XY>;
  /** Each column's left edge, in canvas order. */
  xs: number[];
  addQuery: XY;
}

/** One column per query, left to right in canvas order: its header on
 *  top, then its cards top to bottom, then its add button. Each card's
 *  chains go in the column to its right, starting level with it and
 *  stacked below any earlier chain there; a collapsed chain is its head
 *  alone. A query's column is as wide as its deepest chain. `adds` says
 *  whether a list gets an add button. */
export function lanesLayout(
  lanes: { id: string; clauses: Clause[] }[],
  heights: Record<string, number>,
  adds: (list: string) => boolean = () => true,
): Lanes {
  const out: Lanes = { headers: {}, at: {}, xs: [], addQuery: { x: 0, y: 0 } };
  const h = (id: string, fallback = ESTIMATED_HEIGHT) =>
    heights[id] ?? fallback;
  let x0 = 0;
  for (const lane of lanes) {
    out.xs.push(x0);
    out.headers[lane.id] = { x: x0, y: 0 };
    const top = h(headerId(lane.id), HEADER_HEIGHT) + HEADER_GAP;
    const bottom = new Map<number, number>();
    let right = x0 + CARD_WIDTH;

    /** Place `clauses` top down at `x` from `y`, then their chains. */
    const place = (list: string, clauses: Clause[], x: number, y: number) => {
      let at = y;
      for (const c of clauses) {
        out.at[c.id] = { x, y: at };
        at += h(c.id) + CHAIN_GAP;
      }
      if (adds(list)) {
        out.at[addId(list)] = {
          x: x + (CARD_WIDTH - ADD_NODE_WIDTH) / 2,
          y: at,
        };
        at += h(addId(list), ADD_HEIGHT);
      }
      bottom.set(x, Math.max(bottom.get(x) ?? 0, at));
      const cx = x + CARD_WIDTH + CHAIN_COLUMN_GAP;
      for (const c of clauses)
        for (const ch of c.chains ?? []) placeChain(ch, cx, out.at[c.id].y);
    };

    const placeChain = (ch: SubChain, x: number, level: number) => {
      right = Math.max(right, x + CARD_WIDTH);
      const below = bottom.get(x);
      const y =
        below === undefined ? level : Math.max(level, below + CHAIN_STACK_GAP);
      const head = chainHeadId(ch.id);
      out.at[head] = { x, y };
      const after = y + h(head, CHAIN_HEAD_HEIGHT);
      if (ch.collapsed) {
        bottom.set(x, after);
        return;
      }
      place(ch.id, ch.clauses, x, after + CHAIN_GAP);
    };

    place(lane.id, lane.clauses, x0, top);
    x0 = right + LANE_GAP;
  }
  out.addQuery = { x: x0, y: 0 };
  return out;
}

/** The slot a header dragged to `x` takes among the other columns, whose
 *  left edges are `xs`: after every column whose left edge is left of
 *  its middle. */
export function laneSlot(xs: number[], x: number): number {
  const mid = x + CARD_WIDTH / 2;
  let slot = 0;
  xs.forEach((left, i) => {
    if (left + CARD_WIDTH / 2 < mid) slot = i + 1;
  });
  return slot;
}
