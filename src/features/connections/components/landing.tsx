import { useEffect, useRef, useState } from "react";
import { Database, FileCode2 } from "lucide-react";
import { Card, CardContent } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";
import {
  closeConnection,
  connectPostgres,
  openDatabasePath,
  serversCreateConnection,
  serversUpdateConnection,
  type ConnectionInfo,
} from "@/shared/api";
import { WEB } from "@/shared/api/web";
import { pickDatabaseFile } from "@/shared/lib/platform";
import { useStudioStore } from "@/shared/store";
import type { LandingEditTarget, SavedConnParams } from "@/shared/store";

import { EditBanner } from "./edit-banner";
import { PgPanel } from "./pg-panel";
import { SqlitePanel } from "./sqlite-panel";

type DbKindChoice = "sqlite" | "postgres";

/** Connection-kind bar, styled like the editor's tab strip (top of page). */
function KindBar({
  value,
  on_change,
}: {
  value: DbKindChoice;
  on_change: (v: DbKindChoice) => void;
}) {
  const items: { id: DbKindChoice; label: string; icon: typeof Database }[] = [
    { id: "sqlite", label: "SQLite", icon: Database },
    { id: "postgres", label: "PostgreSQL", icon: FileCode2 },
  ];
  return (
    <div
      role="tablist"
      className="bg-background flex w-full shrink-0 scrollbar-none items-center gap-1 overflow-x-auto border-b pl-1.5 [&::-webkit-scrollbar]:hidden"
    >
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={value === id}
          onClick={() => on_change(id)}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm whitespace-nowrap",
            value === id
              ? "border-primary text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent",
          )}
        >
          <Icon className="size-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

