import { invoke, Channel } from "@tauri-apps/api/core";
import {
  WEB,
  wcall,
  wcallEmpty,
  apiUrl,
  hasWebToken,
  webServerConfig,
  webListServers,
  webAddServer,
  webRemoveServer,
  type WebServerConfig,
} from "./web";
import type {
  ActivityEntry,
  CatalogOverview,
  ConnectionInfo,
  QueryOp,
  QueryResult,
  SchemaOp,
  TableInfo,
  TableSchema,
} from "./types";

/** One streamed batch from a streaming query. The first batch carries the
 *  column names; every batch carries rows. */
export interface QueryChunk {
  columns?: string[];
  rows: (string | null)[][];
}

type ChunkSink = (chunk: QueryChunk) => void;

// ---- Server (team) connections ---------------------------------------------
//
// Server-backed connections use namespaced ids `srv:<profile_id>:<conn_id>`
// so every existing grid/console component keeps its call signatures; the
// client routes those calls to the gateway passthrough commands instead of
// the local backend registry.

/** Build a namespaced connection id for a connection served by a team server. */
export function srvConnId(profileId: string, remoteConnId: string): string {
  return `srv:${profileId}:${remoteConnId}`;
}

/** True when this id addresses a team-server connection rather than a local one. */
export function isServerConn(connId: string): boolean {
  if (!connId.startsWith("srv:")) return false;
  const parts = connId.split(":");
  return parts.length === 3 && parts[1].length > 0 && parts[2].length > 0;
}

/** Remote (server-side) connection id from a namespaced one. */
function remoteOf(connId: string): string {
  return connId.split(":")[2] ?? "";
}

/** Profile id embedded in a namespaced server connection id. */
function profileOf(connId: string): string {
  return connId.split(":")[1] ?? "";
}

/** Resolve the { url, token } for a server profile — used by every WEB-mode
 *  function that needs per-server auth. Falls back to the primary server. */
function webAuthFor(profileId: string): { url: string; token: string } {
  const cfg = webServerConfig(profileId);
  if (cfg) return { url: cfg.url.replace(/\/+$/, ""), token: cfg.token };
  // Legacy single-server fallback.
  return { url: apiUrl(), token: "" };
}

export interface ServerProfileView {
  id: string;
  name: string;
  url: string;
  connected: boolean;
}

export interface ServerMe {
  device_id: string;
  is_admin: boolean;
}

export interface ServerSession {
  profile: { id: string; name: string; url: string };
  me: ServerMe;
  /** Granted connections as seen by the server (remote ids, no prefix),
   *  including THIS device's effective access level. */
  connections: {
    id: string;
    name: string;
    host: string;
    port: number;
    user: string;
    database: string;
    ssl_mode?: string | null;
    created_by: string;
    created_ms: number;
    updated_ms: number;
    data_access: "readonly" | "readwrite";
    can_edit: boolean;
    can_delete: boolean;
  }[];
}

export function serversList(): Promise<ServerProfileView[]> {
  if (WEB) {
    const servers = webListServers();
    // Legacy: single server enrolled under the old key.
    if (servers.length === 0 && hasWebToken()) {
      servers.push({
        id: WEB_PROFILE_ID,
        url: apiUrl() || "(same origin)",
        token: "",
        name: "Team server",
      });
    }
    return Promise.all(
      servers.map(async (s) => {
        try {
          await wcall<ServerMe>(
            "GET",
            "/v1/me",
            undefined,
            s.url,
            s.token || undefined,
          );
          return { id: s.id, name: s.name, url: s.url, connected: true };
        } catch {
          return { id: s.id, name: s.name, url: s.url, connected: false };
        }
      }),
    );
  }
  return invoke("servers_list");
}

