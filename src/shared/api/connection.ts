import { invoke } from "@tauri-apps/api/core";
import { WEB } from "./web";
import {
  dedupe,
  dispatchDbCall,
  isServerConn,
  serverUnsupported,
} from "./dispatch";
import type {
  ActivityEntry,
  CatalogOverview,
  ConnectionInfo,
  SchemaOp,
  TableInfo,
  TableSchema,
} from "./types";

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

export function listTables(connId: string): Promise<TableInfo[]> {
  return dedupe(`tables:${connId}`, () =>
    dispatchDbCall<TableInfo[]>(connId, {
      httpMethod: "GET",
      httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/tables`,
      serverCmd: "server_list_tables",
      localCmd: "list_tables",
      args: { connId },
    }),
  );
}

/** Schemas the user can switch between on this connection (Postgres). */
export async function listSchemas(connId: string): Promise<string[]> {
  return dispatchDbCall<string[]>(connId, {
    httpMethod: "GET",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/schemas`,
    serverCmd: "server_list_schemas",
    localCmd: "list_schemas",
    args: { connId },
  });
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
  return dedupe(`schema:${connId} ${table}`, () =>
    dispatchDbCall<TableSchema>(connId, {
      httpMethod: "GET",
      httpPath: (id) =>
        `/v1/c/${encodeURIComponent(id)}/schema/${encodeURIComponent(table)}`,
      serverCmd: "server_table_schema",
      localCmd: "table_schema",
      args: { connId, table },
    }),
  );
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
