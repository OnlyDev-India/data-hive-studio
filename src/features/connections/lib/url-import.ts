import type { SavedDbKind } from "@/shared/api";
import type { MongoFormValues, PgFormValues } from "./form-values";

export type UrlImportResult<T> =
  { ok: true; patch: Partial<T> } | { ok: false; message: string };

const UNPARSEABLE = "Could not parse that connection URL.";

const SCHEME_KIND: Record<string, { kind: SavedDbKind; label: string }> = {
  "postgres:": { kind: "postgres", label: "PostgreSQL" },
  "postgresql:": { kind: "postgres", label: "PostgreSQL" },
  "mongodb:": { kind: "mongodb", label: "MongoDB" },
  "mongodb+srv:": { kind: "mongodb", label: "MongoDB" },
};

function accepts(kind: SavedDbKind, protocol: string): boolean {
  if (kind === "postgres")
    return protocol === "postgres:" || protocol === "postgresql:";
  if (kind === "mongodb")
    return protocol === "mongodb:" || protocol === "mongodb+srv:";
  if (kind === "documentdb") return protocol === "mongodb:";
  return false;
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

export function parseConnectionUrl(
  kind: "postgres",
  raw: string,
): UrlImportResult<PgFormValues>;
export function parseConnectionUrl(
  kind: "mongodb" | "documentdb",
  raw: string,
): UrlImportResult<MongoFormValues>;
export function parseConnectionUrl(
  kind: SavedDbKind,
  raw: string,
): UrlImportResult<PgFormValues> | UrlImportResult<MongoFormValues> {
  const u = parse(raw);
  if (!u) return { ok: false, message: UNPARSEABLE };
  if (!accepts(kind, u.protocol)) {
    const owner = SCHEME_KIND[u.protocol];
    if (owner && owner.kind !== kind) {
      return {
        ok: false,
        message: `This is a ${owner.label} URL. Go back and pick ${owner.label}.`,
      };
    }
    return { ok: false, message: UNPARSEABLE };
  }

  const q = u.searchParams;
  const set = <T>(patch: Partial<T>, key: keyof T, v: string | null) => {
    if (v !== null) patch[key] = v as T[keyof T];
  };
  const common = {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    host: u.hostname,
    database: u.pathname.replace(/^\/+/, ""),
  };

  if (kind === "postgres") {
    const patch: Partial<PgFormValues> = { ...common };
    if (u.port) patch.port = u.port;
    set(patch, "ssl_mode", q.get("sslmode"));
    set(patch, "ssl_ca_file", q.get("sslrootcert"));
    set(patch, "ssl_client_cert_file", q.get("sslcert"));
    set(patch, "ssl_client_key_file", q.get("sslkey"));
    return { ok: true, patch };
  }

  const srv = u.protocol === "mongodb+srv:";
  const patch: Partial<MongoFormValues> = {
    ...common,
    srv,
    tls: q.get("tls") === "true" || srv,
  };
  if (u.port && !srv) patch.port = u.port;
  set(patch, "auth_db", q.get("authSource"));
  set(patch, "ssl_ca_file", q.get("tlsCAFile"));
  set(patch, "ssl_client_cert_file", q.get("tlsCertificateKeyFile"));
  if (q.get("retryWrites") === "false") patch.retry_writes = true;
  set(patch, "replica_set", q.get("replicaSet"));
  return { ok: true, patch };
}
