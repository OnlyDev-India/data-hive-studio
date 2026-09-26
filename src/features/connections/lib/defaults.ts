import { EMPTY_GUARD_FORM } from "./guard-form";
import type {
  MongoFormValues,
  PgFormValues,
  SqliteFormValues,
  SshFormValue,
} from "./form-values";

export const SSH_DEFAULTS: SshFormValue = {
  ssh_host: "",
  ssh_port: "",
  ssh_user: "",
  ssh_auth_mode: "password",
  ssh_password: "",
  ssh_key_file: "",
  ssh_key_passphrase: "",
  ssh_host_key_fingerprint: "",
};

export const PG_DEFAULTS: PgFormValues = {
  name: "",
  host: "localhost",
  port: "5432",
  user: "postgres",
  password: "",
  remember_secret: false,
  database: "",
  ssl_mode: "prefer",
  ssl_ca_file: "",
  ssl_client_cert_file: "",
  ssl_client_key_file: "",
  pool_max: "",
  pool_min: "",
  connect_timeout_secs: "",
  idle_timeout_secs: "",
  max_lifetime_secs: "",
  ...EMPTY_GUARD_FORM,
  ...SSH_DEFAULTS,
};

export const MONGO_DEFAULTS: MongoFormValues = {
  name: "",
  host: "localhost",
  port: "27017",
  user: "",
  password: "",
  remember_secret: false,
  database: "",
  auth_db: "admin",
  srv: false,
  tls: false,
  ssl_ca_file: "",
  ssl_client_cert_file: "",
  retry_writes: false,
  replica_set: "",
  pool_max: "",
  pool_min: "",
  connect_timeout_secs: "",
  idle_timeout_secs: "",
  server_selection_timeout_secs: "",
  ...EMPTY_GUARD_FORM,
  ...SSH_DEFAULTS,
};

export const SQLITE_DEFAULTS: SqliteFormValues = {
  path: null,
  name: "",
  guard: EMPTY_GUARD_FORM,
};

/** DocumentDB needs TLS, retryable writes off and a replica set. */
export function withDocumentDbDefaults(m: MongoFormValues): MongoFormValues {
  return {
    ...m,
    port: m.port.trim() || "27017",
    srv: false,
    tls: true,
    retry_writes: true,
    replica_set: m.replica_set.trim() || "rs0",
  };
}

export const DOCUMENTDB_DEFAULTS = withDocumentDbDefaults(MONGO_DEFAULTS);
