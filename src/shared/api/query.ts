import { invoke } from "@tauri-apps/api/core";
import { WEB, wcall } from "./web";
import {
  dedupe,
  dispatchDbCall,
  hinted,
  isServerConn,
  profileOf,
  remoteOf,
  serverUnsupported,
  webAuthFor,
} from "./dispatch";
import type { CancelOutcome, DbKind, QueryOp, QueryResult } from "./types";

/** Run arbitrary SQL. Returns rows for SELECT, affected count for DML/DDL.
 * Rejects (throws) when the statement fails.
 *
 * `origin` tags the activity-log entry: "user" for a query the user
 * actually wrote and ran (the SQL editor's own fallback transport — see
 * `runSqlStream`), "app" (the default) for everything else that happens to
 * share this same call — the sidebar's housekeeping queries, the schema
 * designer's "create table" apply, etc.
 *
 * `schema` (Postgres only, ignored elsewhere): resolves every unqualified
 * name in `sql` through that schema instead of the connection's own
 * default — see `DbAdapter::run_sql`'s doc comment for the mechanism
 * (a transaction-local `search_path`, not a rewrite of `sql` itself). */
export async function runSql(
  connId: string,
  sql: string,
  origin: "user" | "app" = "app",
  database?: string,
  schema?: string,
): Promise<QueryResult> {
  return dispatchDbCall<QueryResult>(connId, {
    httpMethod: "POST",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/sql`,
    httpBody: { sql, database: database ?? null, schema: schema ?? null },
    serverCmd: "server_run_sql",
    localCmd: "run_sql",
    args: {
      connId,
      database: database ?? null,
      schema: schema ?? null,
      sql,
      origin,
    },
  });
}

/** Engines whose runs the backend can stop so far (spec 0006). */
const CANCELLABLE_KINDS: ReadonlySet<DbKind> = new Set([
  "sqlite",
  "postgres",
  "mongodb",
]);

/** Whether the SQL editor can offer Stop for a run on this connection. Grows
 *  engine by engine (spec 0006): team server and web connections have no
 *  cancel route yet, so only local desktop connections qualify. */
export function canCancelRun(
  connId: string,
  kind: DbKind | undefined,
): boolean {
  return (
    !WEB &&
    !isServerConn(connId) &&
    kind !== undefined &&
    CANCELLABLE_KINDS.has(kind)
  );
}

/** Stop the editor run `runId` (the id passed to `runSqlStream`). Resolves
 *  once the database confirms, or after 3 seconds with `winding_down`.
 *  Cancelling a finished or unknown run resolves `not_running`, never throws. */
export async function cancelRun(
  connId: string,
  runId: string,
): Promise<CancelOutcome> {
  serverUnsupported(connId);
  return invoke<CancelOutcome>("cancel_run", { connId, runId });
}

/** Execute a single DML/DDL statement with bound `?` parameters.
 *  `database`: omitted = this connection's own primary database. */
export async function executeParams(
  connId: string,
  sql: string,
  params: (string | null)[],
  database?: string,
): Promise<number> {
  serverUnsupported(connId);

  return hinted(
    connId,
    invoke("execute_params", { connId, database, sql, params }),
  );
}

/** Run a SELECT with bound `?` parameters (used by UI-built filters).
 *  `database`: omitted = this connection's own primary database. */
export async function runSqlParams(
  connId: string,
  sql: string,
  params: (string | null)[],
  database?: string,
): Promise<QueryResult> {
  if (WEB && isServerConn(connId)) {
    const { url, token } = webAuthFor(profileOf(connId));
    return wcall(
      "POST",
      `/v1/c/${encodeURIComponent(remoteOf(connId))}/sql`,
      { sql, params, database: database ?? null },
      url,
      token || undefined,
    );
  }
  if (WEB)
    return wcall("POST", `/v1/c/${encodeURIComponent(remoteOf(connId))}/sql`, {
      sql,
      params,
      database: database ?? null,
    });
  return invoke("run_sql_params", { connId, database, sql, params });
}

const READ_KINDS = new Set(["select", "count", "select_distinct"]);

/** Run a structured operation (select/count/insert/update/delete/...). The
 *  connection's backend adapter builds the actual SQL from the details — the
 *  frontend never writes SQL for these operations. Reads return rows; writes
 *  return the affected count.
 *
 *  READ kinds go through the same short-TTL dedupe as introspection reads:
 *  StrictMode's mount→remount fires every effect twice, which used to mean
 *  two identical SELECTs/COUNTs per table open. Writes are NEVER cached.
 *
 *  `database`/`schema` (both omitted = this connection's own primary
 *  database/active schema) target a table pane opened from a database/
 *  schema other than the connection's own — folded into the dedupe key too,
 *  so the same table name in two different databases never shares a cache
 *  entry. */
export function executeOp(
  connId: string,
  op: QueryOp,
  database?: string,
  schema?: string,
): Promise<QueryResult> {
  const kind = (op as { kind?: string }).kind ?? "";
  const run = () =>
    dispatchDbCall<QueryResult>(connId, {
      httpMethod: "POST",
      httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/op`,
      httpBody: { ...op, database: database ?? null, schema: schema ?? null },
      serverCmd: "server_execute_op",
      localCmd: "execute_op",
      args: { connId, database: database ?? null, schema: schema ?? null, op },
    });
  if (!READ_KINDS.has(kind)) {
    return run();
  }
  return dedupe(
    `op:${connId}:${database ?? ""}:${schema ?? ""}:${JSON.stringify(op)}`,
    run,
  );
}
