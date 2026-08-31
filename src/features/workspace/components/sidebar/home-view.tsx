import {
  AlertTriangle,
  ChevronRight,
  Cloud,
  Database,
  Pin,
  Plug,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { serversFetchCredentials, srvConnId } from "@/shared/api/client";
import { reopenRecent } from "@/features/connections";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { useStudioStore } from "@/shared/store";
import type { SavedConnParams } from "@/shared/store";

/** Collapsible sidebar section. An OPEN section stretches to fill all
 *  remaining height; CLOSED ones shrink to just their header row, stacking
 *  underneath. Several open sections share the height equally. */
function Collapse({
  icon: Icon,
  label,
  count,
  open,
  on_toggle,
  children,
}: {
  icon: typeof Pin;
  label: string;
  count?: number;
  open: boolean;
  on_toggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col border-b",
        open ? "flex-1" : "shrink-0",
      )}
    >
      <button
        onClick={on_toggle}
        aria-expanded={open}
        className="text-muted-foreground hover:bg-muted/50 flex shrink-0 items-center gap-2 py-2 pr-3 pl-1 text-xs font-medium"
      >
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        <Icon className="size-3.5" />
        {label}
        {count !== undefined && (
          <span className="bg-muted ml-auto rounded-full px-1.5 text-[10px]">
            {count}
          </span>
        )}
      </button>
      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-0">
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * Landing-page sidebar: everything saveable, grouped by source —
 *   [team server groups] · Saved (local) · Pinned (shortcuts) · Recent
 * Each group is collapsible; open groups share the panel height.
 * Single click loads details into the home form; double-click connects.
 */
export function HomeView({
  search_value,
  on_search_change,
}: {
  search_value: string;
  on_search_change: (v: string) => void;
}) {
  const saved_local = useStudioStore((s) => s.savedLocal);
  const delete_saved = useStudioStore((s) => s.deleteSavedLocal);
  const pins = useStudioStore((s) => s.pins);
  const toggle_pin = useStudioStore((s) => s.togglePin);
  const server_sessions = useStudioStore((s) => s.serverSessions);
  const open_conn = useStudioStore((s) => s.openConn);
  const request_prefill = useStudioStore((s) => s.requestLandingPrefill);
  const delete_server_connection = useStudioStore(
    (s) => s.deleteServerConnection,
  );
  const refresh_servers = useStudioStore((s) => s.refreshServers);
  const server_busy = useStudioStore((s) => s.serverBusy);
  const recent = useStudioStore((s) => s.recent);
  const recents_params = useStudioStore((s) => s.recentParams);

  const [confirm_del, setConfirmDel] = useState<string | null>(null);
  /** All sections start expanded; any of them can be collapsed. */
  const [open_map, setOpenMap] = useState<Record<string, boolean>>({});
  const toggle_section = (key: string) =>
    setOpenMap((m) => ({ ...m, [key]: !(m[key] ?? true) }));
  const is_open = (key: string) => {
    return (open_map[key] ?? key === "recent") ? false : true;
  };

  // Pull fresh team catalogs on mount so grant changes made elsewhere (e.g.
  // another device's admin session) show up without a manual refresh.
  const has_servers = Object.keys(server_sessions).length > 0;
  const has_servers_ref = useRef(has_servers);
  useEffect(() => {
    if (has_servers && !has_servers_ref.current) {
      has_servers_ref.current = true;
      void refresh_servers();
    } else if (!has_servers) {
      has_servers_ref.current = false;
    }
  }, [has_servers, refresh_servers]);

  const home_query = search_value.trim().toLowerCase();

  /** A saved connection bundled with everything the Saved section needs:
   *  its kind (which form it fills) and its pin id. */
  type SavedRow = {
    id: string;
    name: string;
    kind: SavedConnParams["kind"];
    params: SavedConnParams;
  };
  const saved_rows = useMemo<SavedRow[]>(() => {
    const matches = (v: string | undefined) =>
      !home_query || v?.toLowerCase().includes(home_query);
    const out: SavedRow[] = [];
    for (const [name, p] of Object.entries(saved_local)) {
      // Backfill for saves written before the kind field existed.
      const kind = p.kind || "postgres";
      if (!matches(name) && ![p.database, p.host, p.user].some(matches))
        continue;
      out.push({ id: `local:${name}`, name, kind, params: p });
    }
    return out;
  }, [saved_local, home_query]);

  const recent_filtered = useMemo(() => {
    if (!home_query) return recent;
    return recent.filter(
      (c) =>
        c.name.toLowerCase().includes(home_query) ||
        recents_params[c.id]?.database?.toLowerCase().includes(home_query) ||
        recents_params[c.id]?.host?.toLowerCase().includes(home_query),
    );
  }, [recent, recents_params, home_query]);

  /** Resolve pin ids into clickable entries across every source. */
  const pinned_entries = useMemo(() => {
    const out: {
      id: string;
      label: string;
      source: string;
      connect_title: string;
      on_click: () => void;
      on_double_click: () => void;
    }[] = [];
    for (const id of pins) {
      if (id.startsWith("local:")) {
        const name = id.slice(6);
        const params = saved_local[name];
        if (!params) continue;
        if (home_query && !name.toLowerCase().includes(home_query)) continue;
        const kind = params.kind || "postgres";
        out.push({
          id,
          label: name,
          source: kind === "mongodb" ? "mongodb" : "local",
          connect_title: "Double-click to connect",
          on_click: () => request_prefill(kind, { ...params }),
          on_double_click: () => request_prefill(kind, { ...params }, true),
        });
        continue;
      }
      for (const sess of Object.values(server_sessions)) {
        const c = sess.connections.find((x) => x.id === id);
        if (!c) continue;
        if (home_query && !c.name.toLowerCase().includes(home_query)) continue;
        out.push({
          id,
          label: c.name,
          source: sess.profile.name,
          connect_title: "Single click loads details; double-click connects",
          on_click: () =>
            request_prefill("postgres", {
              host: c.host,
              port: c.port,
              user: c.user,
              password: "",
              database: c.database,
              kind: "postgres",
            }),
          on_double_click: () =>
            open_conn({
              id: c.id,
              name: c.name,
              kind: "postgres",
              source_path: null,
            }),
        });
        break;
      }
    }
    return out;
  }, [
    pins,
    saved_local,
    server_sessions,
    home_query,
    open_conn,
    request_prefill,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Fixed search bar. */}
      <div className="flex shrink-0 items-center gap-1 px-4 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            className="h-8 pl-7 text-xs"
            placeholder="Search connections…"
            value={search_value}
            onChange={(e) => on_search_change(e.target.value)}
          />
        </div>
        {has_servers && (
          <Button
            variant="ghost"
            size="iconXs"
            aria-label="Refresh team connections"
            title="Refresh team connections"
            disabled={server_busy}
            onClick={() => void refresh_servers()}
          >
            <RefreshCw
              className={cn("size-3.5", server_busy && "animate-spin")}
            />
          </Button>
        )}
      </div>

      {/* Pinned shortcuts across all sources. */}
      {pinned_entries.length > 0 && (
        <Collapse
          icon={Pin}
          label="Pinned"
          count={pinned_entries.length}
          open={is_open("pinned")}
          on_toggle={() => toggle_section("pinned")}
        >
          <ul className="flex flex-col gap-0.5">
            {pinned_entries.map((entry) => (
              <li key={entry.id}>
                <Button
                  variant="ghost"
                  title={entry.connect_title}
                  onClick={entry.on_click}
                  onDoubleClick={entry.on_double_click}
                  className="hover:bg-accent group h-7 w-full justify-start gap-2 rounded-md px-2 py-2 text-left font-normal"
                >
                  <Pin className="size-4 shrink-0 text-amber-500" />
                  <span className="truncate font-medium">{entry.label}</span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-[10px] uppercase">
                    {entry.source}
                  </span>
                  <span
                    aria-label="Unpin"
                    className="text-muted-foreground hover:text-destructive invisible shrink-0 group-hover:visible"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle_pin(entry.id);
                    }}
                  >
                    <X className="size-3.5" />
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </Collapse>
      )}

      {/* One collapsible group per connected team server. */}
      {Object.values(server_sessions).map((sess) => {
        const key = `srv:${sess.profile.id}`;
        const rows = sess.connections.filter(
          (c) => !home_query || c.name.toLowerCase().includes(home_query),
        );
        if (rows.length === 0) return null;
        return (
          <Collapse
            key={key}
            icon={Cloud}
            label={sess.profile.name}
            count={rows.length}
            open={is_open(key)}
            on_toggle={() => toggle_section(key)}
          >
            <ul className="flex flex-col gap-0.5">
              {rows.map((c) => {
                const is_pinned = pins.includes(c.id);
                const can_delete = c.can_delete || sess.me.is_admin;
                return (
                  <li key={c.id}>
                    <Button
                      variant="ghost"
                      title="Single click loads details; double-click connects"
                      onClick={async () => {
                        const remote_id = c.id.split(":")[2] ?? "";
                        const profileId = sess.profile.id;
                        try {
                          const creds = await serversFetchCredentials(
                            profileId,
                            remote_id,
                          );
                          request_prefill("postgres", {
                            host: creds.host,
                            port: creds.port,
                            user: creds.user,
                            password: creds.password,
                            database: creds.database,
                            kind: "postgres",
                          }, false);
                        } catch {
                          request_prefill("postgres", {
                            host: c.host,
                            port: c.port,
                            user: c.user,
                            password: "",
                            database: c.database,
                            kind: "postgres",
                          }, false);
                        }
                      }}
                      onDoubleClick={() => {
                        const remote_id = c.id.split(":")[2] ?? "";
                        const srv_id = srvConnId(sess.profile.id, remote_id);
                        open_conn({
                          id: srv_id,
                          name: c.name,
                          kind: "postgres",
                          source_path: null,
                        });
                      }}
                      className="hover:bg-accent h-7 w-full justify-start gap-2 rounded-md px-2 py-2 text-left font-normal"
                    >
                      <Cloud className="text-muted-foreground size-4 shrink-0" />
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        {can_delete && (
                          <span
                            aria-label={
                              confirm_del === c.id
                                ? "Click again to confirm delete"
                                : `Delete ${c.name}`
                            }
                            title={
                              confirm_del === c.id
                                ? "Click again to confirm delete"
                                : "Delete this shared connection"
                            }
                            className={cn(
                              "hover:text-destructive hover:bg-destructive/10 flex h-7 items-center gap-2 rounded-md px-2 hover:cursor-pointer",
                              confirm_del === c.id &&
                                "text-destructive bg-destructive/10",
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm_del === c.id) {
                                void delete_server_connection(
                                  sess.profile.id,
                                  c.id.split(":")[2] ?? "",
                                  c.id,
                                );
                                setConfirmDel(null);
                              } else {
                                setConfirmDel(c.id);
                                setTimeout(
                                  () =>
                                    setConfirmDel((cur) =>
                                      cur === c.id ? null : cur,
                                    ),
                                  3000,
                                );
                              }
                            }}
                          >
                            {confirm_del === c.id ? (
                              <>
                                <AlertTriangle className="size-3.5" /> confirm
                              </>
                            ) : (
                              <Trash2 className="size-3.5" />
                            )}
                          </span>
                        )}
                        <span
                          aria-label={
                            is_pinned ? `Unpin ${c.name}` : `Pin ${c.name}`
                          }
                          className="hover:text-amber-500"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle_pin(c.id);
                          }}
                        >
                          <Pin
                            className={cn(
                              "size-3.5",
                              is_pinned && "fill-amber-400 text-amber-400",
                            )}
                          />
                        </span>
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Collapse>
        );
      })}

      {/* Locally saved connections. */}
      <Collapse
        icon={Save}
        label="Saved"
        count={saved_rows.length}
        open={is_open("saved")}
        on_toggle={() => toggle_section("saved")}
      >
        {saved_rows.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed px-2 py-2 text-xs">
            {home_query
              ? "No saved connections match."
              : "Use Save on the home form to keep a connection here."}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {saved_rows.map((row) => {
              const { id: pin_id, name, kind, params } = row;
              const is_pinned = pins.includes(pin_id);
              return (
                <li key={name}>
                  <Button
                    variant="ghost"
                    title="Load into the connect form"
                    onClick={() => request_prefill(kind, { ...params })}
                    onDoubleClick={() =>
                      request_prefill(kind, { ...params }, true)
                    }
                    className="hover:bg-accent group h-7 w-full justify-start gap-2 rounded-md px-2 py-2 text-left font-normal"
                  >
                    <Save className="text-muted-foreground size-4 shrink-0" />
                    <span className="truncate font-medium">{name}</span>
                    {kind === "mongodb" && (
                      <span className="text-muted-foreground ml-auto shrink-0 text-[10px] uppercase">
                        mongo
                      </span>
                    )}
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      <span
                        aria-label={`Delete ${name}`}
                        className="text-muted-foreground hover:text-destructive invisible group-hover:visible"
                        onClick={(e) => {
                          e.stopPropagation();
                          delete_saved(name);
                        }}
                      >
                        <X className="size-3.5" />
                      </span>
                      <span
                        aria-label={is_pinned ? `Unpin ${name}` : `Pin ${name}`}
                        className="hover:text-amber-500"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle_pin(pin_id);
                        }}
                      >
                        <Pin
                          className={cn(
                            "size-3.5",
                            is_pinned && "fill-amber-400 text-amber-400",
                          )}
                        />
                      </span>
                    </span>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Collapse>

      {/* Recent databases. */}
      <Collapse
        icon={Plug}
        label="Recent"
        count={recent_filtered.length}
        open={is_open("recent")}
        on_toggle={() => toggle_section("recent")}
      >
        {recent_filtered.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed px-2 py-2 text-xs">
            {home_query
              ? "No recent databases match."
              : "Databases you open will be listed here for quick access."}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5 pb-2">
            {recent_filtered.map((conn) => {
              const is_srv = conn.id.startsWith("srv:");
              const srv_profile = is_srv ? conn.id.split(":")[1] : null;
              const server_connected =
                is_srv && srv_profile ? srv_profile in server_sessions : true;
              return (
                <li key={conn.id}>
                  <Button
                    variant="ghost"
                    title={
                      server_connected
                        ? "Double-click to connect"
                        : "Server not connected"
                    }
                    onClick={() => {
                      const params = recents_params[conn.id];
                      if (conn.kind === "postgres" && params) {
                        request_prefill("postgres", {
                          ...params,
                          kind: "postgres",
                        });
                      } else if (conn.source_path) {
                        request_prefill("sqlite", {
                          name: conn.name,
                          kind: "sqlite",
                          host: "",
                          port: 0,
                          user: "",
                          password: "",
                          database: "",
                          source_path: conn.source_path,
                        });
                      } else {
                        void reopenRecent(conn);
                      }
                    }}
                    onDoubleClick={() => {
                      const params = recents_params[conn.id];
                      if (conn.kind === "postgres" && params) {
                        request_prefill(
                          "postgres",
                          { ...params, kind: "postgres" },
                          true,
                        );
                      } else {
                        void reopenRecent(conn);
                      }
                    }}
                    className={cn(
                      "hover:bg-accent h-7 w-full justify-start gap-2 rounded-md px-2 py-2 text-left font-normal",
                      !server_connected &&
                        "text-muted-foreground/50 line-through",
                    )}
                  >
                    <Database className="text-muted-foreground size-4 shrink-0" />
                    <span className="truncate font-medium">{conn.name}</span>
                    {conn.kind === "postgres" && (
                      <span className="text-muted-foreground ml-auto shrink-0 text-[10px] uppercase">
                        pg
                      </span>
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Collapse>
    </div>
  );
}
