import {
  ChevronRight,
  Copy,
  CopyPlus,
  Database,
  Pencil,
  Pin,
  Plug,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { WEB } from "@/shared/api/web";
import { connGuardOf } from "@/shared/api/client";
import {
  CONNECTED_HOLD_MS,
  ConnectingDialog,
  connectSaved,
  type ConnectingTarget,
  needsPassword,
  PasswordPrompt,
  reopenRecent,
  uniqueCopyName,
} from "@/features/connections";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/shared/components/ui/context-menu";
import { useStudioStore } from "@/shared/store";
import type { SavedConnParams } from "@/shared/store";
import type { ConnGuard, DbKind } from "@/shared/api";
import { ConnFlags } from "@/shared/components/env-chip";
import { DBIcons } from "@/shared/components/icons/types";

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
          <span className="bg-muted text-3xs ml-auto rounded-full px-1.5">
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
 *   Saved · Pinned (shortcuts) · Recent
 * Each group is collapsible; open groups share the panel height.
 * Single click selects a row; double click or Enter connects.
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
  const push_notification = useStudioStore((s) => s.pushNotification);
  const pins = useStudioStore((s) => s.pins);
  const toggle_pin = useStudioStore((s) => s.togglePin);
  const request_form = useStudioStore((s) => s.requestLandingForm);
  const recent = useStudioStore((s) => s.recent);
  const recents_params = useStudioStore((s) => s.recentParams);

  /** All sections start expanded; any of them can be collapsed. */
  const [open_map, setOpenMap] = useState<Record<string, boolean>>({});
  const toggle_section = (key: string) =>
    setOpenMap((m) => ({ ...m, [key]: !(m[key] ?? true) }));
  const is_open = (key: string) => {
    return (open_map[key] ?? key === "recent") ? false : true;
  };

  const home_query = search_value.trim().toLowerCase();

  const [selected, setSelected] = useState<string | null>(null);
  const [connecting_to, setConnectingTo] = useState<ConnectingTarget | null>(
    null,
  );
  const [prompt, setPrompt] = useState<{
    name: string;
    kind: SavedConnParams["kind"];
    params: SavedConnParams;
  } | null>(null);

  const connect_direct = async (
    name: string,
    kind: SavedConnParams["kind"],
    params: SavedConnParams,
  ) => {
    if (connecting_to) return;
    if (needsPassword(params, WEB)) {
      setPrompt({ name, kind, params });
      return;
    }
    setConnectingTo({
      name,
      kind,
      where:
        kind === "sqlite"
          ? (params.source_path ?? "")
          : params.srv
            ? params.host
            : `${params.host}:${params.port}`,
    });
    try {
      await connectSaved(kind, params, undefined, async () => {
        setConnectingTo((t) => t && { ...t, done: true });
        await new Promise((r) => setTimeout(r, CONNECTED_HOLD_MS));
      });
    } catch (e) {
      push_notification({
        kind: "error",
        title: "Connection failed",
        detail: String(e),
      });
    } finally {
      setConnectingTo(null);
    }
  };

  /** Click selects, double click and Enter connect. */
  const row_events = (id: string, connect: () => void) => ({
    onClick: () => setSelected(id),
    onDoubleClick: connect,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      setSelected(id);
      connect();
    },
  });

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

  const copy_saved_name = async (name: string) => {
    try {
      await navigator.clipboard.writeText(name);
    } catch {
      // Clipboard unavailable in this webview; ignore.
    }
  };

  /** Opens the form with an unsaved copy; nothing is saved until Save. */
  const duplicate_saved = (
    name: string,
    kind: SavedConnParams["kind"],
    params: SavedConnParams,
  ) => {
    request_form(kind, {
      ...params,
      kind,
      name: uniqueCopyName(name, saved_local),
    });
  };

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
      kind: DbKind;
      source: string;
      connect_title: string;
      /** Read only flag and environment label, for the chip and lock. */
      guard?: ConnGuard;
      connect: () => void;
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
          kind,
          source: WEB ? "browser" : "local",
          connect_title: "Double-click to connect",
          guard: connGuardOf(params),
          connect: () => void connect_direct(name, kind, params),
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- connect_direct only reads stable store actions
  }, [pins, saved_local, home_query]);

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
            {pinned_entries.map((entry) => {
              const DBIcon = DBIcons[entry.kind] ?? Database;
              return (
                <li key={entry.id}>
                  <ContextMenu>
                    <ContextMenuTrigger className="contents">
                      <Button
                        variant="ghost"
                        title={entry.connect_title}
                        aria-pressed={selected === entry.id}
                        {...row_events(`pinned:${entry.id}`, entry.connect)}
                        className={cn(
                          "hover:bg-accent group w-full justify-start gap-2 rounded-md px-2 py-2 text-left font-normal",
                          selected === `pinned:${entry.id}` && "bg-accent",
                        )}
                      >
                        {DBIcon && <DBIcon className="size-4 shrink-0" />}
                        <span className="truncate font-medium">
                          {entry.label}
                        </span>
                        {entry.guard && <ConnFlags conn={entry.guard} />}
                        <span className="text-muted-foreground text-3xs ml-auto shrink-0 uppercase">
                          {entry.source}
                        </span>
                      </Button>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-52">
                      <ContextMenuItem onSelect={entry.connect}>
                        <Plug className="size-3.5" />
                        Open Connection
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => toggle_pin(entry.id)}>
                        <Pin className="size-3.5" />
                        Unpin Connection
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                </li>
              );
            })}
          </ul>
        </Collapse>
      )}

      {/* Saved connections: on this device, or in this browser on the web. */}
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
              : WEB
                ? "Use Save on the home form to keep a connection in this browser."
                : "Use Save on the home form to keep a connection here."}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {saved_rows.map((row) => {
              const { id: pin_id, name, kind, params } = row;
              const is_pinned = pins.includes(pin_id);
              const DBIcon = DBIcons[kind] ?? Database;
              const row_button = (
                <Button
                  variant="ghost"
                  title="Double-click to connect"
                  aria-pressed={selected === pin_id}
                  {...row_events(
                    pin_id,
                    () => void connect_direct(name, kind, params),
                  )}
                  className={cn(
                    "hover:bg-accent group w-full justify-start gap-2 rounded-md px-2 py-2 text-left font-normal",
                    selected === pin_id && "bg-accent",
                  )}
                >
                  <DBIcon className="text-muted-foreground size-4 shrink-0" />
                  <span className="truncate font-medium">{name}</span>
                  <ConnFlags conn={params} />
                </Button>
              );
              return (
                <li key={name}>
                  <ContextMenu>
                    <ContextMenuTrigger className="contents">
                      {row_button}
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-52">
                      <ContextMenuItem
                        onSelect={() => void connect_direct(name, kind, params)}
                      >
                        <Plug className="size-3.5" />
                        Open Connection
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => toggle_pin(pin_id)}>
                        <Pin className="size-3.5" />
                        {is_pinned ? "Unpin Connection" : "Pin Connection"}
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => void copy_saved_name(name)}
                      >
                        <Copy className="size-3.5" />
                        Copy Name
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() =>
                          request_form(
                            kind,
                            { ...params },
                            {
                              oldName: name,
                              name,
                            },
                          )
                        }
                      >
                        <Pencil className="size-3.5" />
                        Edit Connection
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => duplicate_saved(name, kind, params)}
                      >
                        <CopyPlus className="size-3.5" />
                        Duplicate Connection
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        variant="destructive"
                        onSelect={() => void delete_saved(name)}
                      >
                        <Trash2 className="size-3.5" />
                        Delete Connection
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
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
              // conn.kind (ConnectionInfo, the live connection) is always
              // "mongodb" for a DocumentDB connection by design — prefer
              // the saved-params record's kind, which remembers which
              // picker entry was actually used, when one's available.
              const DBIcon =
                DBIcons[recents_params[conn.id]?.kind ?? conn.kind] ?? Database;
              return (
                <li key={conn.id}>
                  <Button
                    variant="ghost"
                    title="Double-click to connect"
                    aria-pressed={selected === `recent:${conn.id}`}
                    {...row_events(`recent:${conn.id}`, () => {
                      const params = recents_params[conn.id];
                      if (conn.kind === "postgres" && params) {
                        void connect_direct(conn.name, "postgres", {
                          ...params,
                          kind: "postgres",
                        });
                      } else {
                        void reopenRecent(conn);
                      }
                    })}
                    className={cn(
                      "hover:bg-accent w-full justify-start gap-2 rounded-md px-2 py-2 text-left font-normal",
                      selected === `recent:${conn.id}` && "bg-accent",
                    )}
                  >
                    <DBIcon className="text-muted-foreground size-4 shrink-0" />
                    <span className="truncate font-medium">{conn.name}</span>
                    <ConnFlags conn={conn} />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Collapse>
      <ConnectingDialog target={connecting_to} />
      <PasswordPrompt
        name={prompt?.name ?? null}
        onCancel={() => setPrompt(null)}
        onSubmit={async (password) => {
          if (!prompt) return;
          await connectSaved(prompt.kind, prompt.params, password);
          setPrompt(null);
        }}
      />
    </div>
  );
}
