import { invoke, Channel } from "@tauri-apps/api/core";
import { WEB, wstream } from "./web";
import { hinted } from "./dispatch";
import type {
  SqlBuilderPreviewRequest,
  SqlPreviewChunk,
  SqlPreviewSummary,
} from "./types";

const enc = encodeURIComponent;

/** Preview query builder cards, read only: each card's result reaches
 *  `onChunk` as it lands. Stop it with `cancelRun(connId, request.run_id)`;
 *  a stopped refresh resolves with `cancelled`. */
export async function previewSqlBuilder(
  connId: string,
  request: SqlBuilderPreviewRequest,
  onChunk: (chunk: SqlPreviewChunk) => void,
): Promise<SqlPreviewSummary> {
  if (WEB) {
    return hinted(
      wstream<SqlPreviewSummary, SqlPreviewChunk>(
        `/v1/c/${enc(connId)}/sql/builder/preview-stream`,
        request,
        onChunk,
      ),
    );
  }
  const channel = new Channel<SqlPreviewChunk>();
  channel.onmessage = onChunk;
  return hinted(
    invoke<SqlPreviewSummary>("sql_builder_preview", {
      connId,
      request,
      channel,
    }),
  );
}
