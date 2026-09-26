import { invoke } from "@tauri-apps/api/core";
import { WEB } from "./web";
import type { SavedConnParams } from "../store/types";

/** A saved local connection's metadata — everything `SavedConnParams` has
 *  except the secrets (DB password, SSH password/key passphrase), which
 *  live in the encrypted secret store (see `src-tauri/src/secret_store`). */
export type LocalConnMeta = Omit<
  SavedConnParams,
  "password" | "ssh_password" | "ssh_key_passphrase" | "name"
> & {
  name: string;
};

/** Payload for creating/editing a saved connection. */
export type LocalConnInput = LocalConnMeta & {
  password?: string;
  ssh_password?: string;
  ssh_key_passphrase?: string;
};

/** List every locally saved connection's metadata (no passwords). No-op in
 *  web mode, where the browser keeps its own (`web-connections.ts`). */
export async function listLocalConnections(): Promise<LocalConnMeta[]> {
  if (WEB) return [];
  return invoke("list_local_connections");
}

export async function saveLocalConnection(
  input: LocalConnInput,
): Promise<LocalConnMeta> {
  return invoke("save_local_connection", { input });
}

export async function updateLocalConnection(
  oldName: string,
  input: LocalConnInput,
): Promise<LocalConnMeta> {
  return invoke("update_local_connection", { oldName, input });
}

export async function deleteLocalConnection(name: string): Promise<void> {
  return invoke("delete_local_connection", { name });
}

/** A saved connection's real secrets — the DB password,
 *  plus SSH password/key-passphrase when it tunnels through SSH. */
export interface LocalConnectionSecret {
  password: string;
  ssh_password?: string | null;
  ssh_key_passphrase?: string | null;
}

/** Fetch a saved connection's real secrets — call this
 *  right before actually opening the connection. */
export async function getLocalConnectionSecret(
  name: string,
): Promise<LocalConnectionSecret> {
  return invoke("get_local_connection_secret", { name });
}

/** One-time import of pre-keychain `localStorage` connections. Safe to call
 *  more than once — entries whose name already exists are skipped. */
export async function migrateLocalConnections(
  entries: LocalConnInput[],
): Promise<number> {
  return invoke("migrate_local_connections", { entries });
}

/** Something the secret store hit while opening: a reset key, Keychain
 *  entries it couldn't carry over, or a file from a newer version. */
export interface SecretStoreNotice {
  kind: "key_reset" | "import_partial" | "newer_version";
  names: string[];
}

/** The store's queued notice, once per launch; `null` after that. */
export async function takeSecretStoreNotice(): Promise<SecretStoreNotice | null> {
  return invoke("take_secret_store_notice");
}
