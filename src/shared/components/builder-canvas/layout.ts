export const CARD_WIDTH = 380;
/** Room between two cards for the link and its "+" button. */
export const CHAIN_GAP = 56;
/** A card's height until React Flow has measured it. */
export const ESTIMATED_HEIGHT = 150;
export const ADD_NODE_WIDTH = 140;
/** The add button under the main chain's last card. */
export const MAIN_ADD = "__add";

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

/** The link a point on the canvas sits on, as the index a card dropped
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
