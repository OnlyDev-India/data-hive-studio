import { useCallback, useEffect, useState } from "react";
import {
  composePipeline,
  previewPipeline,
  type ComposedPipeline,
  type PreviewChunk,
} from "@/shared/api";
import {
  PREVIEW_SHOW,
  usePreviewScheduler,
  type CardPreview as SharedCardPreview,
  type RefreshCall,
} from "@/shared/components/builder-canvas";
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

export type CardPreview = SharedCardPreview<PreviewChunk>;

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

const liveIds = (stages: AggregationStage[]) =>
  allStages(stages).map((s) => s.id);

/** Keeps every card's preview in step with the pipeline, through the shared
 *  preview scheduler. */
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
  const concurrency = useStudioStore((s) => s.previewConcurrency);
  const [composed, setComposed] = useState<ComposedPipeline | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const stages = setup.stages;

  const execute = useCallback(
    async (call: RefreshCall<AggregationStage[], StageRef, PreviewChunk>) => {
      const summary = await previewPipeline(
        conn_id,
        {
          database,
          collection,
          spec: toSpec(call.items),
          from: call.from,
          cap: setup.preview_cap,
          time_ms: setup.preview_time_ms,
          show: PREVIEW_SHOW,
          concurrency,
          run_id: call.run_id,
        },
        (chunk) => call.onChunk(chunk.stage_id, chunk),
      );
      if (call.current() && summary.source_estimate !== null)
        setEstimate(summary.source_estimate);
    },
    [
      conn_id,
      database,
      collection,
      setup.preview_cap,
      setup.preview_time_ms,
      concurrency,
    ],
  );

  const scheduler = usePreviewScheduler({
    conn_id,
    items: stages,
    auto: setup.auto_preview,
    firstChanged,
    targetsOf: previewTargets,
    liveIds,
    emptyChunk,
    execute,
  });

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

  return { ...scheduler, composed, estimate };
}

function emptyChunk(stage_id: string, error: string): PreviewChunk {
  return {
    stage_id,
    count: 0,
    columns: [],
    rows: [],
    documents: [],
    elapsed_ms: 0,
    error,
  };
}