export function serversAdd(
  name: string,
  url: string,
  token: string,
  team_name?: string,
): Promise<ServerProfileView> {
  if (WEB) {
    const id = url
      .replace(/^https?:\/\//, "")
      .replace(/[^a-zA-Z0-9]/g, "_")
      .slice(0, 40);
    const cfg: WebServerConfig = {
      id,
      url: url.replace(/\/+$/, ""),
      token,
      name,
      ...(team_name ? { team_name } : {}),
    };
    webAddServer(cfg);
    return Promise.resolve({ id, name, url: cfg.url, connected: true });
  }
  return invoke("servers_add", { name, url, token, teamName: team_name });
}

export function serversRemove(profileId: string): Promise<void> {
  if (WEB) {
    webRemoveServer(profileId);
    return Promise.resolve();
  }
  return invoke("servers_remove", { profileId });
}

/** Synthetic profile id used by the browser build (single server, same origin). */
export const WEB_PROFILE_ID = "web";

export function serversConnect(profileId: string): Promise<ServerSession> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return Promise.all([
      wcall<ServerMe>("GET", "/v1/me", undefined, url, token || undefined),
      wcall<ServerSession["connections"]>(
        "GET",
        "/v1/connections",
        undefined,
        url,
        token || undefined,
      ),
    ])
      .catch((e: unknown) => {
        // Network-level failure (unreachable host, CORS block) — fetch throws a
        // bare TypeError with no context. Give the user the target URL + cause.
        const detail =
          e instanceof TypeError
            ? `cannot reach ${url || "(same origin)"} — check the URL/port, and that this server runs the CURRENT build (older builds lack CORS)`
            : String(e);
        throw new Error(
          `Connect failed for "${profileId.slice(0, 12)}": ${detail}`,
        );
      })
      .then(([me, connections]) => ({
        profile: {
          id: profileId,
          name: webServerConfig(profileId)?.name ?? "Team server",
          url: url || "(same origin)",
        },
        me,
        connections,
      }));
  }
  return invoke("servers_connect", { profileId });
}

export interface ServerConnInput {
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl_mode?: string | null;
}

/** Publish a shared connection to a team server — admin scope only. */
export function serversCreateConnection(
  profileId: string,
  input: ServerConnInput,
): Promise<unknown> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall<unknown>(
      "POST",
      "/v1/connections",
      input,
      url,
      token || undefined,
    );
  }
  return invoke("servers_create_connection", { profileId, input });
}

/** Update an existing shared connection's details (name, host, port, etc.). */
export function serversUpdateConnection(
  profileId: string,
  connId: string,
  input: ServerConnInput,
): Promise<unknown> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall<unknown>(
      "PUT",
      `/v1/connections/${encodeURIComponent(remoteOf(connId))}`,
      input,
      url,
      token || undefined,
    );
  }
  return invoke("servers_update_connection", { profileId, connId, input });
}

/** Delete a shared connection. Allowed for admins and devices holding its
 *  `can_delete` grant. `connId` is the remote (server-side) id. */
export function serversDeleteConnection(
  profileId: string,
  connId: string,
): Promise<void> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcallEmpty(
      "DELETE",
      `/v1/connections/${encodeURIComponent(connId)}`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_delete_connection", { profileId, connId });
}

/** Fetch decrypted connection credentials (host, port, user, password, database)
 *  from the server. Requires can_read grant or admin scope. */
export interface ServerCredentials {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl_mode?: string | null;
}

export function serversFetchCredentials(
  profileId: string,
  connId: string,
): Promise<ServerCredentials> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall<ServerCredentials>(
      "GET",
      `/v1/connections/${encodeURIComponent(remoteOf(connId))}/credentials`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_fetch_credentials", { profileId, connId });
}

export function serversDisconnect(profileId: string): Promise<void> {
  if (WEB) return Promise.resolve();
  return invoke("servers_disconnect", { profileId });
}

/** Release (close) a server-side connection pool. Web clients call this on
 *  page unload so the server frees resources immediately instead of waiting
 *  for the idle timeout. */
export function serversReleaseConnection(
  profileId: string,
  connId: string,
): Promise<void> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcallEmpty(
      "POST",
      `/v1/c/${encodeURIComponent(remoteOf(connId))}/close`,
      undefined,
      url,
      token || undefined,
    );
  }
  return Promise.resolve();
}

// ---- Admin helpers (web-aware) --------------------------------------------

export function serversAdminDevices<T = unknown[]>(
  profileId: string,
): Promise<T> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall(
      "GET",
      "/v1/admin/devices",
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke<T>("servers_admin_devices", { profileId });
}

/** Mint an adm_ (admin) or tem_ (team) bearer token directly. */
export function serversAdminMintToken(
  profileId: string,
  input: {
    kind: "admin" | "team";
    user_name: string;
    team_name?: string;
    grants: {
      conn_id: string;
      can_read: boolean;
      can_update: boolean;
      can_delete: boolean;
    }[];
  },
): Promise<{ token: string }> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall("POST", "/v1/admin/tokens", input, url, token || undefined);
  }
  return invoke<{ token: string }>("servers_admin_mint_token", {
    profileId,
    ...input,
  });
}

