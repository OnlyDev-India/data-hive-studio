import { useCallback, useEffect, useRef, useState } from "react";
import {
  canCancelRun,
  cancelRun,
  createRowAccumulator,
  runSqlStream,
  type QueryResult,
} from "@/shared/api";
import type { BuilderRun } from "@/shared/components/builder-canvas";
import { isSchemaDdl } from "@/shared/lib/write-detect";
import { useStudioStore } from "@/shared/store";

export type RunStatus =
  "queued" | "running" | "done" | "error" | "stopped" | "not_run";

/** One query's last run, the result tab it fills. */
export interface QueryRun extends BuilderRun {
  label: string;
  status: RunStatus;
  is_select: boolean;
  rows_affected: number;
}

/** A query to run: its SQL with any bind values in, and whether it runs
 *  read only. */
export interface RunItem {
  id: string;
  label: string;
  sql: string;
  read_only: boolean;
}

/** What a finished run changed, for the refresh after it. */
export interface RunOutcome {
  wrote: boolean;
  ddl: boolean;
}

const queued = (item: RunItem): QueryRun => ({
  label: item.label,
  status: "queued",
  started_at: 0,
  running: false,
  stopping: false,
  snapshot: null,
  error: null,
  elapsed_ms: null,
  cancelled: false,
  command: item.sql,
  is_select: true,
  rows_affected: 0,
});

/** Runs queries one after another, each into its own result keyed by query
 *  id, replacing that query's last one. The first error or a Stop ends the
 *  run, and the rest are marked not run. */
export function useQueryRuns(
  conn_id: string,
  target: { database: string | null; schema: string | null },
) {
  const kind = useStudioStore(
    (s) => s.open.find((c) => c.id === conn_id)?.kind,
  );
  const can_cancel = canCancelRun(kind);
  const [runs, setRuns] = useState<Record<string, QueryRun>>({});
  const [running, setRunning] = useState(false);
  // The batch in flight: the run Stop reaches, and whether Stop was
  // pressed.
  const live = useRef<{ run_id: string | null; stopped: boolean } | null>(null);

  const patch = useCallback(
    (id: string, p: Partial<QueryRun>) =>
      setRuns((cur) =>
        cur[id] ? { ...cur, [id]: { ...cur[id], ...p } } : cur,
      ),
    [],
  );

  const start = useCallback(
    async (items: RunItem[]): Promise<RunOutcome> => {
      const outcome: RunOutcome = { wrote: false, ddl: false };
      if (items.length === 0 || live.current) return outcome;
      const me = { run_id: null as string | null, stopped: false };
      live.current = me;
      const mine = () => live.current === me;
      setRunning(true);
      setRuns((cur) => {
        const next = { ...cur };
        for (const item of items) next[item.id] = queued(item);
        return next;
      });

      let ended = false;
      for (const item of items) {
        if (!mine()) return outcome;
        if (ended || me.stopped) {
          patch(item.id, { status: "not_run" });
          continue;
        }
        const run_id = can_cancel ? crypto.randomUUID() : null;
        me.run_id = run_id;
        const started_at = performance.now();
        patch(item.id, { status: "running", running: true, started_at });
        const acc = createRowAccumulator((snapshot) => {
          if (mine()) patch(item.id, { snapshot });
        });
        let res: QueryResult;
        try {
          res = await runSqlStream(
            conn_id,
            item.sql,
            acc.push,
            target.database ?? undefined,
            target.schema ?? undefined,
            run_id ?? undefined,
            item.read_only,
          );
        } catch (e) {
          res = {
            columns: [],
            rows: [],
            rows_affected: 0,
            is_select: false,
            error: e instanceof Error ? e.message : String(e),
            elapsed_ms: 0,
          };
        }
        if (!mine()) return outcome;
        const elapsed_ms = Math.round(performance.now() - started_at);
        const status: RunStatus = res.cancelled
          ? "stopped"
          : res.error
            ? "error"
            : "done";
        patch(item.id, {
          status,
          running: false,
          stopping: false,
          snapshot: acc.started() ? acc.finish() : null,
          error: res.error ?? null,
          elapsed_ms: res.cancelled ? elapsed_ms : res.elapsed_ms,
          cancelled: !!res.cancelled,
          is_select: res.is_select || acc.started(),
          rows_affected: res.rows_affected,
        });
        if (status === "done" && !res.is_select) {
          outcome.wrote = true;
          if (isSchemaDdl(item.sql)) outcome.ddl = true;
        }
        if (status !== "done") ended = true;
      }
      if (mine()) live.current = null;
      setRunning(false);
      return outcome;
    },
    [conn_id, target.database, target.schema, can_cancel, patch],
  );

  const stop = useCallback(() => {
    const cur = live.current;
    if (!cur) return;
    // Without a run id the engine can't stop, but the rest is skipped.
    cur.stopped = true;
    if (!cur.run_id) return;
    setRuns((all) => {
      const next = { ...all };
      for (const [id, r] of Object.entries(all))
        if (r.status === "running") next[id] = { ...r, stopping: true };
      return next;
    });
    void cancelRun(conn_id, cur.run_id);
  }, [conn_id]);

  // A closed tab stops what it was running.
  useEffect(
    () => () => {
      const cur = live.current;
      live.current = null;
      if (cur?.run_id && can_cancel) void cancelRun(conn_id, cur.run_id);
    },
    [conn_id, can_cancel],
  );

  return { runs, running, start, stop };
}
