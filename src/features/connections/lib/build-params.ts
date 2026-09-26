import type {
  MongoConnectParams,
  PgConnectParams,
  SavedDbKind,
  SshConnectParams,
} from "@/shared/api";
import type { SavedConnParams } from "@/shared/store";
import { guardFromForm } from "./guard-form";
import type {
  MongoFormValues,
  PgFormValues,
  SqliteFormValues,
  SshFormValue,
} from "./form-values";

/** Blank means the backend default; an explicit "0" is kept. */
export function optionalNumber(s: string): number | undefined {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

export function sshConnectParams(
  form: SshFormValue,
): SshConnectParams | undefined {
  const host = form.ssh_host.trim();
  if (!host) return undefined;
  return {
    host,
    port: Number(form.ssh_port) || 22,
    user: form.ssh_user.trim(),
    auth_mode: form.ssh_auth_mode || "password",
    password: form.ssh_password || undefined,
    key_file: form.ssh_key_file.trim() || undefined,
    key_passphrase: form.ssh_key_passphrase || undefined,
    host_key_fingerprint: form.ssh_host_key_fingerprint.trim() || undefined,
  };
}

export function flatSshFields(form: SshFormValue) {
  const host = form.ssh_host.trim();
  if (!host) {
    return {
      ssh_host: undefined,
      ssh_port: undefined,
      ssh_user: undefined,
      ssh_auth_mode: undefined,
      ssh_key_file: undefined,
      ssh_host_key_fingerprint: undefined,
      ssh_password: undefined,
      ssh_key_passphrase: undefined,
    };
  }
  return {
    ssh_host: host,
    ssh_port: Number(form.ssh_port) || 22,
    ssh_user: form.ssh_user.trim() || undefined,
    ssh_auth_mode: form.ssh_auth_mode || "password",
    ssh_key_file: form.ssh_key_file.trim() || undefined,
    ssh_host_key_fingerprint: form.ssh_host_key_fingerprint.trim() || undefined,
    ssh_password: form.ssh_password || undefined,
    ssh_key_passphrase: form.ssh_key_passphrase || undefined,
  };
}

export function pgConnectParams(pg: PgFormValues): PgConnectParams {
  return {
    host: pg.host.trim() || "localhost",
    port: Number(pg.port) || 5432,
    user: pg.user.trim(),
    password: pg.password,
    database: pg.database.trim() || "postgres",
    ssl_mode: pg.ssl_mode,
    ssl_ca_file: pg.ssl_ca_file.trim() || undefined,
    ssl_client_cert_file: pg.ssl_client_cert_file.trim() || undefined,
    ssl_client_key_file: pg.ssl_client_key_file.trim() || undefined,
    pool_max: optionalNumber(pg.pool_max),
    pool_min: optionalNumber(pg.pool_min),
    connect_timeout_secs: optionalNumber(pg.connect_timeout_secs),
    idle_timeout_secs: optionalNumber(pg.idle_timeout_secs),
    max_lifetime_secs: optionalNumber(pg.max_lifetime_secs),
    ...guardFromForm(pg),
    ssh: sshConnectParams(pg),
  };
}

export function mongoConnectParams(mongo: MongoFormValues): MongoConnectParams {
  return {
    host: mongo.host.trim() || "localhost",
    port: Number(mongo.port) || 27017,
    user: mongo.user.trim(),
    password: mongo.password,
    database: mongo.database.trim(),
    auth_db: mongo.auth_db.trim() || "admin",
    srv: mongo.srv,
    tls: mongo.tls,
    ssl_ca_file: mongo.ssl_ca_file.trim() || undefined,
    ssl_client_cert_file: mongo.ssl_client_cert_file.trim() || undefined,
    retry_writes: mongo.retry_writes ? false : undefined,
    ...guardFromForm(mongo),
    replica_set: mongo.replica_set.trim() || undefined,
    pool_max: optionalNumber(mongo.pool_max),
    pool_min: optionalNumber(mongo.pool_min),
    connect_timeout_secs: optionalNumber(mongo.connect_timeout_secs),
    idle_timeout_secs: optionalNumber(mongo.idle_timeout_secs),
    server_selection_timeout_secs: optionalNumber(
      mongo.server_selection_timeout_secs,
    ),
    // A tunnel can't combine with an SRV seedlist.
    ssh: mongo.srv ? undefined : sshConnectParams(mongo),
  };
}

export function mongoKindOf(kind: SavedDbKind): "mongodb" | "documentdb" {
  return kind === "documentdb" ? "documentdb" : "mongodb";
}

export function pgSavedParams(pg: PgFormValues): SavedConnParams {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping the nested connect payload `ssh` in favor of `flatSshFields` below
  const { ssh: _ssh, ...params } = pgConnectParams(pg);
  return {
    ...params,
    ...flatSshFields(pg),
    remember_secret: pg.remember_secret,
    kind: "postgres",
  };
}

export function mongoSavedParams(
  mongo: MongoFormValues,
  kind: SavedDbKind,
): SavedConnParams {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping the nested connect payload `ssh` in favor of `flatSshFields` below
  const { ssh: _ssh, ...params } = mongoConnectParams(mongo);
  return {
    ...params,
    ...flatSshFields(mongo),
    remember_secret: mongo.remember_secret,
    kind: mongoKindOf(kind),
  };
}

export function sqliteSavedParams(
  sqlite: SqliteFormValues & { path: string },
): SavedConnParams {
  return {
    kind: "sqlite",
    host: "",
    port: 0,
    user: "",
    password: "",
    database: "",
    source_path: sqlite.path,
    ...guardFromForm(sqlite.guard),
  };
}

export function pgDisplayName(pg: PgFormValues): string {
  return (
    pg.name.trim() ||
    pg.database.trim() ||
    `${pg.user.trim()}@${pg.host.trim() || "localhost"}`
  );
}

export function mongoDisplayName(mongo: MongoFormValues): string {
  return (
    mongo.name.trim() ||
    mongo.database.trim() ||
    `${mongo.user.trim()}@${mongo.host.trim() || "localhost"}`
  );
}

export function sqliteDisplayName(sqlite: SqliteFormValues): string {
  return sqlite.name.trim() || (sqlite.path?.split(/[/\\]/).pop() ?? "");
}
