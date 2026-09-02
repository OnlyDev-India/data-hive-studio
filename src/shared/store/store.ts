import { create, type StoreApi, type UseBoundStore } from "zustand";
import { persist } from "zustand/middleware";
import {
  serversConnect as apiServersConnect,
  serversDisconnect as apiServersDisconnect,
  serversDeleteConnection as apiServersDeleteConnection,
  srvConnId,
} from "../api/client";
import { connectionActions } from "./connections";
import type {
  SavedConnParams,
  StudioNotification,
  StudioStore,
} from "./types";
import { workspaceActions } from "./workspace";

let notif_seq = 0;
/** Monotonic id for landing prefill requests — never resets, so rapid
 *  consecutive sidebar clicks each get a distinct `n` (the prefill is
 *  cleared after applying, which would otherwise recycle counter values and
 *  make the landing form's dedupe drop the next click). */
let prefill_seq = 0;

type ServerSessionPayload = Awaited<ReturnType<typeof apiServersConnect>>;

/** Normalize a server payload into session-connection entries keyed by the
 *  namespaced `srv:<profile>:<conn>` id. */
function mapSessionConns(profileId: string, session: ServerSessionPayload) {
  return session.connections.map((c) => ({
    id: srvConnId(profileId, c.id),
    name: c.name,
    host: c.host,
    port: c.port,
    user: c.user,
    database: c.database,
    ssl_mode: c.ssl_mode ?? null,
    data_access: c.data_access,
    can_edit: c.can_edit,
    can_delete: c.can_delete,
  }));
}

