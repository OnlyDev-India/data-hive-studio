import type { SavedConnParams } from "@/shared/store";
import { guardToForm } from "./guard-form";
import { MONGO_DEFAULTS, PG_DEFAULTS } from "./defaults";
import type {
  MongoFormValues,
  PgFormValues,
  SqliteFormValues,
  SshFormValue,
} from "./form-values";

const str = (n: number | undefined | null) => (n != null ? String(n) : "");

function sshFromSaved(p: SavedConnParams): SshFormValue {
  return {
    ssh_host: p.ssh_host ?? "",
    ssh_port: str(p.ssh_port),
    ssh_user: p.ssh_user ?? "",
    ssh_auth_mode: p.ssh_auth_mode ?? "password",
    ssh_password: p.ssh_password ?? "",
    ssh_key_file: p.ssh_key_file ?? "",
    ssh_key_passphrase: p.ssh_key_passphrase ?? "",
    ssh_host_key_fingerprint: p.ssh_host_key_fingerprint ?? "",
  };
}

export function pgFormFromSaved(p: SavedConnParams): PgFormValues {
  return {
    ...PG_DEFAULTS,
    name: p.name ?? "",
    host: p.host,
    port: String(p.port),
    user: p.user,
    password: p.password,
    remember_secret: p.remember_secret ?? false,
    database: p.database,
    ssl_mode: p.ssl_mode ?? PG_DEFAULTS.ssl_mode,
    ssl_ca_file: p.ssl_ca_file ?? "",
    ssl_client_cert_file: p.ssl_client_cert_file ?? "",
    ssl_client_key_file: p.ssl_client_key_file ?? "",
    pool_max: str(p.pool_max),
    pool_min: str(p.pool_min),
    connect_timeout_secs: str(p.connect_timeout_secs),
    idle_timeout_secs: str(p.idle_timeout_secs),
    max_lifetime_secs: str(p.max_lifetime_secs),
    ...guardToForm(p),
    ...sshFromSaved(p),
  };
}

export function mongoFormFromSaved(p: SavedConnParams): MongoFormValues {
  return {
    ...MONGO_DEFAULTS,
    name: p.name ?? "",
    host: p.host,
    port: String(p.port),
    user: p.user,
    password: p.password,
    remember_secret: p.remember_secret ?? false,
    database: p.database,
    auth_db: p.auth_db || "admin",
    srv: p.srv ?? false,
    tls: p.tls ?? false,
    ssl_ca_file: p.ssl_ca_file ?? "",
    ssl_client_cert_file: p.ssl_client_cert_file ?? "",
    // Saved as `false` when disabled, the form's box is the opposite sense.
    retry_writes: p.retry_writes === false,
    replica_set: p.replica_set ?? "",
    pool_max: str(p.pool_max),
    pool_min: str(p.pool_min),
    connect_timeout_secs: str(p.connect_timeout_secs),
    idle_timeout_secs: str(p.idle_timeout_secs),
    server_selection_timeout_secs: str(p.server_selection_timeout_secs),
    ...guardToForm(p),
    ...sshFromSaved(p),
  };
}

export function sqliteFormFromSaved(p: SavedConnParams): SqliteFormValues {
  return {
    path: p.source_path ?? null,
    name: p.name ?? "",
    guard: guardToForm(p),
  };
}
