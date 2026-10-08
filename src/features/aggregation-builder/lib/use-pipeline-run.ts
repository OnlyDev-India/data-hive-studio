import { useCallback } from "react";
import { runPipelineStream, type QueryChunk } from "@/shared/api";
import {
  useBuilderRun,
  type BuilderRun,
} from "@/shared/components/builder-canvas";
import type { AggregationSetup } from "@/shared/store";
import { toSpec } from "./model";

export type PipelineRun = BuilderRun;

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
  const launch = useCallback(
    (run_id: string | null, onChunk: (chunk: QueryChunk) => void) =>
      runPipelineStream(
        conn_id,
        {
          database,
          collection,
          spec: toSpec(setup.stages),
          allow_disk_use: setup.allow_disk_use,
          run_id,
        },
        onChunk,
      ),
    [conn_id, database, collection, setup.stages, setup.allow_disk_use],
  );
  const { run, start, stop } = useBuilderRun(conn_id, launch);
  return { run, start: () => start(), stop };
}
