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
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { WEB } from "@/shared/api/web";
import { connGuardOf } from "@/shared/api/client";
import { reopenRecent } from "@/features/connections";
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
  const save_local = useStudioStore((s) => s.saveLocal);
  const push_notification = useStudioStore((s) => s.pushNotification);
  const pins = useStudioStore((s) => s.pins);
  const toggle_pin = useStudioStore((s) => s.togglePin);
  const request_prefill = useStudioStore((s) => s.requestLandingPrefill);
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

  /** On the web a connection saved without its password has nothing to
   *  connect with yet: a double-click fills the form and the person types the
   *  password (kept in memory only). Everywhere else it connects at once. */
  const can_connect_now = (p: { password?: string }) => !WEB || !!p.password;

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

  /** `<name> copy`, `<name> copy 2`, … — same numbered-suffix convention
   *  used for duplicating a table/collection (see `uniqueCopyName` in the
   *  catalog tree). */
  const duplicate_saved = async (
    name: string,
    kind: SavedConnParams["kind"],
    params: SavedConnParams,
  ) => {
    let target = `${name} copy`;
    let i = 2;
    while (target in saved_local) {
      target = `${name} copy ${i}`;
      i += 1;
    }
    await save_local(target, { ...params, kind, name: target });
    push_notification({
      kind: "success",
      title: "Connection duplicated",
      detail: target,
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
          kind,
          source: WEB ? "browser" : "local",
          connect_title: "Double-click to connect",
          guard: connGuardOf(params),
          on_click: () => request_prefill(kind, { ...params }),
          on_double_click: () =>
            request_prefill(kind, { ...params }, can_connect_now(params)),
        });
      }
    }
    return out;
  }, [pins, saved_local, home_query, request_prefill]);

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
                  <Button
                    variant="ghost"
                    title={entry.connect_title}
                    onClick={entry.on_click}
                    onDoubleClick={entry.on_double_click}
                    className="hover:bg-accent group w-full justify-start gap-2 rounded-md px-2 py-2 text-left font-normal"
                  >
                    {DBIcon && <DBIcon className="size-4 shrink-0" />}
                    <span className="truncate font-medium">{entry.label}</span>
                    {entry.guard && <ConnFlags conn={entry.guard} />}
                    <span className="text-muted-foreground text-3xs ml-auto shrink-0 uppercase">
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
                  title="Load into the connect form"
                  onClick={() => request_prefill(kind, { ...params })}
                  onDoubleClick={() =>
                    request_prefill(kind, { ...params }, can_connect_now(params))
                  }
                  className="hover:bg-accent group w-full justify-start gap-2 rounded-md px-2 py-2 text-left font-normal"
                >
                  <DBIcon className="text-muted-foreground size-4 shrink-0" />
                  <span className="truncate font-medium">{name}</span>
                  <ConnFlags conn={params} />
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
              );
              return (
                <li key={name}>
                  <ContextMenu>
                    <ContextMenuTrigger className="contents">
                      {row_button}
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-52">
                      <ContextMenuItem
                        onSelect={() =>
                          request_prefill(
                            kind,
                            { ...params },
                            can_connect_now(params),
                          )
                        }
                      >
                        <Plug className="size-3.5" />
                        Open Connection
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => void copy_saved_name(name)}
                      >
                        <Copy className="size-3.5" />
                        Copy Name
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() =>
                          request_prefill(kind, { ...params }, false, {
                            oldName: name,
                            name,
                          })
                        }
                      >
                        <Pencil className="size-3.5" />
                        Edit Connection
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() =>
                          void duplicate_saved(name, kind, params)
                        }
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
                          ...connGuardOf(conn),
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
                          can_connect_now(params),
                        );
                      } else {
                        void reopenRecent(conn);
                      }
                    }}
                    className="hover:bg-accent w-full justify-start gap-2 rounded-md px-2 py-2 text-left font-normal"
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
    </div>
  );
}
