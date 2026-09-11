import { invoke } from "@tauri-apps/api/core";
import { WEB } from "./web";
import { dedupe, dispatchDbCall, serverUnsupported } from "./dispatch";
import type {
  ActivityEntry,
  CatalogOverview,
  ConnectionInfo,
  RoleDetail,
  SchemaObject,
  SchemaObjectKind,
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

/** An SSH tunnel to reach the database through — mirrors
 *  `ssh_tunnel::SshConfig` on the Rust side. */
export interface SshConnectParams {
  host: string;
  port?: number;
  user: string;
  /** "password" | "key" */
  auth_mode: string;
  password?: string;
  key_file?: string;
  key_passphrase?: string;
  host_key_fingerprint?: string;
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
  ssl_ca_file?: string;
  ssl_client_cert_file?: string;
  ssl_client_key_file?: string;
  /** Max pool connections (default 12 when omitted). */
  pool_max?: number;
  /** Min pool connections kept open (default 1 when omitted). */
  pool_min?: number;
  /** How long to wait for a pooled connection before giving up (default 30s). */
  connect_timeout_secs?: number;
  /** How long a pooled connection can sit idle before being closed (default 15 minutes). */
  idle_timeout_secs?: number;
  /** Max lifetime of a pooled connection regardless of activity (default 30 minutes). */
  max_lifetime_secs?: number;
  ssh?: SshConnectParams;
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
  srv?: boolean;
  tls?: boolean;
  ssl_ca_file?: string;
  ssl_client_cert_file?: string;
  /** Disable retryable writes (`retryWrites=false`) — required for Amazon DocumentDB. */
  retry_writes?: boolean;
  /** Replica set name — required by a real Amazon DocumentDB cluster (typically "rs0"). */
  replica_set?: string;
  /** Max connections per server in the pool (driver default 10). */
  pool_max?: number;
  /** Min connections per server kept open (driver default 0). */
  pool_min?: number;
  /** TCP connect timeout for each connection (driver default 10s). */
  connect_timeout_secs?: number;
  /** How long a pooled connection can sit idle before being closed (driver default: never). */
  idle_timeout_secs?: number;
  /** How long to keep trying to find a usable server before giving up (driver default 30s). */
  server_selection_timeout_secs?: number;
  ssh?: SshConnectParams;
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
  return dispatchDbCall<CatalogOverview>(connId, {
    httpMethod: "GET",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/catalog`,
    serverCmd: "server_catalog_overview",
    localCmd: "catalog_overview",
    args: { connId },
  });
}

/** Databases reachable with this connection's server credentials (Postgres). */
export async function listDatabases(connId: string): Promise<string[]> {
  return dispatchDbCall<string[]>(connId, {
    httpMethod: "GET",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/databases`,
    serverCmd: "server_list_databases",
    localCmd: "list_databases",
    args: { connId },
  });
}

/** Schemas within `database` (omitted = this connection's own database) —
 *  the sidebar catalog tree's per-database schema list. */
export async function listSchemasIn(
  connId: string,
  database?: string,
): Promise<string[]> {
  return dispatchDbCall<string[]>(connId, {
    httpMethod: "POST",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/schemas-in`,
    httpBody: { database: database ?? null },
    serverCmd: "server_list_schemas_in",
    localCmd: "list_schemas_in",
    args: { connId, database: database ?? null },
  });
}

/** Tables/Views/Materialized Views/Procedures/Functions/Sequences/Types in
 *  one schema of `database` (omitted = this connection's own database) —
 *  the sidebar catalog tree's per-schema category rows. */
export async function listSchemaObjects(
  connId: string,
  schema: string,
  kind: SchemaObjectKind,
  database?: string,
): Promise<SchemaObject[]> {
  return dispatchDbCall<SchemaObject[]>(connId, {
    httpMethod: "POST",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/schema-objects`,
    httpBody: { database: database ?? null, schema, kind },
    serverCmd: "server_list_schema_objects",
    localCmd: "list_schema_objects",
    args: { connId, database: database ?? null, schema, kind },
  });
}

/** Server-wide roles (Postgres) — the sidebar catalog tree's "Users &
 *  Privileges" row. */
export async function listRoles(connId: string): Promise<SchemaObject[]> {
  return dispatchDbCall<SchemaObject[]>(connId, {
    httpMethod: "GET",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/roles`,
    serverCmd: "server_list_roles",
    localCmd: "list_roles",
    args: { connId },
  });
}

/** Full attribute set for every role (Postgres) — the Users & Privileges tab. */
export async function listRoleDetails(connId: string): Promise<RoleDetail[]> {
  return dispatchDbCall<RoleDetail[]>(connId, {
    httpMethod: "GET",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/role-details`,
    serverCmd: "server_list_role_details",
    localCmd: "list_role_details",
    args: { connId },
  });
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
  const args = {
    connId,
    collection,
    filter: params?.filter ?? null,
    skip: params?.skip ?? 0,
    limit: params?.limit ?? 50,
  };
  return dispatchDbCall<MongoDocumentsResult>(connId, {
    httpMethod: "POST",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/mongo/documents`,
    httpBody: {
      collection,
      filter: args.filter,
      skip: args.skip,
      limit: args.limit,
    },
    serverCmd: "server_list_documents",
    localCmd: "list_documents",
    args,
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
  const args = {
    connId,
    collection,
    filter: params?.filter ?? null,
    skip: params?.skip ?? 0,
    limit: params?.limit ?? 50,
  };
  return dispatchDbCall<MongoExtDocumentsResult>(connId, {
    httpMethod: "POST",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/mongo/documents/ext`,
    httpBody: {
      collection,
      filter: args.filter,
      skip: args.skip,
      limit: args.limit,
    },
    serverCmd: "server_list_documents_ext",
    localCmd: "list_documents_ext",
    args,
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
  return dispatchDbCall<boolean>(connId, {
    httpMethod: "POST",
    httpPath: (cid) => `/v1/c/${encodeURIComponent(cid)}/mongo/documents/save`,
    httpBody: { collection, id, document_text: documentText },
    serverCmd: "server_save_document",
    localCmd: "save_document",
    args: { connId, collection, id, documentText },
  });
}

/** Insert a new MongoDB document parsed from `documentText` (MQL extended JSON). */
export async function insertDocument(
  connId: string,
  collection: string,
  documentText: string,
): Promise<void> {
  return dispatchDbCall<void>(connId, {
    httpMethod: "POST",
    httpPath: (cid) =>
      `/v1/c/${encodeURIComponent(cid)}/mongo/documents/insert`,
    httpBody: { collection, document_text: documentText },
    serverCmd: "server_insert_document",
    localCmd: "insert_document",
    args: { connId, collection, documentText },
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
  return dispatchDbCall<MongoRunResult>(connId, {
    httpMethod: "POST",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/mongo/run`,
    httpBody: { database, collection, script },
    serverCmd: "server_run_mongo",
    localCmd: "run_mongo",
    args: { connId, database, collection, script },
  });
}

/** Point every unqualified operation at `schema` (Postgres). */
export async function setActiveSchema(
  connId: string,
  schema: string,
): Promise<void> {
  return dispatchDbCall<void>(connId, {
    httpMethod: "PUT",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/active-schema`,
    httpBody: { schema },
    serverCmd: "server_set_active_schema",
    localCmd: "set_active_schema",
    args: { connId, schema },
  });
}

/** Close ONE sibling database's own connection right now (Postgres) — the
 *  sidebar's per-database "Disconnect", distinct from disconnecting the
 *  whole connection. */
export async function disconnectDatabase(
  connId: string,
  database: string,
): Promise<void> {
  return dispatchDbCall<void>(connId, {
    httpMethod: "POST",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/disconnect-database`,
    httpBody: { database },
    serverCmd: "server_disconnect_database",
    localCmd: "disconnect_database",
    args: { connId, database },
  });
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

/** Create a collection in the active database (MongoDB). */
/** `database`: omitted = this connection's own primary database — set to
 *  target a sibling database's catalog tree row (see the sidebar's
 *  multi-database browsing). */
export async function createMongoCollection(
  connId: string,
  name: string,
  database?: string,
): Promise<void> {
  return dispatchDbCall<void>(connId, {
    httpMethod: "POST",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/mongo/collections`,
    httpBody: { name, database: database ?? null },
    serverCmd: "server_create_collection",
    localCmd: "create_mongo_collection",
    args: { connId, database: database ?? null, name },
  });
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

/** Refresh a materialized view (Postgres). `database`/`schema`: omitted =
 *  this connection's own primary database/active schema. */
export async function refreshMatview(
  connId: string,
  name: string,
  database?: string,
  schema?: string,
): Promise<void> {
  serverUnsupported(connId);
  return invoke("refresh_matview", { connId, database, schema, name });
}

/** The schema unqualified operations currently target (Postgres). */
export async function getActiveSchema(connId: string): Promise<string> {
  return dispatchDbCall<string>(connId, {
    httpMethod: "GET",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/active-schema`,
    serverCmd: "server_active_schema",
    localCmd: "active_schema",
    args: { connId },
  });
}

/** Fetch the schema (columns, FKs, indexes) for a table. Concurrent calls
 *  for the same (database, schema, table) share one round trip (StrictMode
 *  / multi-tab effects). Never the SQL/Mongo editor, so the backend always
 *  logs this as an app-initiated activity entry — see
 *  `crate::db::table_schema`. `database`/`schema` (both omitted = this
 *  connection's own primary database/active schema) target a table opened
 *  from a database/schema other than the connection's own — see
 *  `open_object` in the sidebar catalog tree. */
export function tableSchema(
  connId: string,
  table: string,
  database?: string,
  schema?: string,
): Promise<TableSchema> {
  return dedupe(
    `schema:${connId} ${database ?? ""} ${schema ?? ""} ${table}`,
    () =>
      dispatchDbCall<TableSchema>(connId, {
        httpMethod: "GET",
        httpPath: (id) => {
          const query = new URLSearchParams();
          if (database) query.set("database", database);
          if (schema) query.set("schema", schema);
          const qs = query.toString();
          return `/v1/c/${encodeURIComponent(id)}/schema/${encodeURIComponent(table)}${qs ? `?${qs}` : ""}`;
        },
        serverCmd: "server_table_schema",
        localCmd: "table_schema",
        args: {
          connId,
          database: database ?? null,
          schema: schema ?? null,
          table,
        },
      }),
  );
}

/** Newest-first snapshot of executed backend commands (panel hydration). */
export async function getActivity(limit = 200): Promise<ActivityEntry[]> {
  if (WEB) return [];
  return invoke("get_activity", { limit });
}

/** Wipe the backend activity log. Pass `connKey` (preferred — a stable
 *  identity, matches entries across reconnects) or `connId` (the running
 *  session's id, for entries logged before `conn_key` existed) to scope the
 *  clear to one connection's history instead of wiping every connection's. */
export async function clearActivity(
  connKey?: string,
  connId?: string,
): Promise<void> {
  if (WEB) return;
  return invoke("clear_activity", { connKey, connId });
}

/** Apply staged schema (DDL) ops in order; returns every statement that ran
 * (for display/copy). Throws on the first failing op. `database`/`schema`:
 * omitted = this connection's own primary database/active schema. */
export async function applySchemaOps(
  connId: string,
  ops: SchemaOp[],
  database?: string,
  schema?: string,
): Promise<string[]> {
  return dispatchDbCall<string[]>(connId, {
    httpMethod: "POST",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/schema-ops`,
    httpBody: { ops, database: database ?? null, schema: schema ?? null },
    serverCmd: "server_apply_schema_ops_batch",
    localCmd: "apply_schema_ops",
    args: { connId, database: database ?? null, schema: schema ?? null, ops },
  });
}

/** Serialize the database back to bytes for save. */
export async function saveDatabase(connId: string): Promise<number[]> {
  serverUnsupported(connId);

  return invoke("save_database", { connId });
}

/** Duplicate a table/collection under a new name, including structure and
 *  indexes. `copyData` controls whether the data comes along too — honored
 *  by MongoDB (the sidebar's "Duplicate collection" checkbox); SQL adapters
 *  always copy everything regardless, for now. Returns the statements that
 *  ran. `database`/`schema`: omitted = this connection's own primary
 *  database/active schema. */
export async function duplicateTable(
  connId: string,
  source: string,
  target: string,
  copyData = true,
  database?: string,
  schema?: string,
): Promise<string[]> {
  return dispatchDbCall<string[]>(connId, {
    httpMethod: "POST",
    httpPath: (id) => `/v1/c/${encodeURIComponent(id)}/duplicate`,
    httpBody: {
      source,
      target,
      copy_data: copyData,
      database: database ?? null,
      schema: schema ?? null,
    },
    serverCmd: "server_duplicate_table",
    localCmd: "duplicate_table",
    args: {
      connId,
      database: database ?? null,
      schema: schema ?? null,
      source,
      target,
      copyData,
    },
  });
}

/** Read a file from disk as raw bytes (opened via the native dialog). */
export async function readFile(path: string): Promise<number[]> {
  return invoke("read_file", { path });
}

/** Write raw bytes to a file (chosen via the native save dialog). */
export async function writeFile(path: string, bytes: number[]): Promise<void> {
  return invoke("write_file", { path, bytes });
}
