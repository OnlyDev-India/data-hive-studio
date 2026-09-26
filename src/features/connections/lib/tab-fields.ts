import {
  DOCUMENTDB_DEFAULTS,
  MONGO_DEFAULTS,
  PG_DEFAULTS,
  SSH_DEFAULTS,
} from "./defaults";
import { EMPTY_GUARD_FORM, type GuardFormValues } from "./guard-form";
import type {
  MongoFormValues,
  PgFormValues,
  SqliteFormValues,
  SshFormValue,
} from "./form-values";

export type FormTabKey = "connection" | "safety" | "ssl" | "ssh" | "advanced";

export type FormDraft =
  | { kind: "postgres"; values: PgFormValues }
  | { kind: "mongodb" | "documentdb"; values: MongoFormValues }
  | { kind: "sqlite"; values: SqliteFormValues };

const SERVER_TABS: { key: FormTabKey; label: string }[] = [
  { key: "connection", label: "Connection" },
  { key: "safety", label: "Safety" },
  { key: "ssl", label: "TLS/SSL" },
  { key: "ssh", label: "SSH Tunnel" },
  { key: "advanced", label: "Advanced" },
];

const SQLITE_TABS = SERVER_TABS.slice(0, 2);

export function tabsFor(kind: FormDraft["kind"]) {
  return kind === "sqlite" ? SQLITE_TABS : SERVER_TABS;
}

const GUARD_KEYS = Object.keys(EMPTY_GUARD_FORM) as (keyof GuardFormValues)[];
const SSH_KEYS = Object.keys(SSH_DEFAULTS) as (keyof SshFormValue)[];

const PG_TAB_FIELDS: Partial<Record<FormTabKey, (keyof PgFormValues)[]>> = {
  safety: GUARD_KEYS,
  ssl: [
    "ssl_mode",
    "ssl_ca_file",
    "ssl_client_cert_file",
    "ssl_client_key_file",
  ],
  ssh: SSH_KEYS,
  advanced: [
    "pool_max",
    "pool_min",
    "connect_timeout_secs",
    "idle_timeout_secs",
    "max_lifetime_secs",
  ],
};

const MONGO_ADVANCED: (keyof MongoFormValues)[] = [
  "pool_max",
  "pool_min",
  "connect_timeout_secs",
  "idle_timeout_secs",
  "server_selection_timeout_secs",
  "retry_writes",
];

const MONGO_TAB_FIELDS: Partial<Record<FormTabKey, (keyof MongoFormValues)[]>> =
  {
    safety: GUARD_KEYS,
    ssl: ["tls", "ssl_ca_file", "ssl_client_cert_file"],
    ssh: SSH_KEYS,
    // DocumentDB shows Replica set on the Connection tab instead.
    advanced: [...MONGO_ADVANCED, "replica_set"],
  };

const DOCUMENTDB_TAB_FIELDS: typeof MONGO_TAB_FIELDS = {
  ...MONGO_TAB_FIELDS,
  advanced: MONGO_ADVANCED,
};

function differs<T extends object>(values: T, defaults: T, keys: (keyof T)[]) {
  return keys.some((k) => values[k] !== defaults[k]);
}

export function tabChanged(draft: FormDraft, tab: FormTabKey): boolean {
  if (tab === "connection") return false;
  switch (draft.kind) {
    case "postgres": {
      const keys = PG_TAB_FIELDS[tab];
      return !!keys && differs(draft.values, PG_DEFAULTS, keys);
    }
    case "mongodb": {
      const keys = MONGO_TAB_FIELDS[tab];
      return !!keys && differs(draft.values, MONGO_DEFAULTS, keys);
    }
    case "documentdb": {
      const keys = DOCUMENTDB_TAB_FIELDS[tab];
      return !!keys && differs(draft.values, DOCUMENTDB_DEFAULTS, keys);
    }
    case "sqlite":
      return (
        tab === "safety" &&
        differs(draft.values.guard, EMPTY_GUARD_FORM, GUARD_KEYS)
      );
  }
}