export const useStudioStore: UseBoundStore<StoreApi<StudioStore>> =
  create<StudioStore>()(
    persist<StudioStore>(
      (set) => ({
        open: [],
        activeId: null,
        recent: [],

        view: "home",
        setView(view) {
          set({ view });
        },

        commandPaletteOpen: false,
        setCommandPaletteOpen(open) {
          set({ commandPaletteOpen: open });
        },

        sidebarOpen: true,
        sidebarWidth: 256,
        toggleSidebar() {
          set((s) => ({ sidebarOpen: !s.sidebarOpen }));
        },
        setSidebarOpen(open) {
          set({ sidebarOpen: open });
        },
        setSidebarWidth(px) {
          set({ sidebarWidth: px });
        },

        rightSidebarOpen: false,
        rightSidebarWidth: 320,
        toggleRightSidebar() {
          set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen }));
        },
        setRightSidebarOpen(open) {
          set({ rightSidebarOpen: open });
        },
        setRightSidebarWidth(px) {
          set({ rightSidebarWidth: px });
        },
        jsonRows: {},
        setJsonRow(scope, row) {
          set((s) => ({ jsonRows: { ...s.jsonRows, [scope]: row } }));
        },

        workspaces: {},
        gridBridges: {},
        setGridBridge(key, bridge) {
          set((s) => ({ gridBridges: { ...s.gridBridges, [key]: bridge } }));
        },
        clearGridBridge(key) {
          set((s) => {
            const next = { ...s.gridBridges };
            delete next[key];
            return { gridBridges: next };
          });
        },

        mongoViews: {},
        setMongoView(key, view) {
          set((s) => ({
            mongoViews: { ...s.mongoViews, [key]: view },
          }));
        },

        schemaEdits: {},
        setSchemaEdit(key, handle) {
          set((s) => ({ schemaEdits: { ...s.schemaEdits, [key]: handle } }));
        },
        clearSchemaEdit(key) {
          set((s) => {
            const next = { ...s.schemaEdits };
            delete next[key];
            return { schemaEdits: next };
          });
        },

        schemaPanes: {},
        setSchemaPane(key, handle) {
          set((s) => ({ schemaPanes: { ...s.schemaPanes, [key]: handle } }));
        },
        clearSchemaPane(key) {
          set((s) => {
            const next = { ...s.schemaPanes };
            delete next[key];
            return { schemaPanes: next };
          });
        },

        newTables: {},
        setNewTable(key, handle) {
          set((s) => ({ newTables: { ...s.newTables, [key]: handle } }));
        },
        clearNewTable(key) {
          set((s) => {
            const next = { ...s.newTables };
            delete next[key];
            return { newTables: next };
          });
        },

        sqlTabs: {},
        setSqlTab(key, handle) {
          set((s) => ({ sqlTabs: { ...s.sqlTabs, [key]: handle } }));
        },
        clearSqlTab(key) {
          set((s) => {
            const next = { ...s.sqlTabs };
            delete next[key];
            return { sqlTabs: next };
          });
        },

        // One-shot initial text for a newly opened SQL tab (see openSql);
        // entries are cleaned up when their tab closes.
        sqlSeeds: {},

        recentParams: (() => {
          try {
            return JSON.parse(localStorage.getItem("pg.recents") ?? "{}");
          } catch {
            return {};
          }
        })(),
        pushRecentParams(connId, params) {
          set((s) => {
            const next = { ...s.recentParams, [connId]: params };
            try {
              localStorage.setItem("pg.recents", JSON.stringify(next));
            } catch {
              // storage unavailable — recents stay session-only
            }
            return { recentParams: next };
          });
        },

        // Saved (local) connections — ONE map for every kind, keyed by display
        // name ('saved.local'); `kind` records which DB it reopens. Legacy
        // 'pg.saved' / 'pg.pinned' / 'mongo.saved' data migrates in on first
        // load so nothing already saved is lost.
        savedLocal: (() => {
          try {
            const stored = localStorage.getItem("saved.local");
            if (stored)
              return JSON.parse(stored) as Record<string, SavedConnParams>;
          } catch {
            /* corrupt — fall through to legacy migration */
          }
          const merged: Record<string, SavedConnParams> = {};
          // Postgres saves from before the kind field — default to postgres.
          try {
            for (const [k, v] of Object.entries(
              JSON.parse(localStorage.getItem("pg.saved") ?? "{}"),
            ) as [string, SavedConnParams][])
              merged[k] = v.kind ? v : { ...v, kind: "postgres" };
          } catch {
            /* corrupt */
          }
          try {
            for (const [k, v] of Object.entries(
              JSON.parse(localStorage.getItem("pg.pinned") ?? "{}"),
            ) as [string, SavedConnParams][]) {
              if (k.startsWith("local:")) {
                merged[k.slice(6)] = v.kind ? v : { ...v, kind: "postgres" };
              } else {
                try {
                  const pins: string[] = JSON.parse(
                    localStorage.getItem("pg.pinIds") ?? "[]",
                  );
                  if (!pins.includes(k)) pins.push(k);
                  localStorage.setItem("pg.pinIds", JSON.stringify(pins));
                } catch {
                  /* storage unavailable */
                }
              }
            }
          } catch {
            /* corrupt */
          }
          // MongoDB saves — always kind "mongodb".
          try {
            for (const [k, v] of Object.entries(
              JSON.parse(localStorage.getItem("mongo.saved") ?? "{}"),
            ) as [string, SavedConnParams][])
              merged[k] = v.kind ? v : { ...v, kind: "mongodb" };
          } catch {
            /* corrupt */
          }
          if (Object.keys(merged).length) {
            try {
              localStorage.setItem("saved.local", JSON.stringify(merged));
            } catch {
              /* storage unavailable */
            }
          }
          return merged;
        })(),
        saveLocal(name, params) {
          set((s) => {
            const next = { ...s.savedLocal, [name]: { ...params, name } };
            try {
              localStorage.setItem("saved.local", JSON.stringify(next));
            } catch {
              /* storage unavailable */
            }
            return { savedLocal: next };
          });
        },
        updateSavedLocal(oldName, name, params) {
          set((s) => {
            const next = { ...s.savedLocal };
            delete next[oldName];
            next[name] = { ...params, name };
            try {
              localStorage.setItem("saved.local", JSON.stringify(next));
            } catch {
              /* storage unavailable */
            }
            let pin_next = s.pins;
            if (s.pins.includes(`local:${oldName}`)) {
              pin_next = s.pins.map((p) =>
                p === `local:${oldName}` ? `local:${name}` : p,
              );
              try {
                localStorage.setItem("pg.pinIds", JSON.stringify(pin_next));
              } catch {
                /* storage unavailable */
              }
            }
            return { savedLocal: next, pins: pin_next };
          });
        },
        deleteSavedLocal(name) {
          set((s) => {
            const next = { ...s.savedLocal };
            delete next[name];
            try {
              localStorage.setItem("saved.local", JSON.stringify(next));
            } catch {
              /* storage unavailable */
            }
            return {
              savedLocal: next,
              pins: s.pins.filter((p) => p !== `local:${name}`),
            };
          });
        },

        pins: (() => {
          try {
            return JSON.parse(localStorage.getItem("pg.pinIds") ?? "[]");
          } catch {
            return [];
          }
        })(),
        togglePin(id) {
          set((s) => {
            const next = s.pins.includes(id)
              ? s.pins.filter((p) => p !== id)
              : [...s.pins, id];
            try {
              localStorage.setItem("pg.pinIds", JSON.stringify(next));
            } catch {
              /* storage unavailable */
            }
            return { pins: next };
          });
        },
        landingPrefill: null,
        clearLandingPrefill() {
          set({ landingPrefill: null });
        },
        /** True while a Postgres connect is in flight — GLOBAL so navigating
         *  between home/studio can't lose the spinner or double-connect. */
        pgConnecting: false,
        setPgConnecting(v) {
          set({ pgConnecting: v });
        },
        /** True while a MongoDB connect is in flight — GLOBAL so navigating
         *  between home/studio can't lose the spinner or double-connect. */
        mongoConnecting: false,
        setMongoConnecting(v) {
          set({ mongoConnecting: v });
        },
        requestLandingPrefill(kind, params, connect = false, edit) {
          set(() => ({
            landingPrefill: {
              kind,
              params,
              n: ++prefill_seq,
              connect,
              edit,
            },
          }));
        },

        notifications: [],
        toastQueue: [],
        pushNotification(n) {
          const item = {
            id: `n${Date.now()}-${++notif_seq}`,
            at: Date.now(),
            read: false,
            ...n,
          };
          set((s) => ({
            notifications: [item, ...s.notifications].slice(0, 50),
            toastQueue: [...s.toastQueue, item],
          }));
        },
        dismissNotification(id) {
          set((s) => ({
            notifications: s.notifications.filter((x) => x.id !== id),
          }));
        },
        clearNotifications() {
          set({ notifications: [] });
        },
        markRead(id) {
          set((s) => ({
            notifications: s.notifications.map((n) =>
              n.id === id ? { ...n, read: true } : n,
            ),
          }));
        },
        markAllRead() {
          set((s) => ({
            notifications: s.notifications.map((n) => ({ ...n, read: true })),
          }));
        },
        unreadCount() {
          return useStudioStore
            .getState()
            .notifications.filter((n: StudioNotification) => !n.read).length;
        },
        dismissToast(id) {
          set((s) => ({ toastQueue: s.toastQueue.filter((x) => x.id !== id) }));
        },

        activityOpen: false,
        toggleActivityOpen() {
          set((s) => ({ activityOpen: !s.activityOpen }));
        },
        setActivityOpen(open) {
          set({ activityOpen: open });
        },
        // Backend caps the ring buffer at 500; the store mirrors that bound.
        activity: [],
        pushActivity(entry) {
          // Idempotent by id: a duplicated Tauri event (leaked listener, dev
          // remount) must never render the same command twice — identical ids
          // were also the "multiple selected rows" bug.
          set((s) =>
            s.activity.some((e) => e.id === entry.id)
              ? s
              : { activity: [entry, ...s.activity].slice(0, 500) },
          );
        },
        // Hydration merge: snapshot entries that were ALSO delivered live are
        // skipped (same id); live entries pushed before hydration finished are
        // newer than anything in the snapshot and stay on top.
        setActivity(entries) {
          set((s) => {
            const snap_ids = new Set(entries.map((e) => e.id));
            const live_only = s.activity.filter((e) => !snap_ids.has(e.id));
            return { activity: [...live_only, ...entries].slice(0, 500) };
          });
        },
        clearActivityEntries() {
          set({ activity: [] });
        },
        activityDetail: null,
        setActivityDetail(detail) {
          set({ activityDetail: detail });
        },

        serverSessions: {},
        serverBusy: false,
        /** Connect to a team server: fetch its shared-connection catalog into
         *  the session. Does NOT open anything — the landing sidebar lists
         *  what's shared and the user connects explicitly. */
        async connectServer(profileId) {
          set({ serverBusy: true });
          try {
            const session = await apiServersConnect(profileId);
            const conns = mapSessionConns(profileId, session);
            set((s) => {
              // Drop any stale tabs from a previous session of this profile.
              for (const c of conns) useStudioStore.getState().closeConn(c.id);
              return {
                serverSessions: {
                  ...s.serverSessions,
                  [profileId]: {
                    profile: session.profile,
                    me: session.me,
                    connIds: conns.map((c) => c.id),
                    connections: conns,
                  },
                },
              };
            });
          } finally {
            set({ serverBusy: false });
          }
        },

        /** Refresh every connected server's catalog in place — open tabs and
         *  workspaces stay untouched; new/removed shares reflect in lists. */
        async refreshServers() {
          const ids = Object.keys(useStudioStore.getState().serverSessions);
          if (ids.length === 0) return;
          set({ serverBusy: true });
          try {
            await Promise.all(
              ids.map(async (profileId) => {
                try {
                  const session = await apiServersConnect(profileId);
                  const conns = mapSessionConns(profileId, session);
                  set((s) => {
                    const cur = s.serverSessions[profileId];
                    if (!cur) return {};
                    return {
                      serverSessions: {
                        ...s.serverSessions,
                        [profileId]: {
                          ...cur,
                          profile: session.profile,
                          me: session.me,
                          connIds: conns.map((c) => c.id),
                          connections: conns,
                        },
                      },
                    };
                  });
                } catch {
                  // offline/unreachable — keep current catalog until next try
                }
              }),
            );
          } finally {
            set({ serverBusy: false });
          }
        },
        async disconnectServer(profileId) {
          await apiServersDisconnect(profileId);
          set((s) => {
            const sess = s.serverSessions[profileId];
            if (!sess) return {};
            for (const id of sess.connIds)
              useStudioStore.getState().closeConn(id);
            const next = { ...s.serverSessions };
            delete next[profileId];
            // Leaving the admin page when its session is gone.
            const still_admin = Object.values(next).some((x) => x.me.is_admin);
            if (s.view === "admin" && !still_admin)
              return { serverSessions: next, view: "home" };
            return { serverSessions: next };
          });
        },
        async deleteServerConnection(
          profileId: string,
          connId: string,
          srvId: string,
        ) {
          await apiServersDeleteConnection(profileId, connId);
          set((s) => {
            useStudioStore.getState().closeConn(srvId);
            const sess = s.serverSessions[profileId];
            if (!sess) return {};
            return {
              serverSessions: {
                ...s.serverSessions,
                [profileId]: {
                  ...sess,
                  connections: sess.connections.filter((c) => c.id !== connId),
                  connIds: sess.connIds.filter((id) => id !== srvId),
                },
              },
              pins: s.pins.filter((p) => p !== srvId),
            };
          });
          // Resync with the server so any drift (e.g. deletions from other
          // devices) also reflects immediately.
          void useStudioStore.getState().refreshServers();
        },

        ...connectionActions(set),
        ...workspaceActions(set),
      }),
      {
        name: "dh-studio-store",
        // Only the recent list and sidebar chrome survive restarts (open
        // connections live in the Tauri backend and are tied to the process).
        // this is any because if only these properties are need.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        partialize: (s): any => ({
          recent: s.recent,
          sidebarOpen: s.sidebarOpen,
          sidebarWidth: s.sidebarWidth,
          rightSidebarWidth: s.rightSidebarWidth,
        }),
      },
    ),
  );
