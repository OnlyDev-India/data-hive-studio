import { invoke } from "@tauri-apps/api/core";
import { WEB, wcall } from "./web";
import {
  dedupe,
  dispatchDbCall,
  isServerConn,
  profileOf,
  remoteOf,
  serverUnsupported,
  webAuthFor,
} from "./dispatch";
import type { QueryOp, QueryResult } from "./types";

/** Run arbitrary SQL. Returns rows for SELECT, affected count for DML/DDL.
 * Rejects (throws) when the statement fails. */
export async function runSql(
  connId: string,
  sql: string,
): Promise<QueryResult> {
  return dispatchDbCall<QueryResult>(connId, {
    httpMethod: "POST",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/sql`,
    httpBody: { sql },
    serverCmd: "server_run_sql",
    localCmd: "run_sql",
    args: { connId, sql },
  });
}

/** Execute a single DML/DDL statement with bound `?` parameters. */
export async function executeParams(
  connId: string,
  sql: string,
  params: (string | null)[],
): Promise<number> {
  serverUnsupported(connId);

  return invoke("execute_params", { connId, sql, params });
}

/** Run a SELECT with bound `?` parameters (used by UI-built filters). */
export async function runSqlParams(
  connId: string,
  sql: string,
  params: (string | null)[],
): Promise<QueryResult> {
  if (WEB && isServerConn(connId)) {
    const { url, token } = webAuthFor(profileOf(connId));
    return wcall(
      "POST",
      `/v1/c/${encodeURIComponent(remoteOf(connId))}/sql`,
      { sql, params },
      url,
      token || undefined,
    );
  }
  if (WEB)
    return wcall("POST", `/v1/c/${encodeURIComponent(remoteOf(connId))}/sql`, {
      sql,
      params,
    });
  return invoke("run_sql_params", { connId, sql, params });
}

const READ_KINDS = new Set(["select", "count", "select_distinct"]);

/** Run a structured operation (select/count/insert/update/delete/...). The
 *  connection's backend adapter builds the actual SQL from the details — the
 *  frontend never writes SQL for these operations. Reads return rows; writes
 *  return the affected count.
 *
 *  READ kinds go through the same short-TTL dedupe as introspection reads:
 *  StrictMode's mount→remount fires every effect twice, which used to mean
 *  two identical SELECTs/COUNTs per table open. Writes are NEVER cached. */
export function executeOp(connId: string, op: QueryOp): Promise<QueryResult> {
  const kind = (op as { kind?: string }).kind ?? "";
  const run = () =>
    dispatchDbCall<QueryResult>(connId, {
      httpMethod: "POST",
      httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/op`,
      httpBody: op,
      serverCmd: "server_execute_op",
      localCmd: "execute_op",
      args: { connId, op },
    });
  if (!READ_KINDS.has(kind)) {
    return run();
  }
  return dedupe(`op:${connId}:${JSON.stringify(op)}`, run);
}