export function Landing() {
  const openConn = useStudioStore((s) => s.openConn);

  const [kind, setKind] = useState<DbKindChoice>("sqlite");
  const [opening, setOpening] = useState(false);

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
  const [pg_name, setPgName] = useState("");
  const [pg_host, setPgHost] = useState("localhost");
  const [pg_port, setPgPort] = useState("5432");
  const [pg_user, setPgUser] = useState("postgres");
  const [pg_password, setPgPassword] = useState("");
  const [pg_database, setPgDatabase] = useState("");
  const [pg_ssl, setPgSsl] = useState("prefer");
  /** GLOBAL connect flag — navigating home mid-connect keeps the spinner
   *  truthful and blocks a second auto-connect from the replayed prefill. */
  const pg_connecting = useStudioStore((st) => st.pgConnecting);
  const setPgConnecting = useStudioStore((st) => st.setPgConnecting);
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

  const build_params = () => ({
    host: pg_host.trim() || "localhost",
    port: Number(pg_port) || 5432,
    user: pg_user.trim(),
    password: pg_password,
    database: pg_database.trim(),
    ssl_mode: pg_ssl,
  });

  const display_name = () =>
    pg_name.trim() ||
    pg_database.trim() ||
    `${pg_user.trim()}@${pg_host.trim() || "localhost"}`;

  // Latest form values, readable from effects without stale-closure races.
  const form_ref = useRef(build_params());
  useEffect(() => {
    form_ref.current = build_params();
  });

  const test_click = async () => {
    if (testing || !pg_database.trim()) return;
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
      setPgUser(decodeURIComponent(u.username));
      setPgPassword(decodeURIComponent(u.password));
      setPgHost(u.hostname);
      if (u.port) setPgPort(u.port);
      setPgDatabase(u.pathname.replace(/^\/+/, ""));
      const sm = u.searchParams.get("sslmode");
      if (sm) setPgSsl(sm);
      setUrlError(null);
    } catch {
      setUrlError("Could not parse that connection URL.");
    }
  };

  const export_url = async () => {
    const auth = `${encodeURIComponent(pg_user.trim())}:${encodeURIComponent(pg_password)}`;
    const ssl = pg_ssl === "prefer" ? "" : `?sslmode=${pg_ssl}`;
    const url = `postgres://${auth}@${pg_host.trim() || "localhost"}:${Number(pg_port) || 5432}/${pg_database.trim()}${ssl}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  // Sidebar click hands PG details here; switch to the PG tab + fill. When
  // the request carries connect=true (double-click), chain a connect right
  // after the prefilled fields have committed.
  const last_prefill = useRef(0);
  const want_connect = useRef(false);

  const pg_connect_click = async () => {
    if (pg_connecting || !pg_database.trim()) return;
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
        name: pg_name.trim() || undefined,
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

  // ---- Save connection (local pin or shared onto a team server) ----
  const serverSessions = useStudioStore((st) => st.serverSessions);
  const saveLocalPg = useStudioStore((st) => st.saveLocalPg);
  const pushNotification = useStudioStore((st) => st.pushNotification);
  /** Servers whose active session may publish connections (admin scope only). */
  const admin_servers = Object.values(serverSessions).filter(
    (s) => s.me.is_admin,
  );
  const [saving_to, setSavingTo] = useState<string | null>(null);
  const updateSavedLocalPg = useStudioStore((st) => st.updateSavedLocalPg);
  const [editing, setEditing] = useState<LandingEditTarget | null>(null);

  const save_local = () => {
    if (editing?.source === "local") {
      updateSavedLocalPg(editing.oldName, display_name(), build_params());
      pushNotification({
        kind: "success",
        title: "Updated saved connection",
        detail: display_name(),
      });
      setEditing(null);
      return;
    }
    saveLocalPg(display_name(), build_params());
    pushNotification({
      kind: "success",
      title: "Saved on this device",
      detail: display_name(),
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
      if (!fresh || !fresh.me.is_admin) {
        pushNotification({
          kind: "error",
          title: "Not eligible",
          detail:
            "Your account no longer has permission to create shared connections on this server.",
        });
        return;
      }
      const p = form_ref.current;
      await serversCreateConnection(profileId, {
        name: display_name(),
        host: p.host,
        port: p.port,
        user: p.user,
        password: p.password,
        database: p.database,
        ssl_mode: p.ssl_mode,
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

  useEffect(() => {
    if (!landing_prefill || landing_prefill.n === last_prefill.current) return;
    last_prefill.current = landing_prefill.n;
    const p: SavedConnParams = landing_prefill.params;
    setEditing(landing_prefill.edit ?? null);
    want_connect.current = landing_prefill.connect;
    // Consume immediately: navigating home and back must NOT replay this
    // (that used to auto-open a duplicate connection on every visit).
    clearLandingPrefill();
    // Apply outside the effect body (no cascading renders).
    queueMicrotask(() => {
      setKind("postgres");
      setPgHost(p.host);
      setPgPort(String(p.port));
      setPgUser(p.user);
      setPgPassword(p.password);
      setPgDatabase(p.database);
      if (p.ssl_mode) setPgSsl(p.ssl_mode);
    });
  }, [landing_prefill, clearLandingPrefill]);

  // Runs after the prefilled values commit; fires the Connect flow so its
  // spinner/state drives from the form itself. The global pg_connecting flag
  // keeps this safe across home/studio navigation.
  useEffect(() => {
    if (!want_connect.current) return;
    if (!pg_database.trim() || pg_connecting) return;
    want_connect.current = false;
    // Microtask keeps setState out of the effect body itself.
    queueMicrotask(() => void pg_connect_click());
  });

  // PG form field setter — keeps form_ref in sync via the effect above.
  const setPgField = (key: string, value: string) => {
    const setters: Record<string, (v: string) => void> = {
      host: setPgHost,
      port: setPgPort,
      user: setPgUser,
      password: setPgPassword,
      database: setPgDatabase,
      name: setPgName,
      ssl_mode: setPgSsl,
    };
    setters[key]?.(value);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <KindBar value={kind} on_change={setKind} />

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
              {kind === "sqlite" ? (
                <SqlitePanel
                  opening={opening}
                  onOpen={() => void open_file_click()}
                />
              ) : (
                <PgPanel
                  form={{
                    name: pg_name,
                    host: pg_host,
                    port: pg_port,
                    user: pg_user,
                    password: pg_password,
                    database: pg_database,
                    ssl_mode: pg_ssl,
                  }}
                  setField={setPgField}
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
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
