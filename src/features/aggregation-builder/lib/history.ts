import type { AggregationStage } from "@/shared/store";

/** How many steps back a tab can go. */
export const HISTORY_MAX = 100;

export interface History {
  past: AggregationStage[][];
  future: AggregationStage[][];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };

/** Remember `before` as the state to go back to; a new change drops redo. */
export function record(h: History, before: AggregationStage[]): History {
  return { past: [...h.past, before].slice(-HISTORY_MAX), future: [] };
}

export function undo(
  h: History,
  current: AggregationStage[],
): [History, AggregationStage[] | null] {
  const prev = h.past.at(-1);
  if (!prev) return [h, null];
  return [{ past: h.past.slice(0, -1), future: [...h.future, current] }, prev];
}

export function redo(
  h: History,
  current: AggregationStage[],
): [History, AggregationStage[] | null] {
  const next = h.future.at(-1);
  if (!next) return [h, null];
  return [{ past: [...h.past, current], future: h.future.slice(0, -1) }, next];
}

/** Every tab's history, in memory only, so it outlives switching tabs but
 *  not a restart. */
const histories = new Map<string, History>();

export function historyOf(tab_key: string): History {
  return histories.get(tab_key) ?? EMPTY_HISTORY;
}

export function setHistory(tab_key: string, h: History) {
  histories.set(tab_key, h);
}
