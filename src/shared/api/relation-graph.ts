import { invoke, Channel } from "@tauri-apps/api/core";
import { WEB, wstream } from "./web";
import type { MongoGraphEvent } from "./types";

/** The Mongo relation diagram, sampled collection by collection: `onEvent` gets
 *  `start`, one `collection` per collection as it finishes, then `done`.
 *  `runId` makes it stoppable through `cancelRun`, which keeps what already
 *  arrived. */
export async function mongoGraph(
  connId: string,
  database: string,
  onEvent: (event: MongoGraphEvent) => void,
  runId?: string,
): Promise<void> {
  if (WEB) {
    await wstream<unknown, MongoGraphEvent>(
      `/v1/c/${encodeURIComponent(connId)}/mongo/graph-stream`,
      { database, run_id: runId ?? null },
      onEvent,
    );
    return;
  }
  const channel = new Channel<MongoGraphEvent>();
  channel.onmessage = onEvent;
  await invoke("mongo_graph", { connId, database, runId, channel });
}
