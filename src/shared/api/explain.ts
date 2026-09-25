import { WEB } from "./web";
import { dispatchDbCall } from "./dispatch";
import type { DbKind, PlanResult } from "./types";

/** Engines whose plans Explain can show. */
const EXPLAIN_KINDS: ReadonlySet<DbKind> = new Set([
  "sqlite",
  "postgres",
  "mongodb",
]);

/** Whether the SQL editor can offer Explain for a connection of this kind.
 *  The web build reaches it through the server's explain routes. */
export function canExplain(kind: DbKind | undefined): boolean {
  return kind !== undefined && EXPLAIN_KINDS.has(kind);
}

/** What the Plan tab says when the server answers 404 or 405 for an explain
 *  route: an older server that predates them. */
export const OLD_SERVER_MESSAGE =
  "This team server does not support Explain yet.";

/** A server without the explain routes answers with a bare 404 (or 405), which
 *  `wcall` turns into an error starting with the status. A 404 for a lost
 *  connection never gets here: `wcall` reopens it and retries. */
function forOldServers<T>(call: Promise<T>): Promise<T> {
  if (!WEB) return call;
  return call.catch((e: unknown) => {
    if (
      /^(HTTP )?(404|405)\b/.test(String(e instanceof Error ? e.message : e))
    ) {
      throw new Error(OLD_SERVER_MESSAGE);
    }
    throw e;
  });
}

/** Ask the database for the plan of `sql`. Explain never runs the statement;
 *  `analyze` does run it for real timings (on PostgreSQL inside a transaction
 *  that is always rolled back). A database error and a statement Explain does
 *  not accept come back inside the result (for the Plan tab to show); a
 *  rejection means the call itself failed.
 *
 *  `database`/`schema` as in `runSql`. `runId` makes the call stoppable
 *  through `cancelRun`; a stopped call resolves with `cancelled: true`.
 */
export function explainSql(
  connId: string,
  sql: string,
  database?: string,
  schema?: string,
  analyze = false,
  runId?: string,
): Promise<PlanResult> {
  return forOldServers(
    dispatchDbCall<PlanResult>(connId, {
      httpMethod: "POST",
      httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/explain`,
      httpBody: {
        sql,
        analyze,
        database: database ?? null,
        schema: schema ?? null,
        run_id: runId ?? null,
      },
      localCmd: "explain_sql",
      args: {
        connId,
        database: database ?? null,
        schema: schema ?? null,
        sql,
        analyze,
        runId: runId ?? null,
      },
    }),
  );
}

/** The plan of one MongoDB console command (find, aggregate, count or
 *  distinct). `database` and `collection` are the console's current ones, as
 *  in `runMongo`. Results and `runId` work as in `explainSql`. */
export function explainMongo(
  connId: string,
  database: string,
  collection: string | null,
  script: string,
  analyze = false,
  runId?: string,
): Promise<PlanResult> {
  return forOldServers(
    dispatchDbCall<PlanResult>(connId, {
      httpMethod: "POST",
      httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/mongo/explain`,
      httpBody: {
        database,
        collection,
        script,
        analyze,
        run_id: runId ?? null,
      },
      localCmd: "explain_mongo",
      args: {
        connId,
        database,
        collection,
        script,
        analyze,
        runId: runId ?? null,
      },
    }),
  );
}

/** Whether the editor can offer Explain Analyze: PostgreSQL and MongoDB
 *  (SQLite has no timings to give). */
export function canExplainAnalyze(kind: DbKind | undefined): boolean {
  return canExplain(kind) && (kind === "postgres" || kind === "mongodb");
}
