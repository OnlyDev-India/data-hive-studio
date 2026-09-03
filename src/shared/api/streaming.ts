import { invoke, Channel } from "@tauri-apps/api/core";
import { WEB } from "./web";
import { isServerConn } from "./dispatch";
import { executeOp, runSql } from "./query";
import type { QueryOp, QueryResult } from "./types";

/** One streamed batch from a streaming query. The first batch carries the
 *  column names; every batch carries rows. */
export interface QueryChunk {
  columns?: string[];
  rows: (string | null)[][];
}

type ChunkSink = (chunk: QueryChunk) => void;

/** Build an IPC channel that forwards backend chunks to `on_chunk`. */
function makeChannel(on_chunk?: ChunkSink): Channel<QueryChunk> {
  const channel = new Channel<QueryChunk>();
  if (on_chunk) channel.onmessage = on_chunk;
  return channel;
}

/** Deliver a non-streamed result through the chunk sink so callers can use
 *  one code path for both transports. */
function emitAsChunk(res: QueryResult, onChunk?: ChunkSink): void {
  if (!onChunk || !res.columns?.length || !res.rows.length) return;
  onChunk({ columns: [...res.columns], rows: [] });
  for (let i = 0; i < res.rows.length; i += 500) {
    onChunk({
      columns: [...res.columns],
      rows: res.rows.slice(i, i + 500) as (string | null)[][],
    });
  }
}

/** Streaming variant of {@link executeOp} for reads: row batches are pushed
 *  to `on_chunk` as they come back so the UI can render early. The resolved
 *  result carries every field EXCEPT rows — assemble those from the chunks.
 *  Writes never emit chunks and resolve like executeOp. */
export async function executeOpStream(
  connId: string,
  op: QueryOp,
  onChunk?: ChunkSink,
): Promise<QueryResult> {
  if (isServerConn(connId) || WEB) {
    // No channel streaming over HTTP yet — fetch whole result, emit once.
    const res = await executeOp(connId, op);
    emitAsChunk(res, onChunk);
    return res;
  }
  return invoke<QueryResult>("execute_op_stream", {
    connId,
    op,
    channel: makeChannel(onChunk),
  });
}

/** Streaming variant of {@link runSql}: SELECT-shaped statements push row
 *  batches to `onChunk` as they come back. The resolved result carries every
 *  field EXCEPT rows. Other statements run normally and never emit chunks. */
export async function runSqlStream(
  connId: string,
  sql: string,
  onChunk?: ChunkSink,
): Promise<QueryResult> {
  if (isServerConn(connId) || WEB) {
    const res = await runSql(connId, sql);
    emitAsChunk(res, onChunk);
    return res;
  }
  return invoke<QueryResult>("run_sql_stream", {
    connId,
    sql,
    channel: makeChannel(onChunk),
  });
}
