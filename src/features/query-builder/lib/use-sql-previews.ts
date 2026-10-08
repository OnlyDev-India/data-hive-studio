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
import { firstChanged } from "./model";
import type { Dialect } from "./sql-text";

export type ClausePreview = CardPreview<SqlPreviewChunk>;

export interface SqlPreviews {
  cards: Record<string, ClausePreview>;
  /** The cards as composed now, for errors, Run and Copy. */
  composed: Composed;
  /** The probe's count from the last refresh, at most cap + 1. */
  source_rows: number | null;
  refreshing: boolean;
  offline: boolean;
  refresh: () => void;
}

const liveIds = (clauses: Clause[]) => clauses.map((c) => c.id);

function emptyChunk(clause_id: string, error: string): SqlPreviewChunk {
  return { clause_id, count: 0, columns: [], rows: [], elapsed_ms: 0, error };
}

/** Keeps every card's preview in step with the cards through the shared
 *  scheduler: each refresh composes the cards and runs every card from the
 *  edited one on, read only, on the first `preview_cap` FROM rows. */
export function useSqlPreviews({
  conn_id,
  dialect,
  setup,
}: {
  conn_id: string;
  dialect: Dialect;
  setup: QueryBuilderSetup;
}): SqlPreviews {
  const concurrency = useStudioStore((s) => s.previewConcurrency);
  const [source_rows, setSourceRows] = useState<number | null>(null);
  const { database, schema, preview_cap, preview_time_ms } = setup;

  const composeNow = useCallback(
    (clauses: Clause[]) =>
      compose({ clauses, dialect, schema, cap: preview_cap }),
    [dialect, schema, preview_cap],
  );
  const composed = useMemo(
    () => composeNow(setup.clauses),
    [composeNow, setup.clauses],
  );

  // Only cards that compose get a query; a skipped card or one behind an
  // error is never sent.
  const targetsOf = useCallback(
    (clauses: Clause[], from: string | null) => {
      const ids = composeNow(clauses).targets.map((t) => t.clause_id);
      const at = from === null ? 0 : clauses.findIndex((c) => c.id === from);
      const after = new Set(clauses.slice(Math.max(at, 0)).map((c) => c.id));
      return new Set(ids.filter((id) => after.has(id)));
    },
    [composeNow],
  );

  const execute = useCallback(
    async (call: RefreshCall<Clause[], string, SqlPreviewChunk>) => {
      const c = composeNow(call.items);
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
    items: setup.clauses,
    auto: setup.auto_preview,
    firstChanged,
    targetsOf,
    liveIds,
    emptyChunk,
    execute,
  });

  return { ...scheduler, composed, source_rows };
}
