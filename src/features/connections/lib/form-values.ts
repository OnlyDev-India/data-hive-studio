import type { GuardFormValues } from "./guard-form";

export interface SshFormValue {
  ssh_host: string;
  ssh_port: string;
  ssh_user: string;
  /** "password" | "key". */
  ssh_auth_mode: string;
  ssh_password: string;
  ssh_key_file: string;
  ssh_key_passphrase: string;
  ssh_host_key_fingerprint: string;
}

export interface PgFormValues extends GuardFormValues, SshFormValue {
  name: string;
  host: string;
  port: string;
  user: string;
  password: string;
  remember_secret: boolean;
  database: string;
  ssl_mode: string;
  ssl_ca_file: string;
  ssl_client_cert_file: string;
  ssl_client_key_file: string;
  pool_max: string;
  pool_min: string;
  connect_timeout_secs: string;
  idle_timeout_secs: string;
  max_lifetime_secs: string;
}

export interface MongoFormValues extends GuardFormValues, SshFormValue {
  name: string;
  host: string;
  port: string;
  user: string;
  password: string;
  remember_secret: boolean;
  database: string;
  auth_db: string;
  srv: boolean;
  tls: boolean;
  ssl_ca_file: string;
  ssl_client_cert_file: string;
  /** Checked means retryable writes are disabled. */
  retry_writes: boolean;
  replica_set: string;
  pool_max: string;
  pool_min: string;
  connect_timeout_secs: string;
  idle_timeout_secs: string;
  server_selection_timeout_secs: string;
}

export interface SqliteFormValues {
  path: string | null;
  name: string;
  guard: GuardFormValues;
}
