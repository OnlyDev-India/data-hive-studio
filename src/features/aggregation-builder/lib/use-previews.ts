import { useCallback, useEffect, useRef, useState } from "react";
import {
  canCancelRun,
  cancelRun,
  composePipeline,
  previewPipeline,
  type ComposedPipeline,
  type PreviewChunk,
} from "@/shared/api";
import {
  useStudioStore,
  type AggregationSetup,
  type AggregationStage,
} from "@/shared/store";
import {
  allStages,
  firstChanged,
  previewTargets,
  toSpec,
  type StageRef,
} from "./model";
import { isConnectionLost } from "./offline";

/** How long typing must pause before a refresh starts. */
export const PREVIEW_DEBOUNCE_MS = 600;
/** How many documents a card's preview brings back for the bottom panel. */
export const PREVIEW_SHOW = 20;

export type PreviewStatus =
  "running" | "ready" | "error" | "waiting" | "offline";

export interface CardPreview {
  status: PreviewStatus;
  /** The last result, kept while a newer one runs or waits. */
  chunk: PreviewChunk | null;
}

export interface Previews {
  cards: Record<string, CardPreview>;
  composed: ComposedPipeline | null;
  /** The collection's estimated size from the last refresh. */
  estimate: number | null;
  refreshing: boolean;
  /** The connection is not open, or the last refresh could not reach the
   *  server. Cards keep their last result. */
  offline: boolean;
  /** Refresh every card now (the Preview button, Reconnect). */
  refresh: () => void;
}

/** While offline, how often a refresh tries the server again. */
const RETRY_MS = 10_000;

/** Keeps every card's preview in step with the pipeline: an edit refreshes
 *  that card and every card after it, `PREVIEW_DEBOUNCE_MS` after typing
 *  stops when auto preview is on. A new refresh stops the one still running,
 *  and only the latest refresh's results are shown. */
export function usePreviews({
  conn_id,
  database,
  collection,
  setup,
}: {
  conn_id: string;
  database: string;
  collection: string;
  setup: AggregationSetup;
}): Previews {
  const conn = useStudioStore((s) => s.open.find((c) => c.id === conn_id));
  const concurrency = useStudioStore((s) => s.previewConcurrency);
  const [cards, setCards] = useState<Record<string, CardPreview>>({});
  const [composed, setComposed] = useState<ComposedPipeline | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lost, setLost] = useState(false);

  const run_id = useRef<string | null>(null);
  const previewed = useRef<AggregationStage[] | null>(null);
  const stages = setup.stages;
  const can_cancel = canCancelRun(conn?.kind);

  const start = useCallback(
    (from: StageRef | null, target: AggregationStage[]) => {
      const previous = run_id.current;
      if (previous && can_cancel) void cancelRun(conn_id, previous);
      const id = crypto.randomUUID();
      run_id.current = id;
      previewed.current = target;

      const targets = previewTargets(target, from);
      const live = new Set(allStages(target).map((s) => s.id));
      setCards((cur) => {
        const next: Record<string, CardPreview> = {};
        for (const [k, v] of Object.entries(cur)) if (live.has(k)) next[k] = v;
        for (const k of targets)
          next[k] = { status: "running", chunk: cur[k]?.chunk ?? null };
        return next;
      });
      if (targets.size === 0) {
        setRefreshing(false);
        return;
      }
      setRefreshing(true);
      const go_offline = () => {
        setLost(true);
        // Refresh everything once the server answers again.
        previewed.current = null;
        setCards((cur) => {
          const next = { ...cur };
          for (const k of targets)
            next[k] = { status: "offline", chunk: cur[k]?.chunk ?? null };
          return next;
        });
      };
      // A database that drops under an open session fails each card, not
      // the call, so a lost chunk counts as offline too.
      let unreachable = false;
      void previewPipeline(
        conn_id,
        {
          database,
          collection,
          spec: toSpec(target),
          from,
          cap: setup.preview_cap,
          time_ms: setup.preview_time_ms,
          show: PREVIEW_SHOW,
          concurrency,
          run_id: can_cancel ? id : null,
        },
        (chunk) => {
          if (run_id.current !== id) return;
          if (isConnectionLost(chunk.error)) {
            unreachable = true;
            return;
          }
          setCards((cur) => ({
            ...cur,
            [chunk.stage_id]: {
              status: chunk.error ? "error" : "ready",
              chunk,
            },
          }));
        },
      )
        .then((summary) => {
          if (run_id.current !== id) return;
          if (unreachable) {
            go_offline();
            return;
          }
          setLost(false);
          if (summary.source_estimate !== null)
            setEstimate(summary.source_estimate);
        })
        .catch((e: unknown) => {
          if (run_id.current !== id) return;
          const message = e instanceof Error ? e.message : String(e);
          if (isConnectionLost(message)) {
            go_offline();
            return;
          }
          setCards((cur) => {
            const next = { ...cur };
            for (const k of targets)
              next[k] = {
                status: "error",
                chunk: { ...emptyChunk(k), error: message },
              };
            return next;
          });
        })
        .finally(() => {
          if (run_id.current !== id) return;
          run_id.current = null;
          setRefreshing(false);
          // A target with no answer sits behind a card that failed.
          setCards((cur) => {
            const next = { ...cur };
            for (const k of targets)
              if (next[k]?.status === "running")
                next[k] = { ...next[k], status: "waiting" };
            return next;
          });
        });
    },
    [
      conn_id,
      database,
      collection,
      setup.preview_cap,
      setup.preview_time_ms,
      concurrency,
      can_cancel,
    ],
  );

  // Compose on every change, so card errors and Copy follow the text.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void composePipeline(collection, toSpec(stages))
        .then((c) => {
          if (live) setComposed(c);
        })
        .catch(() => {
          if (live) setComposed(null);
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [collection, stages]);

  useEffect(() => {
    if (!setup.auto_preview || !conn) return;
    const prev = previewed.current;
    const from = prev === null ? null : firstChanged(prev, stages);
    if (from === undefined) return;
    const timer = setTimeout(
      () => start(from, stages),
      prev === null ? 0 : PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [stages, setup.auto_preview, conn, start]);

  // Stop whatever is still running when the tab goes away.
  useEffect(
    () => () => {
      const id = run_id.current;
      run_id.current = null;
      if (id && can_cancel) void cancelRun(conn_id, id);
    },
    [conn_id, can_cancel],
  );

  const refresh = useCallback(() => start(null, stages), [start, stages]);

  const offline = lost || !conn;
  useEffect(() => {
    if (!lost || !conn || refreshing) return;
    const timer = setTimeout(refresh, RETRY_MS);
    return () => clearTimeout(timer);
  }, [lost, conn, refreshing, refresh]);

  return { cards, composed, estimate, refreshing, offline, refresh };
}

function emptyChunk(stage_id: string): PreviewChunk {
  return {
    stage_id,
    count: 0,
    columns: [],
    rows: [],
    documents: [],
    elapsed_ms: 0,
  };
}
