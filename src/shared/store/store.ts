import { create, type StoreApi, type UseBoundStore } from "zustand";
import { persist } from "zustand/middleware";
import { activityActions } from "@/features/activity/store/activity-slice";
import { notificationsActions } from "@/features/notifications/store/notifications-slice";
import { schemaDesignerActions } from "@/features/schema-designer/store/schema-designer-slice";
import {
  deleteLocalConnection as apiDeleteLocalConnection,
  getLocalConnectionSecret,
  listLocalConnections,
  migrateLocalConnections,
  saveLocalConnection as apiSaveLocalConnection,
  updateLocalConnection as apiUpdateLocalConnection,
} from "@/shared/api/local-connections";
import { WEB } from "@/shared/api/web";
import {
  readWebConnections,
  withoutSecrets,
  writeWebConnections,
} from "@/shared/api/web-connections";
import { connectionActions } from "./connections";
import { DEFAULT_PALETTE_KEYWORDS } from "./types";
import { DEFAULT_DELIMITED_LIST_SETTINGS } from "@/shared/components/query-editor/delimited-list";
import type { SavedConnParams, StudioStore, WorkspaceTabs } from "./types";
import { tabKey } from "./tab-utils";
import { workspaceActions } from "./workspace";
import {
  loadPendingWorkspaceRestores,
  scheduleWorkspaceSave,
} from "./workspace-persistence";

/** Pre-keychain local-connection data, still readable for a one-time
 *  migration into the backend (see `hydrateSavedLocal`). Never written to
 *  anymore — purely a read path kept around as a safety net. Legacy
 *  `pg.saved`/`pg.pinned`/`mongo.saved` predate the unified `saved.local`
 *  key and default to their implied `kind` when missing. */
function readLegacySavedLocal(): Record<string, SavedConnParams> {
  try {
    const stored = localStorage.getItem("saved.local");
    if (stored) return JSON.parse(stored) as Record<string, SavedConnParams>;
  } catch {
    /* corrupt — fall through to legacy migration */
  }
  const merged: Record<string, SavedConnParams> = {};
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
      }
    }
  } catch {
    /* corrupt */
  }
  try {
    for (const [k, v] of Object.entries(
      JSON.parse(localStorage.getItem("mongo.saved") ?? "{}"),
    ) as [string, SavedConnParams][])
      merged[k] = v.kind ? v : { ...v, kind: "mongodb" };
  } catch {
    /* corrupt */
  }
  return merged;
}

/** Monotonic id for landing prefill requests — never resets, so rapid
 *  consecutive sidebar clicks each get a distinct `n` (the prefill is
 *  cleared after applying, which would otherwise recycle counter values and
 *  make the landing form's dedupe drop the next click). */
let prefill_seq = 0;

/** The currently focused tab's own composite `bottomPanelOpen` key, same
 *  format `jsonRows` already uses. Resolved fresh on every call (never
 *  cached) so global chrome always acts on whichever tab is active right
 *  now. `null` when there's no tab to act on — no active connection, or
 *  that connection's focused pane has no active tab — so callers can no-op
 *  instead of acting on a guessed key. */
