import { useCallback, useEffect, useRef, useState } from "react";
import { canCancelRun, cancelRun } from "@/shared/api";
import { useStudioStore } from "@/shared/store";
import { isConnectionLost } from "./offline";

/** How long typing must pause before a refresh starts. */
export const PREVIEW_DEBOUNCE_MS = 600;
/** How many rows a card's preview brings back for the bottom panel. */
export const PREVIEW_SHOW = 20;
/** While offline, how often a refresh tries the server again. */
const RETRY_MS = 10_000;

export type PreviewStatus =
  "running" | "ready" | "error" | "waiting" | "offline";

/** What every builder's preview chunk carries. */
export interface ChunkBase {
  count: number;
  elapsed_ms: number;
  error?: string | null;
  timed_out?: boolean;
}

export interface CardPreview<C> {
  status: PreviewStatus;
  /** The last result, kept while a newer one runs or waits. */
  chunk: C | null;
}

/** One refresh as the builder runs it: every card in `targets` answers
 *  through `onChunk`, and the promise settles once the refresh is over. */
export interface RefreshCall<T, F, C> {
  items: T;
  from: F | null;
  targets: Set<string>;
  /** The id to stop it with `cancelRun`, null when the engine can't. */
  run_id: string | null;
  onChunk: (id: string, chunk: C) => void;
  /** Whether this is still the latest refresh. */
  current: () => boolean;
}

export interface PreviewScheduler<C> {
  cards: Record<string, CardPreview<C>>;
  refreshing: boolean;
  /** The connection is not open, or the last refresh could not reach the
   *  server. Cards keep their last result. */
  offline: boolean;
  /** Refresh every card now (the Preview button, Reconnect). */
  refresh: () => void;
}

/** Keeps every card's preview in step with the builder's cards: an edit
 *  refreshes that card and every card after it, `PREVIEW_DEBOUNCE_MS` after
 *  typing stops when auto preview is on. A new refresh stops the one still
 *  running, and only the latest refresh's results are shown. `execute`
 *  should be stable (`useCallback`); a new one is used from the next
 *  refresh on. */
export function usePreviewScheduler<T, F, C extends ChunkBase>({
  conn_id,
  items,
  auto,
  firstChanged,
  targetsOf,
  liveIds,
  emptyChunk,
  execute,
}: {
  conn_id: string;
  items: T;
  auto: boolean;
  /** Where `next` first differs from `prev`: null for everything,
   *  undefined when nothing changed. */
  firstChanged: (prev: T, next: T) => F | null | undefined;
  /** The cards a refresh from `from` (null for all) previews. */
  targetsOf: (items: T, from: F | null) => Set<string>;
  /** Every card id, so a removed card's preview is dropped. */
  liveIds: (items: T) => Iterable<string>;
  emptyChunk: (id: string, error: string) => C;
  execute: (call: RefreshCall<T, F, C>) => Promise<unknown>;
}): PreviewScheduler<C> {
  const conn = useStudioStore((s) => s.open.find((c) => c.id === conn_id));
  const [cards, setCards] = useState<Record<string, CardPreview<C>>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [lost, setLost] = useState(false);

  const run_id = useRef<string | null>(null);
  const previewed = useRef<T | null>(null);
  const can_cancel = canCancelRun(conn?.kind);

  const start = useCallback(
    (from: F | null, target: T) => {
      const previous = run_id.current;
      if (previous && can_cancel) void cancelRun(conn_id, previous);
      const id = crypto.randomUUID();
      run_id.current = id;
      previewed.current = target;

      const targets = targetsOf(target, from);
      const live = new Set(liveIds(target));
      setCards((cur) => {
        const next: Record<string, CardPreview<C>> = {};
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
      void execute({
        items: target,
        from,
        targets,
        run_id: can_cancel ? id : null,
        current: () => run_id.current === id,
        onChunk: (card, chunk) => {
          if (run_id.current !== id) return;
          if (isConnectionLost(chunk.error)) {
            unreachable = true;
            return;
          }
          setCards((cur) => ({
            ...cur,
            [card]: { status: chunk.error ? "error" : "ready", chunk },
          }));
        },
      })
        .then(() => {
          if (run_id.current !== id) return;
          if (unreachable) go_offline();
          else setLost(false);
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
              next[k] = { status: "error", chunk: emptyChunk(k, message) };
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
    [conn_id, can_cancel, execute, targetsOf, liveIds, emptyChunk],
  );

  // A connection that comes back previews every card again.
  const had_conn = useRef(!!conn);
  useEffect(() => {
    if (conn && !had_conn.current) previewed.current = null;
    had_conn.current = !!conn;
  }, [conn]);

  useEffect(() => {
    if (!auto || !conn) return;
    const prev = previewed.current;
    const from = prev === null ? null : firstChanged(prev, items);
    if (from === undefined) return;
    const timer = setTimeout(
      () => start(from, items),
      prev === null ? 0 : PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [items, auto, conn, start, firstChanged]);

  // Stop whatever is still running when the tab goes away.
  useEffect(
    () => () => {
      const id = run_id.current;
      run_id.current = null;
      if (id && can_cancel) void cancelRun(conn_id, id);
    },
    [conn_id, can_cancel],
  );

  const refresh = useCallback(() => start(null, items), [start, items]);

  const offline = lost || !conn;
  useEffect(() => {
    if (!lost || !conn || refreshing) return;
    const timer = setTimeout(refresh, RETRY_MS);
    return () => clearTimeout(timer);
  }, [lost, conn, refreshing, refresh]);

  return { cards, refreshing, offline, refresh };
}
