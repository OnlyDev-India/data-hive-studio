import { create, type StoreApi, type UseBoundStore } from "zustand";
import { persist } from "zustand/middleware";
import { activityActions } from "@/features/activity/store/activity-slice";
import { notificationsActions } from "@/features/notifications/store/notifications-slice";
import { schemaDesignerActions } from "@/features/schema-designer/store/schema-designer-slice";
import { sharingActions } from "@/features/sharing/store/sharing-slice";
import { connectionActions } from "./connections";
import type { SavedConnParams, StudioStore } from "./types";
import { workspaceActions } from "./workspace";

/** Monotonic id for landing prefill requests — never resets, so rapid
 *  consecutive sidebar clicks each get a distinct `n` (the prefill is
 *  cleared after applying, which would otherwise recycle counter values and
 *  make the landing form's dedupe drop the next click). */
let prefill_seq = 0;

export const useStudioStore: UseBoundStore<StoreApi<StudioStore>> =
  create<StudioStore>()(
    persist<StudioStore>(
      (set, get) => ({
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
        setSidebarOpen(open) {
          set({ sidebarOpen: open });
        },
        setSidebarWidth(px) {
          set({ sidebarWidth: px });
        },

        sidebarLastMode: "tables",
        toggleLeftPanel() {
          set((s) => {
            if (s.activityOpen) {
              return {
                activityOpen: false,
                sidebarOpen: false,
                sidebarLastMode: "activity",
              };
            }
            if (s.sidebarOpen) {
              return {
                activityOpen: false,
                sidebarOpen: false,
                sidebarLastMode: "tables",
              };
            }
            return s.sidebarLastMode === "activity"
              ? { activityOpen: true, sidebarOpen: false }
              : { activityOpen: false, sidebarOpen: true };
          });
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
        // Set alongside sqlSeeds only when the seed came from a real file
        // (openFileTab) — see the doc comment on the type.
        seedFileNames: {},

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

        ...activityActions(set),
        ...notificationsActions(set, get),
        ...schemaDesignerActions(set),
        ...sharingActions(set, get),
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
          sidebarLastMode: s.sidebarLastMode,
          rightSidebarWidth: s.rightSidebarWidth,
        }),
      },
    ),
  );
