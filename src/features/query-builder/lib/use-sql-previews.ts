import { useCallback, useMemo, useState } from "react";
import { previewSqlBuilder, type SqlPreviewChunk } from "@/shared/api";
import {
  usePreviewScheduler,
  type CardPreview,
  type RefreshCall,
} from "@/shared/components/builder-canvas";
import {
  useStudioStore,
  type Clause,
  type QueryBuilderSetup,
} from "@/shared/store";
import { compose, shownCount, type Composed } from "./compose";
import { allCards, currentQuery, firstChanged, previewTargets } from "./model";
import type { Dialect } from "./sql-text";

export type ClausePreview = CardPreview<SqlPreviewChunk>;

export interface SqlPreviews {
  /** Every query's cards; only the current query's are kept fresh. */
  cards: Record<string, ClausePreview>;
  /** The current query as composed now, for errors, Run and Copy. */
  composed: Composed;
  /** Composes any query's cards. */
  composeOf: (clauses: Clause[]) => Composed;
  /** The probe's count from the last refresh, at most cap + 1. */
  source_rows: number | null;
  refreshing: boolean;
  offline: boolean;
  refresh: () => void;
}

/** What the scheduler previews: the current query's cards, plus every
 *  card on the tab so the other queries keep their last previews. */
interface Previewed {
  query: string | null;
  clauses: Clause[];
  live: string[];
}

const liveIds = (p: Previewed) => p.live;

/** A new current query previews from the start. */
const changedIn = (prev: Previewed, next: Previewed) =>
  prev.query !== next.query ? null : firstChanged(prev.clauses, next.clauses);

const NO_CLAUSES: Clause[] = [];

function emptyChunk(clause_id: string, error: string): SqlPreviewChunk {
  return { clause_id, count: 0, columns: [], rows: [], elapsed_ms: 0, error };
}

/** Keeps the current query's previews in step with its cards through the
 *  shared scheduler: each refresh composes the cards and runs every card
 *  from the edited one on in run order, plus the SELECT card, read only,
 *  on the first `preview_cap` FROM rows. */
export function useSqlPreviews({
  conn_id,
  dialect,
  setup,
  outer,
}: {
  conn_id: string;
  dialect: Dialect;
  setup: QueryBuilderSetup;
  /** Chains that read the outer row, which never preview on their own. */
  outer: ReadonlySet<string>;
}): SqlPreviews {
  const concurrency = useStudioStore((s) => s.previewConcurrency);
  const [source_rows, setSourceRows] = useState<number | null>(null);
  const { database, schema, preview_cap, preview_time_ms } = setup;

  const composeNow = useCallback(
    (clauses: Clause[]) =>
      compose({ clauses, dialect, schema, cap: preview_cap, outer }),
    [dialect, schema, preview_cap, outer],
  );
  const current = currentQuery(setup);
  const clauses = current?.clauses ?? NO_CLAUSES;
  const composed = useMemo(() => composeNow(clauses), [composeNow, clauses]);
  const previewed = useMemo<Previewed>(
    () => ({
      query: current?.id ?? null,
      clauses,
      live: setup.queries.flatMap((q) => allCards(q.clauses).map((c) => c.id)),
    }),
    [current?.id, clauses, setup.queries],
  );

  // Only cards that compose get a query; a skipped card or one behind an
  // error is never sent.
  const targetsOf = useCallback(
    (p: Previewed, from: string | null) => {
      const ids = composeNow(p.clauses).targets.map((t) => t.clause_id);
      const wanted = previewTargets(p.clauses, from);
      return new Set(ids.filter((id) => wanted.has(id)));
    },
    [composeNow],
  );

  const execute = useCallback(
    async (call: RefreshCall<Previewed, string, SqlPreviewChunk>) => {
      const c = composeNow(call.items.clauses);
      const targets = c.targets.filter((t) => call.targets.has(t.clause_id));
      const by_id = new Map(targets.map((t) => [t.clause_id, t]));
      const summary = await previewSqlBuilder(
        conn_id,
        {
          database,
          schema,
          targets: targets.map(({ clause_id, sql }) => ({ clause_id, sql })),
          probe_sql: c.probe,
          table: c.table ?? "",
          cap: preview_cap,
          time_ms: preview_time_ms,
          concurrency,
          run_id: call.run_id,
        },
        (chunk) =>
          call.onChunk(chunk.clause_id, {
            ...chunk,
            count: shownCount(chunk.count, by_id.get(chunk.clause_id)),
          }),
      );
      if (call.current() && !summary.cancelled)
        setSourceRows(summary.source_rows);
    },
    [
      conn_id,
      database,
      schema,
      preview_cap,
      preview_time_ms,
      concurrency,
      composeNow,
    ],
  );

  const scheduler = usePreviewScheduler({
    conn_id,
    items: previewed,
    auto: setup.auto_preview,
    firstChanged: changedIn,
    targetsOf,
    liveIds,
    emptyChunk,
    execute,
  });

  return { ...scheduler, composed, composeOf: composeNow, source_rows };
}
