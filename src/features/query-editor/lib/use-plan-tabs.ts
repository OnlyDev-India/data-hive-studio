import { useCallback, useRef, useState } from "react";
import {
  canCancelRun,
  explainMongo,
  explainSql,
  type PlanDialect,
  type PlanResult,
} from "@/shared/api";

/** One Plan tab beside the result tabs. Its `id` is negative so it can never
 *  collide with a result tab's id in the shared strip. */
export interface PlanTab {
  id: number;
  label: string;
  /** The exact statement this tab was asked to explain, after bind
   *  variables were substituted. */
  statement: string;
  /** The statement as it stood in the editor, before substitution. The stale
   *  check looks for this, so a statement with bind variables is not stale
   *  the moment it is explained. */
  source: string;
  /** Null while the database is still answering. */
  result: PlanResult | null;
  mode: PlanResult["mode"];
  /** Set only when Stop can reach the call (see `canCancelRun`). */
  run_id: string | null;
  /** Stop was pressed and the database has not confirmed yet. */
  stopping: boolean;
}

/** The plan tabs of one SQL editor. A plan lives in memory with its tab, like
 *  a result: nothing is written to disk. */
/** One statement to explain: what the editor holds, and what is sent. */
export interface PlanRequest {
  source: string;
  statement: string;
}

export function usePlanTabs({
  conn_id,
  dialect,
  database,
  console_database,
  keep_all_tabs,
  on_open,
  on_activate,
}: {
  conn_id: string;
  dialect: PlanDialect;
  /** Same target database Run uses; omitted = the connection's own. */
  database?: string;
  /** The MongoDB console's current database. Set only for the console, whose
   *  text is a console command rather than SQL. */
  console_database?: string;
  /** The result strip's "new tab per run" toggle. Off: a single statement
   *  explained again reuses the one plan tab, as a single run reuses its
   *  result tab. A selection of several statements always gets one tab each. */
  keep_all_tabs: boolean;
  /** Called first, so a plan shows even when the results panel was hidden. */
  on_open: () => void;
  on_activate: (id: number) => void;
}) {
  const [tabs, setTabs] = useState<PlanTab[]>([]);
  const next_id = useRef(0);
  /** The plan tab a single explain reuses while `keep_all_tabs` is off. */
  const reusable_id = useRef<number | null>(null);
  /** The newest call per tab, so a slower older answer never overwrites the
   *  plan a reused tab is showing now. */
  const latest_call = useRef(new Map<number, number>());
  const calls = useRef(0);

  const open = useCallback(
    ({ source, statement }: PlanRequest, analyze: boolean, reuse: boolean) => {
      const held = reuse ? reusable_id.current : null;
      const id = held ?? -++next_id.current;
      if (reuse) reusable_id.current = id;
      const call = ++calls.current;
      latest_call.current.set(id, call);
      const run_id = canCancelRun(dialect) ? crypto.randomUUID() : null;
      const tab: PlanTab = {
        id,
        label: "Plan",
        statement,
        source,
        result: null,
        mode: analyze ? "analyze" : "estimate",
        run_id,
        stopping: false,
      };
      setTabs((cur) =>
        held !== null && cur.some((t) => t.id === held)
          ? cur.map((t) => (t.id === held ? tab : t))
          : [...cur, tab],
      );
      return { id, run_id, statement, analyze, call };
    },
    [dialect],
  );

  /** The plan call, with a failed call turned into a result carrying the
   *  error, so a tab (or the auto plan) has one shape to look at. */
  const request_plan = useCallback(
    async (
      statement: string,
      analyze: boolean,
      run_id: string | null,
    ): Promise<PlanResult> => {
      const call =
        console_database !== undefined
          ? explainMongo(
              conn_id,
              console_database,
              null,
              statement,
              analyze,
              run_id ?? undefined,
            )
          : explainSql(
              conn_id,
              statement,
              database,
              undefined,
              analyze,
              run_id ?? undefined,
            );
      return call.catch((e: unknown): PlanResult => ({
        dialect,
        mode: analyze ? "analyze" : "estimate",
        statement,
        root: null,
        elapsed_ms: 0,
        cancelled: false,
        truncated: false,
        error: e instanceof Error ? e.message : String(e),
        unsupported: null,
      }));
    },
    [conn_id, dialect, database, console_database],
  );

  /** Resolves true when the call failed or was stopped. */
  const fetch_plan = useCallback(
    async ({
      id,
      run_id,
      statement,
      analyze,
      call,
    }: ReturnType<typeof open>): Promise<boolean> => {
      const result = await request_plan(statement, analyze, run_id);
      if (latest_call.current.get(id) === call) {
        setTabs((cur) => cur.map((t) => (t.id === id ? { ...t, result } : t)));
      }
      return !!result.error || result.cancelled;
    },
    [request_plan],
  );

  /** Explain each statement in its own tab. Estimates go out together. An
   *  analyze runs the statements one after another and stops at the first
   *  one that fails or is stopped, since it really executes them. */
  const explain = useCallback(
    (requests: PlanRequest[], analyze = false) => {
      if (requests.length === 0) return;
      on_open();
      const reuse = !keep_all_tabs && requests.length === 1;
      if (!analyze) {
        let last = 0;
        for (const request of requests) {
          const started = open(request, false, reuse);
          last = started.id;
          void fetch_plan(started);
        }
        on_activate(last);
        return;
      }
      void (async () => {
        for (const [i, request] of requests.entries()) {
          const started = open(request, true, reuse);
          if (i === 0) on_activate(started.id);
          if (await fetch_plan(started)) break;
        }
      })();
    },
    [open, fetch_plan, on_open, on_activate, keep_all_tabs],
  );

  /** Marks Stop as pressed (or undone) for the tab still running `run_id`. */
  const patch_run = useCallback(
    (id: number, run_id: string, patch: { stopping?: boolean }) => {
      setTabs((cur) =>
        cur.map((t) =>
          t.id === id && t.run_id === run_id && t.result === null
            ? { ...t, ...patch }
            : t,
        ),
      );
    },
    [],
  );

  const close = useCallback((id: number) => {
    if (reusable_id.current === id) reusable_id.current = null;
    latest_call.current.delete(id);
    setTabs((cur) => cur.filter((t) => t.id !== id));
  }, []);

  return { tabs, explain, close, patch_run };
}
