import { invoke, Channel } from "@tauri-apps/api/core";
import { WEB, wcall, wstream } from "./web";
import { hinted } from "./dispatch";
import type { QueryChunk } from "./streaming";
import type { MongoRunResult } from "./connection";
import type {
  ComposedPipeline,
  ParsedPipeline,
  PipelinePreviewRequest,
  PipelineRunRequest,
  PipelineSpec,
  PreviewChunk,
  PreviewSummary,
  WireFilter,
} from "./types";

const enc = encodeURIComponent;

/** The cards in every text form, with an error per card that does not
 *  compose. Needs no connection. */
export function composePipeline(
  collection: string,
  spec: PipelineSpec,
): Promise<ComposedPipeline> {
  if (WEB)
    return wcall<ComposedPipeline>("POST", "/v1/mongo/pipeline/compose", {
      collection,
      spec,
    });
  return invoke<ComposedPipeline>("mongo_pipeline_compose", {
    collection,
    spec,
  });
}

/** Pipeline text, a shell `aggregate` call or a JSON array, as cards.
 *  Rejects with the parser's message, line and column. Needs no
 *  connection. */
export function parsePipeline(text: string): Promise<ParsedPipeline> {
  if (WEB)
    return wcall<ParsedPipeline>("POST", "/v1/mongo/pipeline/parse", { text });
  return invoke<ParsedPipeline>("mongo_pipeline_parse", { text });
}

/** A stage value in canonical Extended JSON as card body text, the way a
 *  form writes back into its card. */
export function renderStage(op: string, value: unknown): Promise<string> {
  if (WEB)
    return wcall<string>("POST", "/v1/mongo/pipeline/render", { op, value });
  return invoke<string>("mongo_pipeline_render_stage", { op, value });
}

/** A collection grid's filter as a `$match` card body, null with no filter. */
export function filterToMatch(
  filters: WireFilter[],
  customWhere: string | null,
): Promise<string | null> {
  if (WEB)
    return wcall<string | null>("POST", "/v1/mongo/pipeline/filter-match", {
      filters,
      custom_where: customWhere,
    });
  return invoke<string | null>("mongo_filter_to_match", {
    filters,
    customWhere,
  });
}

/** Preview builder cards: each card's result reaches `onChunk` as it lands.
 *  Stop it with `cancelRun(connId, request.run_id)`; a stopped refresh
 *  resolves with `cancelled`. */
export async function previewPipeline(
  connId: string,
  request: PipelinePreviewRequest,
  onChunk: (chunk: PreviewChunk) => void,
): Promise<PreviewSummary> {
  if (WEB) {
    return hinted(
      wstream<PreviewSummary, PreviewChunk>(
        `/v1/c/${enc(connId)}/mongo/pipeline/preview-stream`,
        request,
        onChunk,
      ),
    );
  }
  const channel = new Channel<PreviewChunk>();
  channel.onmessage = onChunk;
  return hinted(
    invoke<PreviewSummary>("mongo_pipeline_preview", {
      connId,
      request,
      channel,
    }),
  );
}

/** Run the whole pipeline, rows and documents streaming to `onChunk` like
 *  `runMongoStream`. Stoppable through `cancelRun`. */
export async function runPipelineStream(
  connId: string,
  request: PipelineRunRequest,
  onChunk: (chunk: QueryChunk) => void,
): Promise<MongoRunResult> {
  if (WEB) {
    return hinted(
      wstream<MongoRunResult>(
        `/v1/c/${enc(connId)}/mongo/pipeline/run-stream`,
        request,
        onChunk,
      ),
    );
  }
  const channel = new Channel<QueryChunk>();
  channel.onmessage = onChunk;
  return hinted(
    invoke<MongoRunResult>("mongo_pipeline_run_stream", {
      connId,
      request,
      channel,
    }),
  );
}
