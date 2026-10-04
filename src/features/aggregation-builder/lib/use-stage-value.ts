import { useEffect, useState } from "react";
import { composePipeline } from "@/shared/api";

export type StageValue =
  | { body: string; ok: true; value: unknown }
  | { body: string; ok: false; error: string };

/** A card's body read as its canonical value, through the same compose the
 *  pipeline uses, so a form sees exactly what Rust parses. `body` names the
 *  text it was read from, so a stale answer can be told apart. */
export function useStageValue(op: string, body: string): StageValue | null {
  const [value, setValue] = useState<StageValue | null>(null);
  useEffect(() => {
    let live = true;
    const spec = {
      stages: [
        { id: "form", op, body, enabled: true, title: null, note: null },
      ],
    };
    composePipeline("", spec)
      .then((c) => {
        if (!live) return;
        const err = c.errors[0];
        const stage = c.canonical[0] as Record<string, unknown> | undefined;
        setValue(
          err || !stage
            ? { body, ok: false, error: err?.message ?? "Not a stage" }
            : { body, ok: true, value: Object.values(stage)[0] },
        );
      })
      .catch((e: unknown) => {
        if (live)
          setValue({
            body,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
      });
    return () => {
      live = false;
    };
  }, [op, body]);
  return value;
}
