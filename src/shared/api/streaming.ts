import { invoke, Channel } from "@tauri-apps/api/core";
import { WEB, wstream } from "./web";
import { hinted } from "./dispatch";
import { runMongo, type MongoRunResult } from "./connection";
import { executeOp, runSql } from "./query";
import type { QueryOp, QueryResult } from "./types";

/** One streamed batch from a streaming query. The first batch carries the
 *  column names; every batch carries rows. A batch that adds columns (MongoDB)
 *  carries the full list again, which only ever grows at the end. */
export interface QueryChunk {
  columns?: string[];
  rows: (string | null)[][];
  /** The documents behind `rows`, same order and count. Only the Mongo
   *  console sends them. */
  documents?: unknown[];
}

type ChunkSink = (chunk: QueryChunk) => void;

/** What the accumulator hands the UI at most once per animation frame. `rows`
 *  is the SAME append only array every time; only `row_count` says how much
 *  of it is valid, so a frame never copies the rows. `columns` is a new array
 *  whenever the column list grew. */
export interface RowSnapshot {
  columns: string[];
  rows: (string | null)[][];
  row_count: number;
  /** The documents behind `rows`, also append only. Present only for a run
   *  that streamed documents (the Mongo console). */
  documents?: unknown[];
}

export interface RowAccumulator {
  /** Feed one streamed chunk. */
  push: (chunk: QueryChunk) => void;
  /** Whether any chunk has carried columns or rows yet. */
  started: () => boolean;
  /** Stop the pending frame and return the final, rectangular data: every
   *  row padded with empty cells to the final column count. */
  finish: () => RowSnapshot;
}

/** One place that turns streamed chunks into rows for every consumer (the
 *  SQL editor, the Mongo console, the grid, export). Rows only ever append.
 *  A chunk's `columns`, when present, is the full current list and only ever
 *  grows at the end, so rows sent earlier may be shorter than the final list;
 *  `finish` pads them. `onFlush` runs at most once per animation frame. */
export function createRowAccumulator(
  onFlush?: (snapshot: RowSnapshot) => void,
): RowAccumulator {
  let columns: string[] | null = null;
  const rows: (string | null)[][] = [];
  const documents: unknown[] = [];
  let frame = 0;
  const snapshot = (cols: string[]): RowSnapshot => ({
    columns: cols,
    rows,
    row_count: rows.length,
    ...(documents.length > 0 ? { documents } : {}),
  });
  const flush = () => {
    frame = 0;
    if (columns === null) return;
    onFlush?.(snapshot(columns));
  };
  return {
    push(chunk) {
      let changed = false;
      if (chunk.columns) {
        columns = chunk.columns;
        changed = true;
      }
      for (const row of chunk.rows) rows.push(row);
      if (chunk.documents) {
        for (const doc of chunk.documents) documents.push(doc);
      }
      if (chunk.rows.length > 0) changed = true;
      if (changed && onFlush && !frame) {
        frame = requestAnimationFrame(flush);
      }
    },
    started: () => columns !== null || rows.length > 0,
    finish() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      const final = columns ?? [];
      for (const row of rows) {
        while (row.length < final.length) row.push(null);
      }
      return snapshot(final);
    },
  };
}

/** Build an IPC channel that forwards backend chunks to `on_chunk`. */
function makeChannel(on_chunk?: ChunkSink): Channel<QueryChunk> {
  const channel = new Channel<QueryChunk>();
  if (on_chunk) channel.onmessage = on_chunk;
  return channel;
}

/** A server built before the streaming routes answers 404 or 405 for them:
 *  the page then falls back to the plain route, which fills the tab once. */
function isMissingRoute(e: unknown): boolean {
  return /^(HTTP )?(404|405)\b/.test(
    e instanceof Error ? e.message : String(e),
  );
}

const enc = encodeURIComponent;

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

