export interface CardFault {
  /** Why the card fails: its text, the server, or the time limit. */
  error?: string;
  timed_out?: boolean;
  /** The earlier card that holds this one back, such as "stage 3". */
  blocked_by?: string;
}

/** What is wrong with each card of one ordered chain: a card fails on its
 *  own text or its last preview, and every card after the first failing one
 *  waits on it. Cards `skip` leaves out have no state. */
export function chainFaults({
  ids,
  own,
  failed,
  name,
  skip,
}: {
  ids: string[];
  /** The card's own text error, which needs no preview. */
  own: (id: string) => string | undefined;
  /** The card's last preview error. */
  failed: (id: string) => { error: string; timed_out?: boolean } | null;
  /** How card `index` (0 based) is named when it holds others back. */
  name: (index: number) => string;
  skip?: (id: string) => boolean;
}): Record<string, CardFault> {
  const out: Record<string, CardFault> = {};
  let first: string | null = null;
  ids.forEach((id, i) => {
    if (skip?.(id)) return;
    const text = own(id);
    if (text) {
      out[id] = { error: text };
      first ??= name(i);
      return;
    }
    if (first !== null) {
      out[id] = { blocked_by: first };
      return;
    }
    const f = failed(id);
    if (f) {
      out[id] = f;
      first = name(i);
    }
  });
  return out;
}

/** Whether any card fails, which holds back Run and Copy. */
export function hasFault(faults: Record<string, CardFault>): boolean {
  return Object.values(faults).some((f) => f.error);
}