export function serversAdminTokensList<T = unknown[]>(
  profileId: string,
): Promise<T> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall("GET", "/v1/admin/tokens", undefined, url, token || undefined);
  }
  return invoke("servers_admin_tokens_list", { profileId });
}

export function serversAdminDeleteToken(
  profileId: string,
  token: string,
): Promise<void> {
  if (WEB) {
    const { url, token: serverToken } = webAuthFor(profileId);
    return wcallEmpty(
      "DELETE",
      `/v1/admin/tokens/${encodeURIComponent(token)}`,
      undefined,
      url,
      serverToken || undefined,
    );
  }
  return invoke("servers_admin_delete_token", { profileId, token });
}

export function serversAdminConnections<T = unknown[]>(
  profileId: string,
): Promise<T> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall(
      "GET",
      "/v1/admin/connections",
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke<T>("servers_admin_connections", { profileId });
}

export function serversAdminRevokeDevice(
  profileId: string,
  deviceId: string,
): Promise<void> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcallEmpty(
      "DELETE",
      `/v1/admin/devices/${encodeURIComponent(deviceId)}`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_admin_revoke_device", { profileId, deviceId });
}

export function serversAdminGrants<T = unknown[]>(
  profileId: string,
  deviceId: string,
): Promise<T> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcall(
      "GET",
      `/v1/admin/grants/${encodeURIComponent(deviceId)}`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_admin_grants", { profileId, deviceId });
}

export function serversAdminSetGrant(
  profileId: string,
  deviceId: string,
  connId: string,
  can_read: boolean,
  can_update: boolean,
  can_delete: boolean,
): Promise<void> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcallEmpty(
      "PUT",
      `/v1/admin/grants/${encodeURIComponent(deviceId)}/${encodeURIComponent(connId)}`,
      { can_read, can_update, can_delete },
      url,
      token || undefined,
    );
  }
  return invoke("servers_admin_set_grant", {
    profileId,
    deviceId,
    connId,
    canRead: can_read,
    canUpdate: can_update,
    canDelete: can_delete,
  });
}

export function serversAdminRevokeGrant(
  profileId: string,
  deviceId: string,
  connId: string,
): Promise<void> {
  if (WEB) {
    const { url, token } = webAuthFor(profileId);
    return wcallEmpty(
      "DELETE",
      `/v1/admin/grants/${encodeURIComponent(deviceId)}/${encodeURIComponent(connId)}`,
      undefined,
      url,
      token || undefined,
    );
  }
  return invoke("servers_admin_revoke_grant", { profileId, deviceId, connId });
}

/** Build an IPC channel that forwards backend chunks to `on_chunk`. */
function makeChannel(on_chunk?: ChunkSink): Channel<QueryChunk> {
  const channel = new Channel<QueryChunk>();
  if (on_chunk) channel.onmessage = on_chunk;
  return channel;
}

/** Open an existing database from raw bytes and register a connection. */
export async function openDatabase(
  name: string,
  bytes: number[],
): Promise<ConnectionInfo> {
  return invoke("open_database", { name, bytes });
}

/** Open an existing database directly from its file path. Changes persist to
 * that file automatically. */
export async function openDatabasePath(path: string): Promise<ConnectionInfo> {
  return invoke("open_database_path", { path });
}

/** Remember the real file a connection should save to (set after the first
 * time a freshly-created database is exported). */
export async function setDatabasePath(
  connId: string,
  path: string,
): Promise<void> {
  return invoke("set_database_path", { connId, path });
}

/** Create a new, empty database and register a connection. */
export async function createDatabase(name: string): Promise<ConnectionInfo> {
  return invoke("create_database", { name });
}

/** Close a connection and clean up its temp file. */
export async function closeConnection(connId: string): Promise<void> {
  if (WEB) return; // server connections are closed by the server's pool
  return invoke("close_connection", { connId });
}

/** List tables and views in the database. */
export interface PgConnectParams {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** disable | prefer | require | verify-ca | verify-full */
  ssl_mode?: string;
}