function activeBottomPanelScope(
  activeId: string | null,
  workspaces: Record<string, WorkspaceTabs>,
): string | null {
  const active = activeId ? (workspaces[activeId]?.active ?? null) : null;
  return active ? `${activeId}\u0000${tabKey(active)}` : null;
}

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

        disconnectPendingId: null,
        setDisconnectPendingId(id) {
          set({ disconnectPendingId: id });
        },

        importTarget: null,
        openImport(target) {
          set({ importTarget: target });
        },
        closeImport() {
          set({ importTarget: null });
        },

        updateInfo: null,
        setUpdateInfo(info) {
          set((s) => ({
            updateInfo: info,
            // A failure belongs to the version it happened on.
            updateError:
              info && s.updateInfo?.version === info.version
                ? s.updateError
                : null,
          }));
        },
        updatePhase: "available",
        setUpdatePhase(phase) {
          set({ updatePhase: phase });
        },
        updateProgress: null,
        setUpdateProgress(progress) {
          set({ updateProgress: progress });
        },
        updateError: null,
        setUpdateError(error) {
          set({ updateError: error });
        },
        updateDialogOpen: false,
        setUpdateDialogOpen(open) {
          set({ updateDialogOpen: open });
        },

        paletteKeywords: DEFAULT_PALETTE_KEYWORDS,
        setPaletteKeyword(key, value) {
          set((s) => ({
            paletteKeywords: { ...s.paletteKeywords, [key]: value },
          }));
        },
        resetPaletteKeywords() {
          set({ paletteKeywords: DEFAULT_PALETTE_KEYWORDS });
        },

        shortcutOverrides: {},
        setShortcutOverride(id, binding) {
          set((s) => ({
            shortcutOverrides: { ...s.shortcutOverrides, [id]: binding },
          }));
        },
        resetShortcut(id) {
          set((s) => {
            const next = { ...s.shortcutOverrides };
            delete next[id];
            return { shortcutOverrides: next };
          });
        },
        resetAllShortcuts() {
          set({ shortcutOverrides: {} });
        },

        editorFontSize: 14,
        setEditorFontSize(px) {
          set({ editorFontSize: Math.max(10, Math.min(24, Math.round(px))) });
        },

        sqlFormatKeywordCase: "preserve",
        setSqlFormatKeywordCase(c) {
          set({ sqlFormatKeywordCase: c });
        },
        sqlFormatIndentWidth: 2,
        setSqlFormatIndentWidth(n) {
          set({ sqlFormatIndentWidth: n });
        },

        delimitedListSettings: DEFAULT_DELIMITED_LIST_SETTINGS,
        setDelimitedListSettings(s) {
          set({ delimitedListSettings: s });
        },

        dragTab: null,
        setDragTab(v) {
          set({ dragTab: v });
        },
        dragPointer: null,
        setDragPointer(v) {
          set({ dragPointer: v });
        },
        dropTarget: null,
        setDropTarget(v) {
          set({ dropTarget: v });
        },

        // ONE panel slot, one open/closed flag, one "what's inside it"
        // mode — the activity bar's icons just pick the mode; open/closed
        // behaves identically no matter which mode is showing, rather than
        // treating "tables" and "activity" as two separate panels each with
        // their own open flag. `leftPanelMode` doubles as its own memory of
        // "what was showing" — it doesn't get reset on close, so reopening
        // (via `toggleLeftPanelOpen`) always comes back to the same mode
        // without needing a separate "last mode" field.
        sidebarWidth: 256,
        leftPanelOpen: true,
        leftPanelMode: "tables",
        setLeftPanelOpen(open) {
          set({ leftPanelOpen: open });
        },
        setSidebarWidth(px) {
          set({ sidebarWidth: px });
        },
        /** Force the panel open showing `mode` — used where the intent is
         *  unconditionally "show me this", not "toggle this" (command
         *  palette entries, navigating into a fresh view). */
        openLeftPanel(mode) {
          set({ leftPanelOpen: true, leftPanelMode: mode });
        },
        /** Activity-bar icon click: switch to `mode` (opening if closed),
         *  or close if that exact mode is already showing. */
        selectLeftPanel(mode) {
          set((s) => ({
            leftPanelOpen: !(s.leftPanelOpen && s.leftPanelMode === mode),
            leftPanelMode: mode,
          }));
        },
        /** Generic open/closed toggle that doesn't touch which mode is
         *  selected (connection-tabs' collapse/expand button, the native
         *  menu's "Toggle Sidebar"). */
        toggleLeftPanelOpen() {
          set((s) => ({ leftPanelOpen: !s.leftPanelOpen }));
        },

        bottomPanelOpen: {},
        setBottomPanelOpenFor(scope, open) {
          set((s) => ({
            bottomPanelOpen: { ...s.bottomPanelOpen, [scope]: open },
          }));
        },
        setBottomPanelOpen(open) {
          set((s) => {
            const scope = activeBottomPanelScope(s.activeId, s.workspaces);
            if (!scope) return {};
            return {
              bottomPanelOpen: { ...s.bottomPanelOpen, [scope]: open },
            };
          });
        },
        toggleBottomPanel() {
          set((s) => {
            const scope = activeBottomPanelScope(s.activeId, s.workspaces);
            if (!scope) return {};
            return {
              bottomPanelOpen: {
                ...s.bottomPanelOpen,
                [scope]: !s.bottomPanelOpen[scope],
              },
            };
          });
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

        // Initial text for a newly opened SQL/Mongo-console tab (see
        // openSql/openMongoConsole) — AND, since sql-tab.tsx/
        // mongo-console-pane.tsx call `updateSqlSeed` on every edit, the
        // live mirror of each tab's current unsaved text. That's what makes
        // it possible to snapshot "what the user was typing" for
        // workspace-persistence.ts; entries are cleaned up when their tab
        // closes either way.
        sqlSeeds: {},
        updateSqlSeed(key, text) {
          set((s) => ({ sqlSeeds: { ...s.sqlSeeds, [key]: text } }));
        },
        // Set alongside sqlSeeds only when the seed came from a real file
        // (openFileTab) — see the doc comment on the type.
        seedFilePaths: {},

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
              // The web build never leaves a secret in `localStorage` unless a
              // saved connection asked for it (spec 0010, AC-4).
              const saved = WEB
                ? Object.fromEntries(
                    Object.entries(next).map(([id, p]) => [
                      id,
                      withoutSecrets(p),
                    ]),
                  )
                : next;
              localStorage.setItem("pg.recents", JSON.stringify(saved));
            } catch {
              // storage unavailable — recents stay session-only
            }
            return { recentParams: next };
          });
        },

        // Saved connections — ONE map for every kind, keyed by display
        // name. On the desktop, metadata lives in an app-data JSON file and
        // passwords in the OS keychain (src-tauri/src/local_connections.rs)
        // — see hydrateSavedLocal, called once at startup (Studio's mount
        // effect). Starts empty since Tauri IPC can't be awaited during
        // store creation. The web build keeps them in this browser's
        // localStorage instead (`web-connections.ts`), with the password
        // only for connections that ask to remember it.
        savedLocal: {},
        async hydrateSavedLocal() {
          if (WEB) {
            set({ savedLocal: readWebConnections() });
            return;
          }
          try {
            let metas = await listLocalConnections();
            if (metas.length === 0) {
              const legacy = Object.entries(readLegacySavedLocal());
              if (legacy.length > 0) {
                await migrateLocalConnections(
                  legacy.map(([key, v]) => ({ ...v, name: v.name ?? key })),
                );
                metas = await listLocalConnections();
              }
            }
            const next: Record<string, SavedConnParams> = {};
            for (const meta of metas) {
              let password = "";
              let ssh_password: string | undefined;
              let ssh_key_passphrase: string | undefined;
              let secret_missing: true | undefined;
              if (meta.remember_secret !== false)
                try {
                  const secret = await getLocalConnectionSecret(meta.name);
                  password = secret.password;
                  ssh_password = secret.ssh_password ?? undefined;
                  ssh_key_passphrase = secret.ssh_key_passphrase ?? undefined;
                } catch {
                  // Missing or unreadable (e.g. saved by a dev build): ask on connect.
                  secret_missing = true;
                }
              next[meta.name] = {
                ...meta,
                password,
                ssh_password,
                ssh_key_passphrase,
                secret_missing,
              };
            }
            set({ savedLocal: next });
          } catch {
            /* backend not ready yet — leave savedLocal empty rather than crash */
          }
        },
        async saveLocal(name, params) {
          if (WEB) {
            set((s) => {
              const next = { ...s.savedLocal, [name]: { ...params, name } };
              writeWebConnections(next);
              return { savedLocal: next };
            });
            return;
          }
          await apiSaveLocalConnection({ ...params, name });
          set((s) => ({
            savedLocal: { ...s.savedLocal, [name]: { ...params, name } },
          }));
        },
        async updateSavedLocal(oldName, name, params) {
          if (WEB) {
            set((s) => {
              const next = { ...s.savedLocal };
              delete next[oldName];
              next[name] = { ...params, name };
              writeWebConnections(next);
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
            return;
          }
          await apiUpdateLocalConnection(oldName, { ...params, name });
          set((s) => {
            const next = { ...s.savedLocal };
            delete next[oldName];
            next[name] = { ...params, name };
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
        async deleteSavedLocal(name) {
          if (WEB) {
            set((s) => {
              const next = { ...s.savedLocal };
              delete next[name];
              writeWebConnections(next);
              return {
                savedLocal: next,
                pins: s.pins.filter((p) => p !== `local:${name}`),
              };
            });
            return;
          }
          await apiDeleteLocalConnection(name);
          set((s) => {
            const next = { ...s.savedLocal };
            delete next[name];
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
        landingForm: null,
        clearLandingForm() {
          set({ landingForm: null });
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
        requestLandingForm(kind, params, edit) {
          set({ landingForm: { kind, params, n: ++prefill_seq, edit } });
        },

        ...activityActions(set),
        ...notificationsActions(set, get),
        ...schemaDesignerActions(set),
        ...connectionActions(set),
        ...workspaceActions(set),
      }),
      {
        name: "dh-studio-store",
        // zustand's default merge is a SHALLOW top-level merge — a persisted
        // `paletteKeywords` blob saved before a new keyword existed (e.g.
        // `diss`) would otherwise wholesale-replace the default object and
        // just be missing that key, not fall back to its default value.
        // Merge that one nested field explicitly so old persisted state
        // always survives new keywords being added later.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        merge: (persistedState, currentState): any => {
          const persisted = (persistedState ?? {}) as Partial<StudioStore>;
          return {
            ...currentState,
            ...persisted,
            paletteKeywords: {
              ...currentState.paletteKeywords,
              ...persisted.paletteKeywords,
            },
          };
        },
        // Only the recent list and sidebar chrome survive restarts (open
        // connections live in the Tauri backend and are tied to the process).
        // this is any because if only these properties are need.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        partialize: (s): any => ({
          recent: s.recent,
          leftPanelOpen: s.leftPanelOpen,
          leftPanelMode: s.leftPanelMode,
          sidebarWidth: s.sidebarWidth,
          paletteKeywords: s.paletteKeywords,
          shortcutOverrides: s.shortcutOverrides,
          editorFontSize: s.editorFontSize,
          sqlFormatKeywordCase: s.sqlFormatKeywordCase,
          sqlFormatIndentWidth: s.sqlFormatIndentWidth,
          delimitedListSettings: s.delimitedListSettings,
          showAppActivity: s.showAppActivity,
        }),
      },
    ),
  );

// Open connections/tabs/layout/editor-text are NOT part of the localStorage
// `persist` above (see the comment on `partialize`) — they're saved
// separately, to a Rust-owned JSON file (see workspace-persistence.ts),
// because unlike sidebar chrome or the recent-connections list, this can
// grow to real size (multiple tabs' worth of query text) and the app
// controls exactly when it's re-applied (only once the user reconnects to a
// matching target — never automatically). Debounced inside
// `scheduleWorkspaceSave` itself; this just fires on every store change.
useStudioStore.subscribe((state) => {
  scheduleWorkspaceSave(() => state);
});

/** Call once at startup (see studio.tsx) — loads the previous session's
 *  saved workspace snapshot into `pendingWorkspaceRestore`, where `openConn`
 *  will claim entries as matching connections are (manually) reopened. */
export async function bootstrapWorkspaceRestore(): Promise<void> {
  const byConn = await loadPendingWorkspaceRestores();
  if (Object.keys(byConn).length > 0) {
    useStudioStore.getState().setPendingWorkspaceRestore(byConn);
  }
}
