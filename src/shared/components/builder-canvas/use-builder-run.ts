import { useCallback, useEffect, useRef, useState } from "react";
import {
  canCancelRun,
  cancelRun,
  createRowAccumulator,
  type QueryChunk,
  type RowSnapshot,
} from "@/shared/api";
import { useStudioStore } from "@/shared/store";

export interface BuilderRun {
  started_at: number;
  running: boolean;
  stopping: boolean;
  snapshot: RowSnapshot | null;
  error: string | null;
  elapsed_ms: number | null;
  cancelled: boolean;
  /** The text that ran, for the grid's query context. */
  command: string;
}

/** How a run ended, as the engine reports it. */
export interface RunOutcome {
  error?: string | null;
  elapsed_ms: number;
  cancelled?: boolean;
  command?: string;
}

/** Run the builder's whole query with no cap, its rows filling in as they
 *  stream. `launch` starts it with the run id to stop it by (null when the
 *  engine can't stop) and a sink for its chunks. */
export function useBuilderRun(
  conn_id: string,
  launch: (
    run_id: string | null,
    onChunk: (chunk: QueryChunk) => void,
  ) => Promise<RunOutcome>,
) {
  const kind = useStudioStore(
    (s) => s.open.find((c) => c.id === conn_id)?.kind,
  );
  const [run, setRun] = useState<BuilderRun | null>(null);
  const run_id = useRef<string | null>(null);
  const can_cancel = canCancelRun(kind);

  const start = useCallback(
    (command = "") => {
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
        command,
      });
      void launch(can_cancel ? id : null, (chunk) => acc.push(chunk))
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
                command: res.command ?? cur.command,
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
    },
    [launch, can_cancel],
  );

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
