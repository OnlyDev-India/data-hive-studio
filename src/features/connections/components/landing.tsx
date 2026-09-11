import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import { cn } from "@/shared/lib/utils";
import {
  closeConnection,
  connectMongo,
  connectPostgres,
  openDatabasePath,
  serversCreateConnection,
  serversUpdateConnection,
  canPublishConnections,
  type ConnectionInfo,
  type SavedDbKind,
  type SharedDbKind,
  type SshConnectParams,
} from "@/shared/api";
import { WEB } from "@/shared/api/web";
import { pickDatabaseFile } from "@/shared/lib/platform";
import { useStudioStore } from "@/shared/store";
import type { LandingEditTarget } from "@/shared/store";

import { EditBanner } from "./edit-banner";
import { FormTabBar, type FormTabKey } from "./form-tabs";
import type { SshFormValue } from "./ssh-fields";

/** Parse an optional numeric form field: blank → `undefined` (use the
 *  backend's default), anything else → the number, including an explicit
 *  "0" — unlike the `Number(x) || undefined` idiom used elsewhere for
 *  required fields, this doesn't collapse a deliberate 0 into "unset". */
function optionalNumber(s: string): number | undefined {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/** Build the nested `ssh: {...}` object `connectPostgres`/`connectMongo`
 *  expect from a form's flat `ssh_*` fields — `undefined` (no tunnel) when
 *  `ssh_host` is blank. */
function build_ssh_connect_params(
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

/** Same source fields, but flattened with an `ssh_` prefix — the shape
 *  `SavedConnParams`/`ServerConnInput` (and their Rust counterparts,
 *  `LocalConnInput`/`ConnInput`) store on disk/in the database, since a
 *  saved record's SSH config lives in its own plain columns rather than a
 *  nested blob. */
function flat_ssh_fields(form: SshFormValue) {
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
import { MongoPanel, type MongoFormValues } from "./mongo-panel";
import { PgPanel, type PgFormValues } from "./pg-panel";
import { SqlitePanel } from "./sqlite-panel";
import { DBIcons, type IconProps } from "@/shared/components/icons/types";

/** SQLite is a local file — only "General" applies, no SSH/SSL sections. */
const SQLITE_TABS: { key: FormTabKey; label: string }[] = [
  { key: "general", label: "General" },
];

// Amazon DocumentDB speaks the MongoDB wire protocol, so a "documentdb"
// connection is opened identically to a "mongodb" one everywhere that
// matters (storage adapter, the Rust `MongoAdapter`, the Mongo form/panel)
// — `kind: "documentdb"` only exists so the picker remembers which entry
// was chosen and applies its connection-string defaults on selection (see
// `change_kind` below).
type DbKindChoice = SavedDbKind;

const DB_KIND_ITEMS: {
  id: DbKindChoice;
  label: string;
  icon: React.ComponentType<IconProps>;
}[] = [
  { id: "sqlite", label: "SQLite", icon: DBIcons.sqlite },
  { id: "postgres", label: "PostgreSQL", icon: DBIcons.postgres },
  { id: "mongodb", label: "MongoDB", icon: DBIcons.mongodb },
  { id: "documentdb", label: "Amazon DocumentDB", icon: DBIcons.documentdb },
];

/** Database-type picker — replaces the old per-type tab strip so every kind
 *  shares one connection form, differing only in which fields it requires.
 *  shadcn's Combobox recipe (Popover + Command/cmdk) rather than a plain
 *  dropdown: search-as-you-type AND full keyboard nav (arrow keys to move,
 *  Enter to select, Escape to close) — a hand-rolled filtered list can't
 *  get keyboard selection without reimplementing cmdk. */
function DbTypeSelect({
  value,
  on_change,
}: {
  value: DbKindChoice;
  on_change: (v: DbKindChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = DB_KIND_ITEMS.find((i) => i.id === value) ?? DB_KIND_ITEMS[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className="flex items-center gap-2">
              <current.icon className="size-4" />
              {current.label}
            </span>
            <ChevronsUpDown className="text-muted-foreground size-3.5" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-(--anchor-width) min-w-56 p-0">
        <Command>
          <CommandInput placeholder="Search database type…" />
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {DB_KIND_ITEMS.map(({ id, label, icon: Icon }) => (
                <CommandItem
                  key={id}
                  value={label}
                  onSelect={() => {
                    on_change(id);
                    setOpen(false);
                  }}
                >
                  <Icon className="size-4" />
                  {label}
                  <Check
                    className={cn(
                      "ml-auto",
                      id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function Landing() {
  const openConn = useStudioStore((s) => s.openConn);

  const [kind, setKind] = useState<DbKindChoice>("sqlite");
  // General/SSH/SSL section tab — shared across whichever form (Postgres or
  // MongoDB) is currently shown; SQLite has no sections, so it's unused
  // there. Lives here (not inside each panel) so the tab bar itself can sit
  // above the card, in the old per-database-type tab strip's spot.
  const [form_tab, setFormTab] = useState<FormTabKey>("general");
  // SQLite only ever offers "General" — fall back to it if SSH/SSL was
  // selected on a different kind and the user then switches to SQLite.
  const change_kind = (v: DbKindChoice) => {
    setKind(v);
    if (v === "sqlite") setFormTab("general");
    // Amazon DocumentDB needs three things a plain Mongo connection
    // doesn't: TLS, retryable writes disabled, and a replica set name —
    // pre-fill them (and default the port) so picking this entry is enough
    // on its own, without also having to know to dig into the SSL tab.
    if (v === "documentdb") {
      setMongo((m) => ({
        ...m,
        port: m.port.trim() || "27017",
        srv: false,
        tls: true,
        retry_writes: true,
        replica_set: m.replica_set.trim() || "rs0",
      }));
    }
  };
  const [opening, setOpening] = useState(false);
  /** Path of a recent SQLite file prefilled into the form (single-click). */
  const [sqlite_path, setSqlitePath] = useState<string | null>(null);

  // Pick a file and open it right away — no second "Open" step.
  const open_file_click = async () => {
    if (opening) return;
    const file = await pickDatabaseFile();
    if (!file) return;
    setOpening(true);
    try {
      const conn = await openDatabasePath(file.path);
      openConn(conn);
    } catch (e) {
      useStudioStore.getState().pushNotification({
        kind: "error",
        title: "Failed to open database",
        detail: String(e),
      });
    } finally {
      setOpening(false);
    }
  };

  // ---- PostgreSQL connect form ----
  const PG_DEFAULTS: PgFormValues = {
    name: "",
    host: "localhost",
    port: "5432",
    user: "postgres",
    password: "",
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
    ssh_host: "",
    ssh_port: "",
    ssh_user: "",
    ssh_auth_mode: "password",
    ssh_password: "",
    ssh_key_file: "",
    ssh_key_passphrase: "",
    ssh_host_key_fingerprint: "",
  };
  const [pg, setPg] = useState<PgFormValues>(PG_DEFAULTS);
  /** GLOBAL connect flag — navigating home mid-connect keeps the spinner
   *  truthful and blocks a second auto-connect from the replayed prefill. */
  const pg_connecting = useStudioStore((st) => st.pgConnecting);
  const setPgConnecting = useStudioStore((st) => st.setPgConnecting);
  const mongo_connecting = useStudioStore((st) => st.mongoConnecting);
  const setMongoConnecting = useStudioStore((st) => st.setMongoConnecting);
  const clearLandingPrefill = useStudioStore((st) => st.clearLandingPrefill);
  const push_recent_params = useStudioStore((st) => st.pushRecentParams);
  const landing_prefill = useStudioStore((st) => st.landingPrefill);
  const [url_text, setUrlText] = useState("");
  const [url_error, setUrlError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Test-connection state: verifies the form without opening a workspace.
  const [testing, setTesting] = useState(false);
  const [test_ok, setTestOk] = useState<boolean | null>(null);
  const [test_error, setTestError] = useState<string | null>(null);

  // ---- MongoDB connect form ----
  const MONGO_DEFAULTS: MongoFormValues = {
    name: "",
    host: "localhost",
    port: "27017",
    user: "",
    password: "",
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
    ssh_host: "",
    ssh_port: "",
    ssh_user: "",
    ssh_auth_mode: "password",
    ssh_password: "",
    ssh_key_file: "",
    ssh_key_passphrase: "",
    ssh_host_key_fingerprint: "",
  };
  const [mongo, setMongo] = useState<MongoFormValues>(MONGO_DEFAULTS);
  const [mongo_testing, setMongoTesting] = useState(false);
  const [mongo_test_ok, setMongoTestOk] = useState<boolean | null>(null);
  const [mongo_test_error, setMongoTestError] = useState<string | null>(null);

  // MongoDB URL import/export
  const [mongo_url_text, setMongoUrlText] = useState("");
  const [mongo_url_error, setMongoUrlError] = useState<string | null>(null);
  const [mongo_copied, setMongoCopied] = useState(false);

  const build_params = () => ({
    host: pg.host.trim() || "localhost",
    port: Number(pg.port) || 5432,
    user: pg.user.trim(),
    password: pg.password,
    // Blank = connect without picking one first (Postgres always has a
    // "postgres" maintenance database) — the sidebar's database switcher
    // lets you browse/pick the real target once connected.
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
    ssh: build_ssh_connect_params(pg),
  });

  const display_name = () =>
    pg.name.trim() ||
    pg.database.trim() ||
    `${pg.user.trim()}@${pg.host.trim() || "localhost"}`;

  // Latest form values, readable from effects without stale-closure races.
  const form_ref = useRef(build_params());
  useEffect(() => {
    form_ref.current = build_params();
  });

  const test_click = async () => {
    if (testing || !pg.database.trim()) return;
    setTesting(true);
    setTestOk(null);
    setTestError(null);
    try {
      const conn = await connectPostgres(build_params());
      await closeConnection(conn.id); // release it — testing only
      setTestOk(true);
    } catch (e) {
      setTestOk(false);
      setTestError(String(e));
      useStudioStore.getState().pushNotification({
        kind: "error",
        title: "Connection test failed",
        detail: String(e),
      });
    } finally {
      setTesting(false);
    }
  };

  const import_url = () => {
    const raw = url_text.trim();
    if (!raw) return;
    try {
      const u = new URL(raw);
      setPg((p) => ({
        ...p,
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        host: u.hostname,
        port: u.port || p.port,
        database: u.pathname.replace(/^\/+/, ""),
        ssl_mode: u.searchParams.get("sslmode") ?? p.ssl_mode,
        ssl_ca_file: u.searchParams.get("sslrootcert") ?? p.ssl_ca_file,
        ssl_client_cert_file:
          u.searchParams.get("sslcert") ?? p.ssl_client_cert_file,
        ssl_client_key_file:
          u.searchParams.get("sslkey") ?? p.ssl_client_key_file,
      }));
      setUrlText("");
      setUrlError(null);
    } catch {
      setUrlError("Could not parse that connection URL.");
    }
  };

  const export_url = async () => {
    const auth = `${encodeURIComponent(pg.user.trim())}:${encodeURIComponent(pg.password)}`;
    const query: string[] = [];
    if (pg.ssl_mode !== "prefer") query.push(`sslmode=${pg.ssl_mode}`);
    if (pg.ssl_ca_file.trim())
      query.push(`sslrootcert=${encodeURIComponent(pg.ssl_ca_file.trim())}`);
    if (pg.ssl_client_cert_file.trim())
      query.push(
        `sslcert=${encodeURIComponent(pg.ssl_client_cert_file.trim())}`,
      );
    if (pg.ssl_client_key_file.trim())
      query.push(`sslkey=${encodeURIComponent(pg.ssl_client_key_file.trim())}`);
    const ssl = query.length > 0 ? `?${query.join("&")}` : "";
    const url = `postgres://${auth}@${pg.host.trim() || "localhost"}:${Number(pg.port) || 5432}/${pg.database.trim()}${ssl}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  const clear_pg_form = () => {
    setPg(PG_DEFAULTS);
    setUrlText("");
    setUrlError(null);
    setTestOk(null);
    setTestError(null);
  };

  // ---- MongoDB URL import/export ----
  const import_mongo_url = () => {
    const raw = mongo_url_text.trim();
    if (!raw) return;
    try {
      const u = new URL(raw);
      // Detect mongodb+srv:// vs mongodb://
      const isSrv = u.protocol === "mongodb+srv:";
      setMongo((m) => ({
        ...m,
        srv: isSrv,
        user: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password),
        host: u.hostname,
        port: u.port && !isSrv ? u.port : m.port,
        database: u.pathname.replace(/^\/+/, ""),
        auth_db: u.searchParams.get("authSource") ?? m.auth_db,
        tls: u.searchParams.get("tls") === "true" || isSrv,
        ssl_ca_file: u.searchParams.get("tlsCAFile") ?? m.ssl_ca_file,
        ssl_client_cert_file:
          u.searchParams.get("tlsCertificateKeyFile") ?? m.ssl_client_cert_file,
        retry_writes:
          u.searchParams.get("retryWrites") === "false" || m.retry_writes,
        replica_set: u.searchParams.get("replicaSet") ?? m.replica_set,
      }));
      setMongoUrlError(null);
      setMongoUrlText("");
    } catch {
      setMongoUrlError("Could not parse that connection URL.");
    }
  };

  const export_mongo_url = async () => {
    const auth = `${encodeURIComponent(mongo.user.trim())}:${encodeURIComponent(mongo.password)}`;
    const query: string[] = [];
    if (mongo.auth_db.trim())
      query.push(`authSource=${encodeURIComponent(mongo.auth_db)}`);
    // mongodb+srv:// gets TLS by default — only a plain mongodb:// URL needs
    // it spelled out.
    if (mongo.tls && !mongo.srv) query.push("tls=true");
    if (mongo.ssl_ca_file.trim())
      query.push(`tlsCAFile=${encodeURIComponent(mongo.ssl_ca_file.trim())}`);
    if (mongo.ssl_client_cert_file.trim())
      query.push(
        `tlsCertificateKeyFile=${encodeURIComponent(mongo.ssl_client_cert_file.trim())}`,
      );
    if (mongo.retry_writes) query.push("retryWrites=false");
    if (mongo.replica_set.trim())
      query.push(`replicaSet=${encodeURIComponent(mongo.replica_set.trim())}`);
    const qs = query.length > 0 ? `?${query.join("&")}` : "";
    // Non-SRV host may be a comma-separated replica-set member list, each
    // optionally carrying its own port — only append the port field to
    // entries that don't already specify one (mirrors build_options in
    // crates/dh-core/src/db/mongodb.rs).
    const hosts = (mongo.host.trim() || "localhost")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean)
      .map((h) => (h.includes(":") ? h : `${h}:${Number(mongo.port) || 27017}`))
      .join(",");
    const url = mongo.srv
      ? `mongodb+srv://${auth}@${mongo.host.trim() || "localhost"}/${mongo.database.trim()}${qs}`
      : `mongodb://${auth}@${hosts}/${mongo.database.trim()}${qs}`;
    try {
      await navigator.clipboard.writeText(url);
      setMongoCopied(true);
      setTimeout(() => setMongoCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  const clear_mongo_form = () => {
    setMongo(MONGO_DEFAULTS);
    setMongoUrlText("");
    setMongoUrlError(null);
    setMongoTestOk(null);
    setMongoTestError(null);
  };

  // Sidebar click hands PG details here; switch to the PG tab + fill. When
  // the request carries connect=true (double-click), chain a connect right
  // after the prefilled fields have committed.
  const last_prefill = useRef(0);
  const want_connect = useRef(false);
  /** Which connect form a pending double-click targets; consumed by the
   *  auto-connect effect once its fields commit. */
  const want_kind = useRef<SharedDbKind | null>(null);

  const pg_connect_click = async () => {
    if (pg_connecting) return;
    setPgConnecting(true);
    try {
      if (WEB) {
        const params = form_ref.current;
        const sessions = useStudioStore.getState().serverSessions;
        let matched: { id: string; name: string } | undefined;
        for (const sess of Object.values(sessions)) {
          for (const c of sess.connections) {
            if (
              c.host === params.host &&
              Number(c.port) === Number(params.port) &&
              c.database === params.database
            ) {
              matched = { id: c.id, name: c.name };
              break;
            }
          }
          if (matched) break;
        }
        if (!matched) {
          useStudioStore.getState().pushNotification({
            kind: "error",
            title: "No matching server connection",
            detail:
              "No matching server connection found for these details. Connect to a team server first.",
          });
          return;
        }
        openConn({
          id: matched.id,
          name: matched.name,
          kind: "postgres",
          source_path: null,
        });
        return;
      }
      const conn: ConnectionInfo = await connectPostgres(form_ref.current);
      push_recent_params(conn.id, {
        ...form_ref.current,
        kind: "postgres",
        name: pg.name.trim() || undefined,
      });
      openConn(conn);
    } catch (e) {
      useStudioStore.getState().pushNotification({
        kind: "error",
        title: "Connection failed",
        detail: String(e),
      });
    } finally {
      setPgConnecting(false);
    }
  };

  const mongo_build_params = () => ({
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
    replica_set: mongo.replica_set.trim() || undefined,
    pool_max: optionalNumber(mongo.pool_max),
    pool_min: optionalNumber(mongo.pool_min),
    connect_timeout_secs: optionalNumber(mongo.connect_timeout_secs),
    idle_timeout_secs: optionalNumber(mongo.idle_timeout_secs),
    server_selection_timeout_secs: optionalNumber(mongo.server_selection_timeout_secs),
    // Rejected server-side too (mixing srv:// with a tunnel makes no sense
    // — SRV resolves to however many hosts the DNS records list), but skip
    // even sending it in that case so the error is unambiguous.
    ssh: mongo.srv ? undefined : build_ssh_connect_params(mongo),
  });

  const mongo_test_click = async () => {
    if (mongo_testing || !mongo.database.trim()) return;
    setMongoTesting(true);
    setMongoTestOk(null);
    setMongoTestError(null);
    try {
      const conn = await connectMongo(mongo_build_params());
      await closeConnection(conn.id);
      setMongoTestOk(true);
    } catch (e) {
      setMongoTestOk(false);
      setMongoTestError(String(e));
      useStudioStore.getState().pushNotification({
        kind: "error",
        title: "MongoDB connection test failed",
        detail: String(e),
      });
    } finally {
      setMongoTesting(false);
    }
  };

  const mongo_connect_click = async () => {
    if (mongo_connecting || !mongo.database.trim()) return;
    setMongoConnecting(true);
    try {
      const conn: ConnectionInfo = await connectMongo(mongo_build_params());
      // Recorded before openConn — its same-connection dedup reads
      // recentParams to recognize "already open" across separate connects.
      push_recent_params(conn.id, {
        ...mongo_build_params(),
        // "documentdb" here is what lets the sidebar's Recent list show the
        // right icon — ConnectionInfo.kind itself is always "mongodb" (see
        // its doc comment), so this recorded copy is the only place that
        // remembers which picker entry was actually used.
        kind: kind === "documentdb" ? "documentdb" : "mongodb",
        name: mongo.name.trim() || undefined,
      });
      openConn(conn);
    } catch (e) {
      useStudioStore.getState().pushNotification({
        kind: "error",
        title: "MongoDB connection failed",
        detail: String(e),
      });
    } finally {
      setMongoConnecting(false);
    }
  };

  // ---- Save connection (local device; Mongo has no team-server sharing) ----
  const serverSessions = useStudioStore((st) => st.serverSessions);
  const saveLocal = useStudioStore((st) => st.saveLocal);
  const updateSavedLocal = useStudioStore((st) => st.updateSavedLocal);
  const pushNotification = useStudioStore((st) => st.pushNotification);
  /** Servers whose active session may publish connections (Member role or
   *  above in that server's org — Viewer cannot). */
  const admin_servers = Object.values(serverSessions).filter((s) =>
    canPublishConnections(s.me, s.profile.org_id),
  );
  const [saving_to, setSavingTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<LandingEditTarget | null>(null);

  /** Full saved record for the PG form — `kind` routes it on reopen.
   *  `build_params()`'s nested `ssh` (the connect-payload shape) gets
   *  swapped for the flat `ssh_*` fields a saved record stores instead. */
  const pg_saved_params = () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping the nested connect-payload `ssh` in favor of `flat_ssh_fields` below
    const { ssh: _ssh, ...params } = build_params();
    return {
      ...params,
      ...flat_ssh_fields(pg),
      kind: "postgres" as const,
    };
  };

  const save_local = () => {
    if (editing?.source === "local") {
      updateSavedLocal(editing.oldName, display_name(), pg_saved_params());
      pushNotification({
        kind: "success",
        title: "Updated saved connection",
        detail: display_name(),
      });
      setEditing(null);
      return;
    }
    saveLocal(display_name(), pg_saved_params());
    pushNotification({
      kind: "success",
      title: "Saved on this device",
      detail: display_name(),
    });
  };

  const mongo_display_name = () =>
    mongo.name.trim() ||
    mongo.database.trim() ||
    `${mongo.user.trim()}@${mongo.host.trim() || "localhost"}`;

  /** Full saved record for the Mongo form — `kind` routes it on reopen.
   *  Same nested-`ssh`-for-flat-fields swap as `pg_saved_params`. */
  const mongo_saved_params = () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropping the nested connect-payload `ssh` in favor of `flat_ssh_fields` below
    const { ssh: _ssh, ...params } = mongo_build_params();
    return {
      ...params,
      ...flat_ssh_fields(mongo),
      // "documentdb" here is purely so reopening this connection re-selects
      // "Amazon DocumentDB" in the picker — connected to identically to
      // "mongodb" either way (see `mongo_build_params`'s retry_writes/
      // replica_set for what actually differs about the connection).
      kind: (kind === "documentdb" ? "documentdb" : "mongodb") as SavedDbKind,
    };
  };

  const save_mongo_local = () => {
    if (editing?.source === "local") {
      updateSavedLocal(
        editing.oldName,
        mongo_display_name(),
        mongo_saved_params(),
      );
      pushNotification({
        kind: "success",
        title: "Updated saved MongoDB connection",
        detail: mongo_display_name(),
      });
      setEditing(null);
      return;
    }
    saveLocal(mongo_display_name(), mongo_saved_params());
    pushNotification({
      kind: "success",
      title: "Saved on this device",
      detail: mongo_display_name(),
    });
  };

  const update_server = async () => {
    if (editing?.source !== "server") return;
    setSavingTo(editing.remoteId);
    try {
      const p = form_ref.current;
      await serversUpdateConnection(editing.profileId, editing.remoteId, {
        name: display_name(),
        host: p.host,
        port: p.port,
        user: p.user,
        // blank password = keep the stored one
        password: "",
        database: p.database,
        ssl_mode: p.ssl_mode,
        ssl_ca_file: p.ssl_ca_file,
        ssl_client_cert_file: p.ssl_client_cert_file,
        ssl_client_key_file: p.ssl_client_key_file,
        pool_max: p.pool_max,
        pool_min: p.pool_min,
        connect_timeout_secs: p.connect_timeout_secs,
        idle_timeout_secs: p.idle_timeout_secs,
        max_lifetime_secs: p.max_lifetime_secs,
        ...flat_ssh_fields(pg),
      });
      pushNotification({
        kind: "success",
        title: "Connection updated",
        detail: display_name(),
      });
      setEditing(null);
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Update failed",
        detail: String(e),
      });
    } finally {
      setSavingTo(null);
    }
  };

  const mongo_update_server = async () => {
    if (editing?.source !== "server") return;
    setSavingTo(editing.remoteId);
    try {
      const p = mongo_build_params();
      await serversUpdateConnection(editing.profileId, editing.remoteId, {
        name: mongo_display_name(),
        // "documentdb" only affects which picker entry reopening this
        // connection re-selects — see `mongo_saved_params`.
        kind: kind === "documentdb" ? "documentdb" : "mongodb",
        host: p.host,
        port: p.port,
        user: p.user,
        // blank password = keep the stored one
        password: "",
        database: p.database,
        auth_db: p.auth_db,
        srv: p.srv,
        tls: p.tls,
        ssl_ca_file: p.ssl_ca_file,
        ssl_client_cert_file: p.ssl_client_cert_file,
        retry_writes: p.retry_writes,
        replica_set: p.replica_set,
        pool_max: p.pool_max,
        pool_min: p.pool_min,
        connect_timeout_secs: p.connect_timeout_secs,
        idle_timeout_secs: p.idle_timeout_secs,
        server_selection_timeout_secs: p.server_selection_timeout_secs,
        ...flat_ssh_fields(mongo),
      });
      pushNotification({
        kind: "success",
        title: "Connection updated",
        detail: mongo_display_name(),
      });
      setEditing(null);
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Update failed",
        detail: String(e),
      });
    } finally {
      setSavingTo(null);
    }
  };

  const edit_server_name =
    editing?.source === "server"
      ? (Object.values(serverSessions).find(
          (x) => x.profile.id === editing.profileId,
        )?.profile.name ?? "")
      : "";

  const save_to_server = async (profileId: string, serverName: string) => {
    if (saving_to) return;
    setSavingTo(profileId);
    try {
      // Re-verify eligibility before attempting to create — permissions may
      // have changed since the session was last refreshed (e.g. an admin
      // revoked this device's token while the tab was open).
      await useStudioStore.getState().refreshServers();
      const fresh = useStudioStore.getState().serverSessions[profileId];
      if (!fresh || !canPublishConnections(fresh.me, fresh.profile.org_id)) {
        pushNotification({
          kind: "error",
          title: "Not eligible",
          detail:
            "Your account no longer has permission to create shared connections on this server.",
        });
        return;
      }
      const p = form_ref.current;
      await serversCreateConnection(profileId, fresh.profile.org_id, {
        name: display_name(),
        host: p.host,
        port: p.port,
        user: p.user,
        password: p.password,
        database: p.database,
        ssl_mode: p.ssl_mode,
        ssl_ca_file: p.ssl_ca_file,
        ssl_client_cert_file: p.ssl_client_cert_file,
        ssl_client_key_file: p.ssl_client_key_file,
        pool_max: p.pool_max,
        pool_min: p.pool_min,
        connect_timeout_secs: p.connect_timeout_secs,
        idle_timeout_secs: p.idle_timeout_secs,
        max_lifetime_secs: p.max_lifetime_secs,
        ...flat_ssh_fields(pg),
      });
      pushNotification({
        kind: "success",
        title: `Shared on ${serverName}`,
        detail: display_name(),
      });
      // Pull the new record into the connected server's sidebar group.
      await useStudioStore.getState().refreshServers();
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Save failed",
        detail: String(e),
      });
    } finally {
      setSavingTo(null);
    }
  };

  const mongo_save_to_server = async (
    profileId: string,
    serverName: string,
  ) => {
    if (saving_to) return;
    setSavingTo(profileId);
    try {
      // Re-verify eligibility before attempting to create — permissions may
      // have changed since the session was last refreshed (e.g. an admin
      // revoked this device's token while the tab was open).
      await useStudioStore.getState().refreshServers();
      const fresh = useStudioStore.getState().serverSessions[profileId];
      if (!fresh || !canPublishConnections(fresh.me, fresh.profile.org_id)) {
        pushNotification({
          kind: "error",
          title: "Not eligible",
          detail:
            "Your account no longer has permission to create shared connections on this server.",
        });
        return;
      }
      const p = mongo_build_params();
      await serversCreateConnection(profileId, fresh.profile.org_id, {
        name: mongo_display_name(),
        // "documentdb" only affects which picker entry reopening this
        // connection re-selects — see `mongo_saved_params`.
        kind: kind === "documentdb" ? "documentdb" : "mongodb",
        host: p.host,
        port: p.port,
        user: p.user,
        password: p.password,
        database: p.database,
        auth_db: p.auth_db,
        srv: p.srv,
        tls: p.tls,
        ssl_ca_file: p.ssl_ca_file,
        ssl_client_cert_file: p.ssl_client_cert_file,
        retry_writes: p.retry_writes,
        replica_set: p.replica_set,
        pool_max: p.pool_max,
        pool_min: p.pool_min,
        connect_timeout_secs: p.connect_timeout_secs,
        idle_timeout_secs: p.idle_timeout_secs,
        server_selection_timeout_secs: p.server_selection_timeout_secs,
        ...flat_ssh_fields(mongo),
      });
      pushNotification({
        kind: "success",
        title: `Shared on ${serverName}`,
        detail: mongo_display_name(),
      });
      // Pull the new record into the connected server's sidebar group.
      await useStudioStore.getState().refreshServers();
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Save failed",
        detail: String(e),
      });
    } finally {
      setSavingTo(null);
    }
  };

  useEffect(() => {
    if (!landing_prefill || landing_prefill.n === last_prefill.current) return;
    last_prefill.current = landing_prefill.n;
    const kind = landing_prefill.kind;
    const p = landing_prefill.params;
    setEditing(landing_prefill.edit ?? null);
    want_connect.current = landing_prefill.connect;
    if (kind === "postgres" || kind === "mongodb" || kind === "documentdb") {
      want_kind.current = kind;
    }
    // Consume immediately: navigating home and back must NOT replay this
    // (that used to auto-open a duplicate connection on every visit).
    clearLandingPrefill();
    // Apply outside the effect body (no cascading renders).
    queueMicrotask(() => {
      if (kind === "mongodb" || kind === "documentdb") {
        const m = p;
        setKind(kind);
        setMongo((prev) => ({
          ...prev,
          name: m.name ?? "",
          host: m.host,
          port: String(m.port),
          user: m.user,
          password: m.password,
          database: m.database,
          auth_db: m.auth_db || "admin",
          srv: m.srv ?? false,
          tls: m.tls ?? false,
          ssl_ca_file: m.ssl_ca_file ?? "",
          ssl_client_cert_file: m.ssl_client_cert_file ?? "",
          retry_writes: m.retry_writes ?? false,
          replica_set: m.replica_set ?? "",
          pool_max: m.pool_max != null ? String(m.pool_max) : "",
          pool_min: m.pool_min != null ? String(m.pool_min) : "",
          connect_timeout_secs:
            m.connect_timeout_secs != null ? String(m.connect_timeout_secs) : "",
          idle_timeout_secs:
            m.idle_timeout_secs != null ? String(m.idle_timeout_secs) : "",
          server_selection_timeout_secs:
            m.server_selection_timeout_secs != null
              ? String(m.server_selection_timeout_secs)
              : "",
          ssh_host: m.ssh_host ?? "",
          ssh_port: m.ssh_port != null ? String(m.ssh_port) : "",
          ssh_user: m.ssh_user ?? "",
          ssh_auth_mode: m.ssh_auth_mode ?? "password",
          ssh_password: m.ssh_password ?? "",
          ssh_key_file: m.ssh_key_file ?? "",
          ssh_key_passphrase: m.ssh_key_passphrase ?? "",
          ssh_host_key_fingerprint: m.ssh_host_key_fingerprint ?? "",
        }));
      } else if (kind === "sqlite") {
        setKind("sqlite");
        setFormTab("general");
        setSqlitePath(p.source_path ?? null);
      } else {
        const pgv = p;
        setKind("postgres");
        setPg((prev) => ({
          ...prev,
          host: pgv.host,
          port: String(pgv.port),
          user: pgv.user,
          password: pgv.password,
          database: pgv.database,
          ssl_mode: pgv.ssl_mode ?? prev.ssl_mode,
          ssl_ca_file: pgv.ssl_ca_file ?? "",
          ssl_client_cert_file: pgv.ssl_client_cert_file ?? "",
          ssl_client_key_file: pgv.ssl_client_key_file ?? "",
          pool_max: pgv.pool_max != null ? String(pgv.pool_max) : "",
          pool_min: pgv.pool_min != null ? String(pgv.pool_min) : "",
          connect_timeout_secs:
            pgv.connect_timeout_secs != null ? String(pgv.connect_timeout_secs) : "",
          idle_timeout_secs:
            pgv.idle_timeout_secs != null ? String(pgv.idle_timeout_secs) : "",
          max_lifetime_secs:
            pgv.max_lifetime_secs != null ? String(pgv.max_lifetime_secs) : "",
          ssh_host: pgv.ssh_host ?? "",
          ssh_port: pgv.ssh_port != null ? String(pgv.ssh_port) : "",
          ssh_user: pgv.ssh_user ?? "",
          ssh_auth_mode: pgv.ssh_auth_mode ?? "password",
          ssh_password: pgv.ssh_password ?? "",
          ssh_key_file: pgv.ssh_key_file ?? "",
          ssh_key_passphrase: pgv.ssh_key_passphrase ?? "",
          ssh_host_key_fingerprint: pgv.ssh_host_key_fingerprint ?? "",
        }));
      }
    });
  }, [landing_prefill, clearLandingPrefill]);

  // Runs after the prefilled values commit; fires the Connect flow so its
  // spinner/state drives from the form itself. The global connecting flags
  // keep this safe across home/studio navigation.
  useEffect(() => {
    if (want_kind.current !== "postgres" || !want_connect.current) return;
    // `host` (not `database`, now optional) as the "prefill has landed"
    // signal — always non-empty for any real connection, unlike database.
    if (!pg.host.trim() || pg_connecting) return;
    want_kind.current = null;
    want_connect.current = false;
    // Microtask keeps setState out of the effect body itself.
    queueMicrotask(() => void pg_connect_click());
  });

  useEffect(() => {
    if (
      (want_kind.current !== "mongodb" && want_kind.current !== "documentdb") ||
      !want_connect.current
    )
      return;
    if (!mongo.database.trim() || mongo_connecting) return;
    want_kind.current = null;
    want_connect.current = false;
    // Microtask keeps setState out of the effect body itself.
    queueMicrotask(() => void mongo_connect_click());
  });

  // PG form field setter — keeps form_ref in sync via the effect above.
  const setPgField = (key: keyof PgFormValues, value: string) => {
    setPg((p) => ({ ...p, [key]: value }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* SQLite is a local file — only "General" applies, no SSH/SSL. */}
      <FormTabBar
        value={form_tab}
        onChange={setFormTab}
        tabs={kind === "sqlite" ? SQLITE_TABS : undefined}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-6 px-6 py-10">
          {editing && (
            <EditBanner
              editing={editing}
              server_name={edit_server_name}
              onCancel={() => setEditing(null)}
            />
          )}

          <Card className="w-full">
            <CardContent className="flex flex-col gap-4 pt-4">
              <DbTypeSelect value={kind} on_change={change_kind} />
              {kind === "sqlite" ? (
                <SqlitePanel
                  opening={opening}
                  onOpen={() => void open_file_click()}
                  path={sqlite_path}
                />
              ) : kind === "mongodb" || kind === "documentdb" ? (
                <MongoPanel
                  form={mongo}
                  setField={(key, value) => {
                    setMongo((m) => ({ ...m, [key]: value }));
                  }}
                  is_document_db={kind === "documentdb"}
                  tab={form_tab}
                  testing={mongo_testing}
                  test_ok={mongo_test_ok}
                  test_error={mongo_test_error}
                  onTest={() => void mongo_test_click()}
                  connecting={mongo_connecting}
                  onConnect={() => void mongo_connect_click()}
                  saving_to={saving_to}
                  admin_servers={admin_servers}
                  editing={editing !== null}
                  onSaveLocal={save_mongo_local}
                  onSaveServer={(pid, name) =>
                    void mongo_save_to_server(pid, name)
                  }
                  onUpdate={() =>
                    editing?.source === "server"
                      ? void mongo_update_server()
                      : save_mongo_local()
                  }
                  onCancelEdit={() => setEditing(null)}
                  onClear={clear_mongo_form}
                  url_text={mongo_url_text}
                  setUrlText={setMongoUrlText}
                  url_error={mongo_url_error}
                  copied={mongo_copied}
                  onImport={() => void import_mongo_url()}
                  onExport={() => void export_mongo_url()}
                />
              ) : (
                <PgPanel
                  form={pg}
                  setField={setPgField}
                  tab={form_tab}
                  url_text={url_text}
                  setUrlText={setUrlText}
                  url_error={url_error}
                  copied={copied}
                  onImport={import_url}
                  onExport={() => void export_url()}
                  testing={testing}
                  test_ok={test_ok}
                  test_error={test_error}
                  onTest={() => void test_click()}
                  connecting={pg_connecting}
                  onConnect={() => void pg_connect_click()}
                  saving_to={saving_to}
                  admin_servers={admin_servers}
                  editing={editing}
                  onSaveLocal={save_local}
                  onSaveServer={(pid, name) => void save_to_server(pid, name)}
                  onUpdate={() => void update_server()}
                  onCancelEdit={() => setEditing(null)}
                  onClear={clear_pg_form}
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