/** Streaming variant of `runMongo`: find, aggregate and bare JSON reads push
 *  rows and their documents to `onChunk` as the cursor yields them, and the
 *  resolved result then carries neither. Every other command resolves inline
 *  with its own rows. `runId` makes the run stoppable through `cancelRun`; a
 *  stopped run resolves with `cancelled: true` and the rows already emitted
 *  stay with the caller. */
export async function runMongoStream(
  connId: string,
  database: string,
  collection: string | null,
  script: string,
  onChunk?: ChunkSink,
  runId?: string,
): Promise<MongoRunResult> {
  if (WEB) {
    try {
      return await hinted(
        wstream<MongoRunResult>(
          `/v1/c/${enc(connId)}/mongo/run-stream`,
          { database, collection, script, run_id: runId ?? null },
          (chunk) => onChunk?.(chunk),
        ),
      );
    } catch (e) {
      if (!isMissingRoute(e)) throw e;
      // An older server: the whole result at once, rows inline.
      return runMongo(connId, database, collection, script, runId);
    }
  }
  return hinted(
    invoke<MongoRunResult>("run_mongo_stream", {
      connId,
      database,
      collection,
      script,
      runId,
      channel: makeChannel(onChunk),
    }),
  );
}

/** Streaming variant of {@link executeOp} for reads: row batches are pushed
 *  to `on_chunk` as they come back so the UI can render early. The resolved
 *  result carries every field EXCEPT rows — assemble those from the chunks.
 *  Writes never emit chunks and resolve like executeOp. */
export async function executeOpStream(
  connId: string,
  op: QueryOp,
  onChunk?: ChunkSink,
  database?: string,
  schema?: string,
): Promise<QueryResult> {
  if (WEB) {
    try {
      return await hinted(
        wstream<QueryResult>(
          `/v1/c/${enc(connId)}/op-stream`,
          { ...op, database: database ?? null, schema: schema ?? null },
          (chunk) => onChunk?.(chunk),
        ),
      );
    } catch (e) {
      if (!isMissingRoute(e)) throw e;
      // An older server: fetch the whole result and emit it once.
      const res = await executeOp(connId, op, database, schema);
      emitAsChunk(res, onChunk);
      return res;
    }
  }
  return hinted(
    invoke<QueryResult>("execute_op_stream", {
      connId,
      database,
      schema,
      op,
      channel: makeChannel(onChunk),
    }),
  );
}

/** Streaming variant of {@link runSql}: SELECT-shaped statements push row
 *  batches to `onChunk` as they come back. The resolved result carries every
 *  field EXCEPT rows. Other statements run normally and never emit chunks.
 *  `database`: omitted = this connection's own primary database. `schema`:
 *  see {@link runSql}'s own doc comment. `runId`: makes the run stoppable
 *  through `cancelRun`; a stopped run resolves with `cancelled: true` (rows
 *  already emitted stay with the caller). Only desktop local connections
 *  honor it so far — see `canCancelRun`. */
export async function runSqlStream(
  connId: string,
  sql: string,
  onChunk?: ChunkSink,
  database?: string,
  schema?: string,
  runId?: string,
): Promise<QueryResult> {
  if (WEB) {
    try {
      return await hinted(
        wstream<QueryResult>(
          `/v1/c/${enc(connId)}/sql-stream`,
          {
            sql,
            database: database ?? null,
            schema: schema ?? null,
            run_id: runId ?? null,
          },
          (chunk) => onChunk?.(chunk),
        ),
      );
    } catch (e) {
      if (!isMissingRoute(e)) throw e;
      // Still the editor's own "Run", on an older server: one whole result.
      const res = await runSql(connId, sql, "user", database, schema);
      emitAsChunk(res, onChunk);
      return res;
    }
  }
  return hinted(
    invoke<QueryResult>("run_sql_stream", {
      connId,
      database,
      schema,
      sql,
      runId,
      channel: makeChannel(onChunk),
    }),
  );
}
