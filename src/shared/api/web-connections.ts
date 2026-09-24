/**
 * The web page's saved connections (spec 0010). The server keeps none: they
 * live in this browser's `localStorage`, under `dh.web.connections`, as an
 * array of records with the fields below. A password (and an SSH password) is
 * written only for a connection whose `remember_secret` is true, in plain
 * text, and the form says so. When it is false the page asks for the secret
 * at connect time and keeps it in memory only.
 */
import type { SavedConnParams } from "../store/types";

export const WEB_CONNECTIONS_KEY = "dh.web.connections";

/** Keys older builds wrote. They can hold plain passwords, so they are
 *  deleted once, when the page starts. */
const LEGACY_KEYS = ["saved.local", "dh.web.servers", "dh.web.last"];

export interface WebSavedConnection {
  id: string;
  name: string;
  kind: "postgres" | "mongodb";
  host: string;
  port: number;
  user: string;
  database?: string;
  ssl_mode?: string;
  srv?: boolean;
  tls?: boolean;
  auth_db?: string;
  replica_set?: string;
  retry_writes?: boolean;
  /** Password auth only. The secret itself is `ssh_password`. */
  ssh?: { host: string; port: number; user: string };
  read_only?: boolean;
  env_label?: string | null;
  env_color?: string | null;
  confirm_writes?: boolean;
  remember_secret: boolean;
  password?: string;
  ssh_password?: string;
}

function readRaw(): WebSavedConnection[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(WEB_CONNECTIONS_KEY) ?? "[]",
    );
    return Array.isArray(parsed) ? (parsed as WebSavedConnection[]) : [];
  } catch {
    return [];
  }
}

/** The saved connections as the store keeps them, keyed by name. */
export function readWebConnections(): Record<string, SavedConnParams> {
  const out: Record<string, SavedConnParams> = {};
  for (const c of readRaw()) {
    if (!c || typeof c.name !== "string") continue;
    out[c.name] = fromSaved(c);
  }
  return out;
}

/** Save the whole map. Each record keeps the id it already had by name. */
export function writeWebConnections(
  map: Record<string, SavedConnParams>,
): void {
  const ids = new Map(readRaw().map((c) => [c.name, c.id]));
  const rows = Object.entries(map)
    .filter(
      ([, p]) =>
        p.kind === "postgres" ||
        p.kind === "mongodb" ||
        p.kind === "documentdb",
    )
    .map(([name, p]) => toSaved(name, p, ids.get(name) ?? newId()));
  try {
    localStorage.setItem(WEB_CONNECTIONS_KEY, JSON.stringify(rows));
  } catch {
    // storage unavailable: connections stay for this session only
  }
}

/** Delete what older builds left in `localStorage`. */
export function scrubLegacyWebStorage(): void {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch {
    // nothing to scrub
  }
}

/** A recent connection's details with every secret taken out, for the copy
 *  that is written to `localStorage`. */
export function withoutSecrets(params: SavedConnParams): SavedConnParams {
  const rest = { ...params, password: "" };
  delete rest.ssh_password;
  delete rest.ssh_key_passphrase;
  return rest;
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function toSaved(
  name: string,
  p: SavedConnParams,
  id: string,
): WebSavedConnection {
  const remember = p.remember_secret === true;
  const mongo = p.kind !== "postgres";
  const out: WebSavedConnection = {
    id,
    name,
    kind: mongo ? "mongodb" : "postgres",
    host: p.host,
    port: p.port,
    user: p.user,
    remember_secret: remember,
  };
  if (p.database) out.database = p.database;
  if (!mongo && p.ssl_mode) out.ssl_mode = p.ssl_mode;
  if (mongo) {
    if (p.srv) out.srv = true;
    if (p.tls) out.tls = true;
    if (p.auth_db) out.auth_db = p.auth_db;
    if (p.replica_set) out.replica_set = p.replica_set;
    // Amazon DocumentDB is saved as MongoDB with retry writes off.
    if (p.retry_writes || p.kind === "documentdb") out.retry_writes = true;
  }
  if (p.ssh_host) {
    out.ssh = {
      host: p.ssh_host,
      port: p.ssh_port ?? 22,
      user: p.ssh_user ?? "",
    };
  }
  if (p.read_only !== undefined) out.read_only = p.read_only;
  if (p.env_label !== undefined) out.env_label = p.env_label;
  if (p.env_color !== undefined) out.env_color = p.env_color;
  if (p.confirm_writes !== undefined) out.confirm_writes = p.confirm_writes;
  if (remember) {
    if (p.password) out.password = p.password;
    if (p.ssh_password) out.ssh_password = p.ssh_password;
  }
  return out;
}

export function fromSaved(c: WebSavedConnection): SavedConnParams {
  const out: SavedConnParams = {
    name: c.name,
    kind: c.kind,
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password ?? "",
    database: c.database ?? "",
    remember_secret: c.remember_secret === true,
  };
  if (c.ssl_mode) out.ssl_mode = c.ssl_mode;
  if (c.srv !== undefined) out.srv = c.srv;
  if (c.tls !== undefined) out.tls = c.tls;
  if (c.auth_db) out.auth_db = c.auth_db;
  if (c.replica_set) out.replica_set = c.replica_set;
  if (c.retry_writes !== undefined) out.retry_writes = c.retry_writes;
  if (c.ssh) {
    out.ssh_host = c.ssh.host;
    out.ssh_port = c.ssh.port;
    out.ssh_user = c.ssh.user;
    out.ssh_auth_mode = "password";
    if (c.ssh_password) out.ssh_password = c.ssh_password;
  }
  if (c.read_only !== undefined) out.read_only = c.read_only;
  if (c.env_label !== undefined) out.env_label = c.env_label;
  if (c.env_color !== undefined) out.env_color = c.env_color;
  if (c.confirm_writes !== undefined) out.confirm_writes = c.confirm_writes;
  return out;
}
