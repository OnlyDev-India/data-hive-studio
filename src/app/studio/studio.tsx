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
  closeConnection,
  getActivity,
  serversReleaseConnection,
  type ActivityEntry,
} from "@/shared/api";
import { WEB } from "@/shared/api/web";
import { useStudioStore } from "@/shared/store";
import { ActivityBar } from "./activity-bar";
import { ActionBar } from "./action-bar";
import { Landing } from "@/features/connections";
import { NotificationToast } from "@/features/notifications";
import { AdminConsole } from "@/features/sharing";
import { Sidebar } from "@/features/workspace";
import { LeaveConfirm } from "@/web/LeaveConfirm";

/** Per-connection workspaces are code-split away from the shell. */
const Workspace = lazy(() => import("./workspace"));

export function Studio() {
  const open = useStudioStore((s) => s.open);
  const activeId = useStudioStore((s) => s.activeId);
  const view = useStudioStore((s) => s.view);
  const setView = useStudioStore((s) => s.setView);
  const setActive = useStudioStore((s) => s.setActive);
  const sidebarOpen = useStudioStore((s) => s.sidebarOpen);
  const sidebarWidth = useStudioStore((s) => s.sidebarWidth);
  const activityOpen = useStudioStore((s) => s.activityOpen);

  // Web mode: intercept reload shortcuts with an in-app confirm dialog while
  // at least one server session is connected. No native beforeunload popup —
  // browsers can't render custom UI on tab close, so only interceptable
  // leave paths (Cmd/Ctrl+R, Shift variants, F5) show the dialog.
  const [leave_open, set_leave_open] = useState(false);
  useEffect(() => {
    if (!WEB) return;
    const onKey = (e: KeyboardEvent) => {
      const connected = useStudioStore.getState().open.length > 0;
      if (!connected) return;
      const key = e.key.toLowerCase();
      const mod = e.metaKey || e.ctrlKey;
      const is_reload = (mod && key === "r") || e.key === "F5";
      if (!is_reload) return;
      e.preventDefault();
      e.stopPropagation();
      set_leave_open(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

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

  // The left edge holds ONE panel slot with two contents: the database
  // sidebar and the Activity feed. Rules:
  //   • switching database <-> activity KEEPS an open panel open (it swaps)
  //   • if the slot is closed, either button OPENS it
  //   • clicking the button whose panel is showing AGAIN closes the slot
  const on_home = useCallback(() => {
    const s = useStudioStore.getState();
    s.setActivityOpen(false);
    if (view === "home") {
      s.setSidebarOpen(!s.sidebarOpen);
      return;
    }
    setView("home");
    s.setSidebarOpen(true);
  }, [view, setView]);

  const show_tables = useCallback(() => {
    const s = useStudioStore.getState();
    if (view !== "workspace") {
      s.setActivityOpen(false);
      setView("workspace");
      s.setSidebarOpen(true);
      return;
    }
    const was_showing_activity = s.activityOpen;
    s.setActivityOpen(false);
    s.setSidebarOpen(was_showing_activity ? true : !s.sidebarOpen);
  }, [view, setView]);

  const show_activity = useCallback(() => {
    const s = useStudioStore.getState();
    // From the landing page, Activity navigates INTO the studio (same
    // semantics as the Tables button) with the feed panel open.
    if (view !== "workspace") {
      s.setActivityOpen(true);
      s.setSidebarOpen(false);
      setView("workspace");
      return;
    }
    if (s.activityOpen) {
      // Active button clicked again — close the whole panel slot.
      s.setActivityOpen(false);
      s.setSidebarOpen(false);
      return;
    }
    s.setActivityOpen(true);
    s.setSidebarOpen(false);
  }, [view, setView]);

  /** Fully collapse the panel slot (X button / explicit close). */
  const close_panel = useCallback(() => {
    useStudioStore.getState().setActivityOpen(false);
    useStudioStore.getState().setSidebarOpen(false);
  }, []);

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

  // Disconnect lives in the status bar's first section.
  const closeConn = useStudioStore((s) => s.closeConn);
  const disconnect_click = useCallback(() => {
    const c = active_conn;
    if (!c) return;
    void (async () => {
      await closeConnection(c.id);
      closeConn(c.id);
    })();
  }, [active_conn, closeConn]);

  return (
    <div className="bg-muted/20 flex h-screen flex-col overflow-hidden border-t">
      <WebWarningBanner />
      <div className="flex min-h-0 flex-1">
        {open.length === 0 && !show_admin ? (
          <>
            <ActivityBar
              home_active={landing}
              tables_active={!landing && !activityOpen}
              activity_active={activityOpen}
              actions_disabled
              on_home={on_home}
              on_tables={show_tables}
              on_new_table={noop}
              on_sql={noop}
              on_activity={show_activity}
            />
            <LeftPanelSlot
              open={activityOpen || sidebarOpen}
              width={sidebarWidth}
            >
              {/* No connection open → the feed shows EVERYTHING (including
                  failed connect attempts, whose ids match no connection). */}
              <Sidebar
                conn_id=""
                tables={null}
                active_table={null}
                on_open_table={open_table_noop}
                show_table_tools={false}
                on_refresh={noop}
                mode={activityOpen ? "activity" : "tables"}
                on_activity_close={close_panel}
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
      <ActionBar on_disconnect={disconnect_click} />
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
