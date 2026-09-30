import { invoke, Channel } from "@tauri-apps/api/core";
import { WEB, wdownload, webHandle, wstream } from "./web";
import { hinted } from "./dispatch";
import type {
  CompareChunk,
  CompareDataRequest,
  CompareFileKind,
  CompareFileSummary,
  CompareSummary,
} from "./types";

/** The body a server route needs: the right side named by its handle. */
function webRequest(request: CompareDataRequest): CompareDataRequest {
  return {
    ...request,
    right: { ...request.right, conn_id: webHandle(request.right.conn_id) },
  };
}

/** Diff two tables' rows. Differences, progress, and the page full marker
 *  arrive through `onChunk`; the summary resolves at the end. Stop it with
 *  `cancelRun(request.left.conn_id, request.run_id)`: a stopped diff
 *  resolves with status `stopped`, and the rows already sent stay. */
export async function compareData(
  request: CompareDataRequest,
  onChunk: (chunk: CompareChunk) => void,
): Promise<CompareSummary> {
  if (WEB) {
    return hinted(
      wstream<CompareSummary, CompareChunk>(
        `/v1/c/${encodeURIComponent(request.left.conn_id)}/compare/data`,
        webRequest(request),
        onChunk,
      ),
    );
  }
  const channel = new Channel<CompareChunk>();
  channel.onmessage = onChunk;
  return hinted(invoke<CompareSummary>("compare_data", { request, channel }));
}

/** Where a compare file went: a path on desktop, a browser download (by its
 *  file name) on the web. */
export type CompareFileResult =
  | { where: "path"; summary: CompareFileSummary }
  | { where: "download"; name: string };

/** Write every difference, or the data sync script, from a fresh run of
 *  `request`. Desktop writes to `path`; the web downloads the file instead.
 *  Stoppable with `cancelRun` like `compareData`. */
export async function compareDataToFile(
  request: CompareDataRequest,
  kind: CompareFileKind,
  path: string | null,
): Promise<CompareFileResult> {
  if (WEB) {
    const name = await hinted(
      wdownload(
        `/v1/c/${encodeURIComponent(request.left.conn_id)}/compare/file`,
        { ...webRequest(request), kind },
      ),
    );
    return { where: "download", name };
  }
  const summary = await hinted(
    invoke<CompareFileSummary>("compare_data_to_file", {
      request,
      kind,
      path,
    }),
  );
  return { where: "path", summary };
}
