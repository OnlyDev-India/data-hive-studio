/** How many steps back a tab can go. */
export const HISTORY_MAX = 100;

export interface History<T = unknown> {
  past: T[];
  future: T[];
}

export const EMPTY_HISTORY: History<never> = { past: [], future: [] };

/** Remember `before` as the state to go back to; a new change drops redo. */
export function record<T>(h: History<T>, before: T): History<T> {
  return { past: [...h.past, before].slice(-HISTORY_MAX), future: [] };
}

export function undo<T>(h: History<T>, current: T): [History<T>, T | null] {
  const prev = h.past.at(-1);
  if (prev === undefined) return [h, null];
  return [{ past: h.past.slice(0, -1), future: [...h.future, current] }, prev];
}

export function redo<T>(h: History<T>, current: T): [History<T>, T | null] {
  const next = h.future.at(-1);
  if (next === undefined) return [h, null];
  return [{ past: [...h.past, current], future: h.future.slice(0, -1) }, next];
}

/** Every tab's history, in memory only, so it outlives switching tabs but
 *  not a restart. */
const histories = new Map<string, History>();

export function historyOf<T>(tab_key: string): History<T> {
  return (histories.get(tab_key) as History<T> | undefined) ?? EMPTY_HISTORY;
}

export function setHistory<T>(tab_key: string, h: History<T>) {
  histories.set(tab_key, h as History);
}
