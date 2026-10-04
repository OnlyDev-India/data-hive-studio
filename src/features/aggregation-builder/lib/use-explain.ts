import { useCallback, useRef, useState } from "react";
import {
  canCancelPlan,
  cancelRun,
  explainMongo,
  type PlanResult,
} from "@/shared/api";
import type { PlanCall } from "@/shared/components/plan-view";
import { useStudioStore } from "@/shared/store";

/** Explain the whole pipeline: an estimate, or with analyze (which runs
 *  it) when nothing in it writes. */
export function useExplain({
  conn_id,
  database,
  collection,
}: {
  conn_id: string;
  database: string;
  collection: string;
}) {
  const kind = useStudioStore(
    (s) => s.open.find((c) => c.id === conn_id)?.kind,
  );
  const [plan, setPlan] = useState<PlanCall | null>(null);
  const latest = useRef<string | null>(null);

  const explain = useCallback(
    (shell: string, analyze: boolean) => {
      const id = crypto.randomUUID();
      latest.current = id;
      const run_id = canCancelPlan(kind) ? id : null;
      const mode = analyze ? "analyze" : "estimate";
      setPlan({
        statement: shell,
        result: null,
        mode,
        run_id,
        stopping: false,
      });
      void explainMongo(
        conn_id,
        database,
        collection,
        shell,
        analyze,
        run_id ?? undefined,
      )
        .catch((e: unknown): PlanResult => ({
          dialect: "mongodb",
          mode,
          statement: shell,
          root: null,
          elapsed_ms: 0,
          cancelled: false,
          truncated: false,
          error: e instanceof Error ? e.message : String(e),
          unsupported: null,
        }))
        .then((result) => {
          if (latest.current === id)
            setPlan((cur) => cur && { ...cur, result, stopping: false });
        });
    },
    [conn_id, database, collection, kind],
  );

  const stop = useCallback(() => {
    if (!plan?.run_id || plan.result) return;
    setPlan((cur) => cur && { ...cur, stopping: true });
    void cancelRun(conn_id, plan.run_id);
  }, [conn_id, plan]);

  return { plan, explain, stop };
}