/** Connect to a PostgreSQL server (adapter installed in the home sidebar). */
export async function connectPostgres(
  params: PgConnectParams,
): Promise<ConnectionInfo> {
  return invoke("connect_postgres", { params });
}

/** Parameters for connecting to a MongoDB server. */
export interface MongoConnectParams {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** Auth source database (defaults to "admin" when omitted). */
  auth_db?: string;
  tls?: boolean;
}

/** Connect to a MongoDB server and register the connection. */
export async function connectMongo(
  params: MongoConnectParams,
): Promise<ConnectionInfo> {
  return invoke("connect_mongodb", { params });
}

/**
 * Collapse near-simultaneous identical READ calls into ONE IPC round trip.
 *
 * Two sources of phantom duplicate commands:
 * 1. React StrictMode mounts→unmounts→remounts components in dev — effects
 *    fire twice, sometimes AFTER the first call already resolved on a fast
 *    local database.
 * 2. Several components (sidebar, panes, SQL console) request the same
 *    table's schema on mount.
 *
 * Entries live for a few hundred milliseconds — long enough to swallow
 * StrictMode/multi-component bursts, far shorter than a human-triggered
 * refetch (e.g. after applying DDL), so results never feel stale. Only wrap
 * idempotent introspection reads — NEVER writes or data queries.
 */
const CACHE_TTL_MS = 300;
const inflight = new Map<string, { p: Promise<unknown>; at: number }>();
function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key);
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) {
    if (import.meta.env.DEV) {
      console.debug(`[dedupe] HIT  ${key}`);
    }
    return hit.p as Promise<T>;
  }
  if (import.meta.env.DEV) {
    console.debug(
      `[dedupe] MISS ${key}`,
      hit ? `(entry expired, age ${now - hit.at}ms)` : "(no entry)",
      new Error("caller").stack?.split("\n")[2]?.trim(),
    );
  }
  const p = run().finally(() => {
    // Keep serving the cached result for the TTL window, then drop it so
    // later refreshes (revision bumps, DDL applies) always hit the backend.
    setTimeout(() => {
      const cur = inflight.get(key);
      if (cur?.p === p) inflight.delete(key);
    }, CACHE_TTL_MS);
  });
  inflight.set(key, { p, at: now });
  return p;
}

export function listTables(connId: string): Promise<TableInfo[]> {
  return dedupe(`tables:${connId}`, () => {
    if (WEB && isServerConn(connId)) {
      const { url, token } = webAuthFor(profileOf(connId));
      return wcall(
        "GET",
        `/v1/c/${encodeURIComponent(remoteOf(connId))}/tables`,
        undefined,
        url,
        token || undefined,
      );
    }
    if (WEB)
      return wcall(
        "GET",
        `/v1/c/${encodeURIComponent(remoteOf(connId))}/tables`,
      );
    if (isServerConn(connId)) return invoke("server_list_tables", { connId });
    return invoke("list_tables", { connId });
  });
}

/** Schemas the user can switch between on this connection (Postgres). */
export async function listSchemas(connId: string): Promise<string[]> {
  if (WEB && isServerConn(connId)) {
    const { url, token } = webAuthFor(profileOf(connId));
    return wcall(
      "GET",
      `/v1/c/${encodeURIComponent(remoteOf(connId))}/schemas`,
      undefined,
      url,
      token || undefined,
    );
  }
  if (WEB)
    return wcall(
      "GET",
      `/v1/c/${encodeURIComponent(remoteOf(connId))}/schemas`,
    );
  if (isServerConn(connId)) return invoke("server_list_schemas", { connId });
  return invoke("list_schemas", { connId });
}

/** Schemas + databases + active schema in ONE catalog round trip — the
 *  sidebar bootstrap. */
export async function catalogOverview(
  connId: string,
): Promise<CatalogOverview> {
  if (isServerConn(connId) || WEB) {
    return { schemas: [], databases: [], active_schema: "public" };
  }
  return invoke("catalog_overview", { connId });
}

/** Databases reachable with this connection's server credentials (Postgres). */
export async function listDatabases(connId: string): Promise<string[]> {
  if (isServerConn(connId) || WEB) return [];
  return invoke("list_databases", { connId });
}

/** Fetch a page of documents from a MongoDB collection. */
export interface ListDocumentsParams {
  filter?: Record<string, unknown>;
  skip?: number;
  limit?: number;
}

