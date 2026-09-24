import { Channel } from "@tauri-apps/api/core";
import { dispatchDbCall } from "./dispatch";
import { WEB } from "./web";
import type {
  ImportCapabilities,
  ImportProgress,
  ImportReport,
  ImportRequest,
} from "./types";

/** Import parsed rows into a table in one transaction (spec 0008).
 *  `database`/`schema`: omitted = this connection's own primary database /
 *  active schema. `onProgress` and a `request.run_id` (for `cancelRun`) work
 *  on the desktop only; over HTTP the call is one request with no progress. */
export async function importRows(
  connId: string,
  request: ImportRequest,
  database?: string,
  schema?: string,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportReport> {
  // A Channel needs the Tauri runtime, so the web build never makes one.
  const channel = WEB ? null : new Channel<ImportProgress>();
  if (channel && onProgress) channel.onmessage = onProgress;
  return dispatchDbCall<ImportReport>(connId, {
    httpMethod: "POST",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/import`,
    httpBody: { request, database: database ?? null, schema: schema ?? null },
    localCmd: "import_rows",
    args: {
      connId,
      database: database ?? null,
      schema: schema ?? null,
      request,
      channel,
    },
  });
}

/** Whether a rollback undoes the whole import on this connection. Always true
 *  for SQL. On Mongo it is true only on a replica set or sharded cluster. */
export async function importCapabilities(
  connId: string,
  database?: string,
): Promise<ImportCapabilities> {
  return dispatchDbCall<ImportCapabilities>(connId, {
    httpMethod: "POST",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/import/capabilities`,
    httpBody: { database: database ?? null },
    localCmd: "import_capabilities",
    args: { connId, database: database ?? null },
  });
}

/** Progress and Cancel exist only where the backend runs in this process. */
export const IMPORT_CANCELLABLE = !WEB;
