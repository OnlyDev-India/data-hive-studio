import { useCallback, useEffect, useRef, useState } from "react";
import {
  canCancelRun,
  cancelRun,
  createRowAccumulator,
  runPipelineStream,
  type RowSnapshot,
} from "@/shared/api";
import { useStudioStore, type AggregationSetup } from "@/shared/store";
import { toSpec } from "./model";

export interface PipelineRun {
  started_at: number;
  running: boolean;
  stopping: boolean;
  snapshot: RowSnapshot | null;
  error: string | null;
  elapsed_ms: number | null;
  cancelled: boolean;
  command: string;
}

/** Run the whole pipeline with no cap, its rows filling in as they stream. */
export function usePipelineRun({
  conn_id,
  database,
  collection,
  setup,
}: {
  conn_id: string;
  database: string;
  collection: string;
  setup: AggregationSetup;
}) {
  const kind = useStudioStore(
    (s) => s.open.find((c) => c.id === conn_id)?.kind,
  );
  const [run, setRun] = useState<PipelineRun | null>(null);
  const run_id = useRef<string | null>(null);
  const can_cancel = canCancelRun(kind);

  const start = useCallback(() => {
    const id = crypto.randomUUID();
    run_id.current = id;
    const acc = createRowAccumulator((snapshot) => {
      if (run_id.current !== id) return;
      setRun((cur) => (cur ? { ...cur, snapshot } : cur));
    });
    setRun({
      started_at: performance.now(),
      running: true,
      stopping: false,
      snapshot: null,
      error: null,
      elapsed_ms: null,
      cancelled: false,
      command: "",
    });
    void runPipelineStream(
      conn_id,
      {
        database,
        collection,
        spec: toSpec(setup.stages),
        allow_disk_use: setup.allow_disk_use,
        run_id: can_cancel ? id : null,
      },
      (chunk) => acc.push(chunk),
    )
      .then((res) => {
        if (run_id.current !== id) return;
        setRun(
          (cur) =>
            cur && {
              ...cur,
              running: false,
              stopping: false,
              snapshot: acc.finish(),
              error: res.error ?? null,
              elapsed_ms: res.elapsed_ms,
              cancelled: !!res.cancelled,
              command: res.command,
            },
        );
      })
      .catch((e: unknown) => {
        if (run_id.current !== id) return;
        setRun(
          (cur) =>
            cur && {
              ...cur,
              running: false,
              stopping: false,
              snapshot: acc.started() ? acc.finish() : null,
              error: e instanceof Error ? e.message : String(e),
            },
        );
      })
      .finally(() => {
        if (run_id.current === id) run_id.current = null;
      });
  }, [
    conn_id,
    database,
    collection,
    setup.stages,
    setup.allow_disk_use,
    can_cancel,
  ]);

  const stop = useCallback(() => {
    const id = run_id.current;
    if (!id || !can_cancel) return;
    setRun((cur) => cur && { ...cur, stopping: true });
    void cancelRun(conn_id, id);
  }, [conn_id, can_cancel]);

  useEffect(
    () => () => {
      const id = run_id.current;
      run_id.current = null;
      if (id && can_cancel) void cancelRun(conn_id, id);
    },
    [conn_id, can_cancel],
  );

  return { run, start, stop: can_cancel ? stop : undefined };
}
