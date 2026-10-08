import type { StageError } from "@/shared/api";
import type { CardFault } from "@/shared/components/builder-canvas";
import type { AggregationStage } from "@/shared/store";
import { isBranching } from "./model";
import type { CardPreview } from "./use-previews";

/** How a card is named when it holds others back. */
export function cardName(
  ordinal: number,
  side?: { key: string; parent: number },
) {
  return side
    ? `${side.key} stage ${ordinal} of stage ${side.parent}`
    : `stage ${ordinal}`;
}

/** What is wrong with each enabled card, if anything. A card fails when its
 *  text does not compose or its last preview failed; every enabled card that
 *  reads through the first failing one waits on it. A side chain card reads
 *  through its own chain and the main chain before its parent (a
 *  `$unionWith` chain only through its parent), and a parent reads through
 *  its side chains. Disabled cards have no state. */
export function cardFaults(
  stages: AggregationStage[],
  composeErrors: StageError[],
  previews: Record<string, CardPreview>,
): Record<string, CardFault> {
  const composed = new Map<string, string>();
  for (const e of composeErrors) composed.set(e.stage_id, e.message);

  const out: Record<string, CardFault> = {};
  const failed = (id: string): CardFault | null => {
    const own = composed.get(id);
    if (own) return { error: own };
    const p = previews[id];
    if (p?.status === "error" && p.chunk?.error)
      return { error: p.chunk.error, timed_out: !!p.chunk.timed_out };
    return null;
  };

  let first: string | null = null;
  stages.forEach((s, i) => {
    if (!s.enabled) return;
    const own_error = composed.get(s.id);
    let side_failed: string | null = null;
    if (isBranching(s.op))
      for (const b of s.branches ?? []) {
        // A `$unionWith` chain reads its own collection, through the parent's coll.
        const union = s.op === "$unionWith";
        let held: string | null = union
          ? own_error
            ? cardName(i + 1)
            : null
          : (first ??
            (s.op === "$lookup" && own_error ? cardName(i + 1) : null));
        let n = 0;
        for (const x of b.stages) {
          if (!x.enabled) continue;
          n++;
          const name = cardName(n, { key: b.key, parent: i + 1 });
          const own = composed.get(x.id);
          if (own) {
            out[x.id] = { error: own };
            held ??= name;
            side_failed ??= name;
            continue;
          }
          if (held) {
            out[x.id] = { blocked_by: held };
            continue;
          }
          const f = failed(x.id);
          if (f) {
            out[x.id] = f;
            held = name;
            side_failed ??= name;
          }
        }
      }
    if (own_error) {
      out[s.id] = { error: own_error };
      first ??= cardName(i + 1);
      return;
    }
    if (first !== null) {
      out[s.id] = { blocked_by: first };
      return;
    }
    if (side_failed) {
      out[s.id] = { blocked_by: side_failed };
      first = side_failed;
      return;
    }
    const f = failed(s.id);
    if (f) {
      out[s.id] = f;
      first = cardName(i + 1);
    }
  });
  return out;
}
