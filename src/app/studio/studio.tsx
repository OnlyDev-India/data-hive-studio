import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AlertTriangle } from "lucide-react";
import { LeftPanelSlot } from "./left-panel";
import {
  getActivity,
  serversReleaseConnection,
  type ActivityEntry
} from "@/shared/api";
import { WEB } from "@/shared/api/web";
import { bootstrapWorkspaceRestore, useStudioStore } from "@/shared/store";
import { useShortcuts } from "@/shared/hooks/use-shortcut";
import { ActivityBar } from "./activity-bar";
import { ActionBar } from "./action-bar";
import { Landing } from "@/features/connections";
import { NotificationToast } from "@/features/notifications";
import { AdminConsole } from "@/features/sharing";
import { Sidebar } from "@/features/workspace";
import { CommandPalette } from "./command-palette";
import { LeaveConfirm } from "@/web/LeaveConfirm";
import { DisconnectDialog } from "@/shared/components/disconnect-dialog";

/** Per-connection workspaces are code-split away from the shell. */
const Workspace = lazy(() => import("./workspace"));

export function Studio() {
  const open = useStudioStore((s) => s.open);
  const activeId = useStudioStore((s) => s.activeId);
  const view = useStudioStore((s) => s.view);
  const setView = useStudioStore((s) => s.setView);
  const setActive = useStudioStore((s) => s.setActive);
  const leftPanelOpen = useStudioStore((s) => s.leftPanelOpen);
  const leftPanelMode = useStudioStore((s) => s.leftPanelMode);
  const sidebarWidth = useStudioStore((s) => s.sidebarWidth);

  // Web mode: intercept reload shortcuts with an in-app confirm dialog while
  // at least one server session is connected. No native beforeunload popup —
  // browsers can't render custom UI on tab close, so only interceptable
  // leave paths (Cmd/Ctrl+R, Shift variants, F5) show the dialog.
  const [leave_open, set_leave_open] = useState(false);
  const connected = useStudioStore((s) => s.open.length > 0);
  useShortcuts(
    [
      { key: "r", mod: true, stopPropagation: true, handler: () => set_leave_open(true) },
      { key: "F5", stopPropagation: true, handler: () => set_leave_open(true) },
    ],
    { enabled: WEB && connected, capture: true },
  );

  // Web mode: release server-side connection pools when the page unloads
  // (tab close, navigation) so the server frees resources immediately instead
  // of waiting for the idle timeout. Use keepalive fire-and-forget requests —
  // we can't await in beforeunload.
  useEffect(() => {
    if (!WEB) return;
    const release = () => {
      const openConns = useStudioStore.getState().open;
      for (const c of openConns) {
        if (!c.id.startsWith("srv:")) continue;
        const parts = c.id.split(":");
        if (parts.length !== 3) continue;
        const [, profileId, remoteId] = parts;
        if (!profileId || !remoteId) continue;
        try {
          serversReleaseConnection(profileId, remoteId);
        } catch {
          /* best-effort on unload */
        }
      }
    };
    window.addEventListener("pagehide", release);
    window.addEventListener("beforeunload", release);
    return () => {
      window.removeEventListener("pagehide", release);
      window.removeEventListener("beforeunload", release);
    };
  }, []);

  // Load saved connections (+ their keychain passwords) once at startup,
  // migrating any pre-keychain localStorage data on first run. See
  // hydrateSavedLocal's doc comment.
  useEffect(() => {
    void useStudioStore.getState().hydrateSavedLocal();
  }, []);

  // Warm the per-connection workspace chunk as soon as the shell mounts —
  // filling in a connection form and waiting on the connect round-trip
  // easily takes longer than this chunk takes to fetch, so by the time
  // `open` actually gains an entry the dynamic import below has already
  // resolved and Suspense renders it inline with no fallback flash (which
  // would otherwise blank out the sidebar/activity bar for a moment, since
  // they're mounted inside Workspace for the connected-view branch).
  useEffect(() => {
    void import("./workspace");
  }, []);

  // Load the previous session's saved workspace (open connections' tabs,
  // layout, unsaved query text) once at startup — connections are NOT
  // auto-reconnected; this only stages the tabs/text to be restored the
  // moment the user manually reconnects to a matching target (openConn
  // claims it). See workspace-persistence.ts.
  useEffect(() => {
    void bootstrapWorkspaceRestore();
  }, []);

  // "Open with DH Studio" / double-clicking a .db file with it set as the
  // default app (tauri.conf.json's bundle.fileAssociations). Two delivery
  // paths, both handled: a live event for while the app is already running,
  // and a one-shot buffered fetch for cold start — the live event can fire
  // (Rust-side) before this listener has mounted, so it'd otherwise be lost.
  // Desktop-only; web mode has no OS file-open concept.
  useEffect(() => {
    if (WEB) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const [{ listen }, { openFileFromOs }, { invoke }] = await Promise.all([
        import("@tauri-apps/api/event"),
        import("@/features/connections/lib/reopen"),
        import("@tauri-apps/api/core"),
      ]);
      const un = await listen<string>("file-associations://open", (e) => {
        void openFileFromOs(e.payload);
      });
      if (cancelled) {
        un();
        return;
      }
      unlisten = un;
      try {
        const pending = await invoke<string | null>("take_pending_open_path");
        if (pending && !cancelled) void openFileFromOs(pending);
      } catch {
        /* backend not ready yet */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
      unlisten = null;
    };
  }, []);

  // Native menu bar (src-tauri/src/app_menu.rs): dispatch clicks into the
  // store, and keep the File menu's connection-only items enabled only
  // while a connection's workspace is actually showing — matches the
  // in-app dropdown's behavior of only offering those from within a
  // connection, not the Home screen. Desktop-only.
  useEffect(() => {
    if (WEB) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const [{ listen }, { handleMenuAction }] = await Promise.all([
        import("@tauri-apps/api/event"),
        import("./native-menu"),
      ]);
      const un = await listen<string>("menu-action", (e) => {
        handleMenuAction(e.payload);
      });
      if (cancelled) {
        un();
        return;
      }
      unlisten = un;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
      unlisten = null;
    };
  }, []);
  useEffect(() => {
    if (WEB) return;
    void import("./native-menu").then(({ syncMenuContext }) =>
      syncMenuContext(view === "workspace" && open.length > 0),
    );
  }, [view, open.length]);

  // Hydrate the backend command log once, then live-subscribe to new entries.
  // Mounted at the shell level so the feed runs regardless of which view or
  // connection is active.
  useEffect(() => {
    if (WEB) {
      // Web mode: no Tauri event stream — just load the initial activity snapshot.
      void (async () => {
        try {
          const entries = await getActivity(500);
          useStudioStore.getState().setActivity(entries);
        } catch {
          /* backend not ready */
        }
      })();
      return;
    }

    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const un = await listen<ActivityEntry>("activity://entry", (e) => {
        useStudioStore.getState().pushActivity(e.payload);
      });
      if (cancelled) {
        un();
        return;
      }
      unlisten = un;
      try {
        const entries = await getActivity(500);
        if (!cancelled) useStudioStore.getState().setActivity(entries);
      } catch {
        /* backend not ready yet */
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
      unlisten = null;
    };
  }, []);

  // The left edge holds ONE panel slot; the activity bar's icons just pick
  // which mode it shows (see `selectLeftPanel`/`openLeftPanel` in the
  // store) — open/closed behaves identically no matter which mode that is.
  const on_home = useCallback(() => {
    const s = useStudioStore.getState();
    if (view === "home") {
      s.selectLeftPanel("tables");
      return;
    }
    setView("home");
    s.openLeftPanel("tables");
  }, [view, setView]);

  const show_tables = useCallback(() => {
    const s = useStudioStore.getState();
    if (view !== "workspace") {
      setView("workspace");
      s.openLeftPanel("tables");
      return;
    }
    s.selectLeftPanel("tables");
  }, [view, setView]);

  const show_activity = useCallback(() => {
    const s = useStudioStore.getState();
    // From the landing page, Activity navigates INTO the studio (same
    // semantics as the Tables button) with the feed panel open.
    if (view !== "workspace") {
      setView("workspace");
      s.openLeftPanel("activity");
      return;
    }
    s.selectLeftPanel("activity");
  }, [view, setView]);

  const noop = useCallback(() => {}, []);
  const open_table_noop = useCallback(() => {}, []);

  const active_conn =
    open.length === 0 ? null : (open.find((c) => c.id === activeId) ?? open[0]);
  // The admin page exists only while an admin-scoped session is live;
  // otherwise the shell falls back to the landing view.
  const admin_available = useStudioStore((s) =>
    Object.values(s.serverSessions).some((x) => x.me.is_admin),
  );
  const effective_view = view === "admin" && !admin_available ? "home" : view;
  const landing = effective_view === "home";
  const show_admin = effective_view === "admin";

  return (
    <div className="bg-muted/20 flex h-full flex-col overflow-hidden border-t">
      <WebWarningBanner />
      <div className="flex min-h-0 flex-1">
        {open.length === 0 && !show_admin ? (
          <>
            <ActivityBar
              home_active={landing}
              tables_active={!landing && leftPanelOpen && leftPanelMode === "tables"}
              activity_active={leftPanelOpen && leftPanelMode === "activity"}
              actions_disabled
              on_home={on_home}
              on_tables={show_tables}
              on_new_table={noop}
              on_sql={noop}
              on_activity={show_activity}
            />
            <LeftPanelSlot open={leftPanelOpen} width={sidebarWidth}>
              {/* No connection open → the feed shows EVERYTHING (including
                  failed connect attempts, whose ids match no connection). */}
              <Sidebar
                conn_id=""
                tables={null}
                active_table={null}
                on_open_table={open_table_noop}
                show_table_tools={false}
                on_refresh={noop}
                mode={leftPanelMode}
              />
            </LeftPanelSlot>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <Landing />
            </div>
          </>
        ) : show_admin ? (
          <>
            <ActivityBar
              home_active={false}
              tables_active={false}
              activity_active={false}
              actions_disabled
              on_home={on_home}
              on_tables={show_tables}
              on_new_table={noop}
              on_sql={noop}
              on_activity={show_activity}
            />
            <AdminConsole />
          </>
        ) : (
          open.map((conn) => {
            const is_active = conn.id === active_conn!.id;
            return (
              <div
                key={conn.id}
                className={is_active ? "flex h-full w-full" : "hidden"}
              >
                <Suspense fallback={<WorkspaceFallback />}>
                  <Workspace
                    conn={conn}
                    conns={open}
                    active_conn_id={active_conn!.id}
                    on_switch_conn={setActive}
                    landing={landing}
                    on_home={on_home}
                    on_tables={show_tables}
                    on_activity={show_activity}
                  />
                </Suspense>
              </div>
            );
          })
        )}
      </div>
      <ActionBar />
      <CommandPalette />
      <DisconnectDialog />
      <NotificationToast />
      {WEB && <LeaveConfirm open={leave_open} onOpenChange={set_leave_open} />}
    </div>
  );
}

function WorkspaceFallback() {
  return (
    <div className="text-muted-foreground flex h-full w-full items-center justify-center text-sm select-none">
      Loading…
    </div>
  );
}

/** Deployment-level warning banner — only rendered in web mode when
 *  `VITE_WEB_WARNING` is set at build time. */
function WebWarningBanner() {
  const msg = useMemo(() => {
    if (!WEB) return "";
    return (import.meta.env.VITE_WEB_WARNING as string | undefined) ?? "";
  }, []);
  if (!msg) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-700">
      <AlertTriangle className="size-3.5 shrink-0" />
      <span>{msg}</span>
    </div>
  );
}