export interface MongoDocumentsResult {
  documents: unknown[];
  total: number;
}

export async function listDocuments(
  connId: string,
  collection: string,
  params?: ListDocumentsParams,
): Promise<MongoDocumentsResult> {
  if (isServerConn(connId) || WEB) return { documents: [], total: 0 };
  return invoke("list_documents", {
    connId,
    collection,
    filter: params?.filter ?? null,
    skip: params?.skip ?? 0,
    limit: params?.limit ?? 50,
  });
}

export interface MongoExtDocumentsResult {
  documents: string[];
  total: number;
}

/** Fetch a page of documents rendered as type-aware MQL extended JSON text
 *  (the JSON editor's data source — types like ObjectId/ISODate survive). */
export async function listDocumentsExt(
  connId: string,
  collection: string,
  params?: ListDocumentsParams,
): Promise<MongoExtDocumentsResult> {
  if (isServerConn(connId) || WEB) return { documents: [], total: 0 };
  return invoke("list_documents_ext", {
    connId,
    collection,
    filter: params?.filter ?? null,
    skip: params?.skip ?? 0,
    limit: params?.limit ?? 50,
  });
}

/** Replace a single MongoDB document (matched by ObjectId hex `_id`) with the
 *  document parsed from `documentText` (MQL extended JSON). */
export async function saveDocument(
  connId: string,
  collection: string,
  id: string,
  documentText: string,
): Promise<boolean> {
  if (isServerConn(connId) || WEB) return false;
  return invoke("save_document", {
    connId,
    collection,
    id,
    documentText,
  });
}

/** Insert a new MongoDB document parsed from `documentText` (MQL extended JSON). */
export async function insertDocument(
  connId: string,
  collection: string,
  documentText: string,
): Promise<void> {
  if (isServerConn(connId) || WEB) return;
  return invoke("insert_document", {
    connId,
    collection,
    documentText,
  });
}

export interface MongoRunResult {
  command: string;
  columns: string[];
  rows: (string | null)[][];
  documents: unknown[];
  rows_affected: number;
  is_select: boolean;
  message: string | null;
  error: string | null;
  /** Set by `use <db>` so the console updates its current-database context. */
  switch_db: string | null;
  elapsed_ms: number;
}

/** Run a MongoDB console command (JSON find/aggregate or a shell-subset
 *  statement) against `database`. `collection` is the console's current
 *  collection, used only for bare JSON query/pipeline input. */
export async function runMongo(
  connId: string,
  database: string,
  collection: string | null,
  script: string,
): Promise<MongoRunResult> {
  serverUnsupported(connId);
  return invoke("run_mongo", { connId, database, collection, script });
}

/** Point every unqualified operation at `schema` (Postgres). */
export async function setActiveSchema(
  connId: string,
  schema: string,
): Promise<void> {
  serverUnsupported(connId);
  return invoke("set_active_schema", { connId, schema });
}

/** Team-server connections do not support local-only operations. */
function serverUnsupported(connId: string): void {
  if (isServerConn(connId)) {
    throw new Error(
      "This operation is not available on team-server connections.",
    );
  }
  if (WEB) {
    throw new Error("This operation requires the desktop app.");
  }
}

/** Create a database on the same server (Postgres). */
export async function createPgDatabase(
  connId: string,
  name: string,
): Promise<void> {
  serverUnsupported(connId);
  return invoke("create_pg_database", { connId, name });
}

/** Drop a database on the same server (Postgres). */
export async function dropPgDatabase(
  connId: string,
  name: string,
): Promise<void> {
  serverUnsupported(connId);
  return invoke("drop_pg_database", { connId, name });
}

/** Create a schema in the active catalog (Postgres). */
export async function createPgSchema(
  connId: string,
  name: string,
): Promise<void> {
  serverUnsupported(connId);
  return invoke("create_pg_schema", { connId, name });
}

/** Drop a schema; `cascade` also drops every object inside it (Postgres). */
export async function dropPgSchema(
  connId: string,
  name: string,
  cascade: boolean,
): Promise<void> {
  serverUnsupported(connId);
  return invoke("drop_pg_schema", { connId, name, cascade });
}

/** Refresh a materialized view (Postgres). */
export async function refreshMatview(
  connId: string,
  name: string,
): Promise<void> {
  serverUnsupported(connId);
  return invoke("refresh_matview", { connId, name });
}

/** The schema unqualified operations currently target (Postgres). */
export async function getActiveSchema(connId: string): Promise<string> {
  if (WEB) return "public";
  return invoke("active_schema", { connId });
}

/** Fetch the schema (columns, FKs, indexes) for a table. Concurrent calls
 *  for the same table share one round trip (StrictMode / multi-tab effects). */
export function tableSchema(
  connId: string,
  table: string,
): Promise<TableSchema> {
  return dedupe(`schema:${connId}\u0000${table}`, () => {
    if (WEB && isServerConn(connId)) {
      const { url, token } = webAuthFor(profileOf(connId));
      return wcall(
        "GET",
        `/v1/c/${encodeURIComponent(remoteOf(connId))}/schema/${encodeURIComponent(table)}`,
        undefined,
        url,
        token || undefined,
      );
    }
    if (WEB)
      return wcall(
        "GET",
        `/v1/c/${encodeURIComponent(remoteOf(connId))}/schema/${encodeURIComponent(table)}`,
      );
    if (isServerConn(connId))
      return invoke("server_table_schema", { connId, table });
    return invoke("table_schema", { connId, table });
  });
}

/** Newest-first snapshot of executed backend commands (panel hydration). */
export async function getActivity(limit = 200): Promise<ActivityEntry[]> {
  if (WEB) return [];
  return invoke("get_activity", { limit });
}

/** Wipe the backend activity log. */
export async function clearActivity(): Promise<void> {
  if (WEB) return;
  return invoke("clear_activity");
}

/** Apply staged schema (DDL) ops in order; returns every statement that ran
 * (for display/copy). Throws on the first failing op. */
export async function applySchemaOps(
  connId: string,
  ops: SchemaOp[],
): Promise<string[]> {
  serverUnsupported(connId);

  return invoke("apply_schema_ops", { connId, ops });
}

/** Run arbitrary SQL. Returns rows for SELECT, affected count for DML/DDL.
 * Rejects (throws) when the statement fails. */
export async function runSql(
  connId: string,
  sql: string,
): Promise<QueryResult> {
  if (WEB && isServerConn(connId)) {
    const { url, token } = webAuthFor(profileOf(connId));
    return wcall(
      "POST",
      `/v1/c/${encodeURIComponent(remoteOf(connId))}/sql`,
      { sql },
      url,
      token || undefined,
    );
  }
  if (WEB)
    return wcall("POST", `/v1/c/${encodeURIComponent(remoteOf(connId))}/sql`, {
      sql,
    });
  if (isServerConn(connId))
    return invoke<QueryResult>("server_run_sql", { connId, sql });
  return invoke<QueryResult>("run_sql", { connId, sql });
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
  const run = () => {
    if (WEB && isServerConn(connId)) {
      const { url, token } = webAuthFor(profileOf(connId));
      return wcall<QueryResult>(
        "POST",
        `/v1/c/${encodeURIComponent(remoteOf(connId))}/op`,
        op,
        url,
        token || undefined,
      );
    }
    if (WEB)
      return wcall<QueryResult>(
        "POST",
        `/v1/c/${encodeURIComponent(remoteOf(connId))}/op`,
        op,
      );
    if (isServerConn(connId))
      return invoke<QueryResult>("server_execute_op", { connId, op });
    return invoke<QueryResult>("execute_op", { connId, op });
  };
  if (!READ_KINDS.has(kind)) {
    return run();
  }
  return dedupe(`op:${connId}:${JSON.stringify(op)}`, run);
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

/** Serialize the database back to bytes for save. */
export async function saveDatabase(connId: string): Promise<number[]> {
  serverUnsupported(connId);

  return invoke("save_database", { connId });
}

/** Duplicate a table under a new name, including structure, keys, indexes
 *  and data. Returns the statements that ran. */
export async function duplicateTable(
  connId: string,
  source: string,
  target: string,
): Promise<string[]> {
  serverUnsupported(connId);

  return invoke("duplicate_table", { connId, source, target });
}

/** Read a file from disk as raw bytes (opened via the native dialog). */
export async function readFile(path: string): Promise<number[]> {
  return invoke("read_file", { path });
}

/** Write raw bytes to a file (chosen via the native save dialog). */
export async function writeFile(path: string, bytes: number[]): Promise<void> {
  return invoke("write_file", { path, bytes });
}
