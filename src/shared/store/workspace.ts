import type { StoreApi } from "zustand";
import type { GridFilter } from "@/shared/components/data-grid/types";
import { tabEquals, tabKey, type StudioTab } from "./tab-utils";
import type { StudioStore, WorkspaceTabs } from "./types";

type SetState = StoreApi<StudioStore>["setState"];

export const DEFAULT_WORKSPACE: WorkspaceTabs = {
  tabs: [{ kind: "sql", id: 0 }],
  active: { kind: "sql", id: 0 },
  nextSqlId: 1,
  nextNewTableId: 0,
  nextTableId: 0,
  paneModes: {},
};

const getWs = (
  workspaces: Record<string, WorkspaceTabs>,
  connId: string,
): WorkspaceTabs => workspaces[connId] ?? DEFAULT_WORKSPACE;

const putWs = (
  workspaces: Record<string, WorkspaceTabs>,
  connId: string,
  next: WorkspaceTabs,
): Record<string, WorkspaceTabs> => ({ ...workspaces, [connId]: next });

/** Bulk-close helper behind "close all / to the left / to the right".
 *  `anchor` is the tab the action was invoked on (ignored for 'all'). The
 *  anchor itself always survives for left/right; if the active tab was
 *  closed it falls back to that anchor. Pane modes of closed tabs go too. */
function bulkCloseTabs(
  set: SetState,
  connId: string,
  anchor: StudioTab | null,
  side: "all" | "left" | "right",
) {
  set((state) => {
    const cur = state.workspaces[connId];
    if (!cur) return state;
    const anchorIdx = anchor
      ? cur.tabs.findIndex((t) => tabEquals(t, anchor))
      : -1;
    if (side !== "all" && anchorIdx < 0) return state;
    const keep = (i: number) =>
      side === "all"
        ? false
        : side === "left"
          ? i >= anchorIdx
          : i <= anchorIdx;

    const kept: StudioTab[] = [];
    cur.tabs.forEach((t, i) => {
      if (keep(i)) kept.push(t);
    });
    if (kept.length === cur.tabs.length) return state;

    // Fall back to the anchor (it always survives left/right) when the
    // active tab was among the closed ones.
    let active = cur.active;
    if (!active || !kept.some((t) => tabEquals(t, active))) {
      active =
        side !== "all" && anchor
          ? (kept.find((t) => tabEquals(t, anchor)) ?? null)
          : null;
    }

    const paneModes: typeof cur.paneModes = {};
    for (const t of kept) paneModes[tabKey(t)] = cur.paneModes[tabKey(t)];
    return {
      workspaces: putWs(state.workspaces, connId, {
        ...cur,
        tabs: kept,
        active,
        paneModes,
      }),
    };
  });
}

// Every open request creates a fresh tab instance, so the same table can be
// open in several tabs at once (each with its own data/schema mode).
function withNewTableTab(
  cur: WorkspaceTabs,
  name: string,
  mode?: "data" | "schema",
  initialFilters?: GridFilter[],
) {
  const tab: StudioTab = {
    kind: "table",
    name,
    tabId: cur.nextTableId,
    ...(initialFilters && initialFilters.length > 0 ? { initialFilters } : {}),
  };
  const paneModes =
    mode === undefined
      ? cur.paneModes
      : { ...cur.paneModes, [tabKey(tab)]: mode };
  return {
    ...cur,
    tabs: [...cur.tabs, tab],
    active: tab,
    nextTableId: cur.nextTableId + 1,
    paneModes,
  };
}

export function workspaceActions(set: SetState) {
  return {
    openTable(connId: string, name: string, initialFilters?: GridFilter[]) {
      set((state) => ({
        workspaces: putWs(
          state.workspaces,
          connId,
          withNewTableTab(
            getWs(state.workspaces, connId),
            name,
            undefined,
            initialFilters,
          ),
        ),
      }));
    },
    openStructure(connId: string, name: string) {
      set((state) => ({
        workspaces: putWs(
          state.workspaces,
          connId,
          withNewTableTab(getWs(state.workspaces, connId), name, "schema"),
        ),
      }));
    },
    /** Singleton Activity tab: focus it if present, else create + select. */
    openActivityTab(connId: string) {
      set((state) => {
        const cur = getWs(state.workspaces, connId);
        const existing = cur.tabs.find((t) => t.kind === "activity");
        if (existing) {
          return {
            workspaces: putWs(state.workspaces, connId, {
              ...cur,
              active: existing,
            }),
          };
        }
        const tab: StudioTab = { kind: "activity" };
        return {
          workspaces: putWs(state.workspaces, connId, {
            ...cur,
            tabs: [...cur.tabs, tab],
            active: tab,
          }),
        };
      });
    },
    openSql(connId: string, seedText?: string) {
      set((state) => {
        const cur = getWs(state.workspaces, connId);
        const tab: StudioTab = { kind: "sql", id: cur.nextSqlId };
        return {
          workspaces: putWs(state.workspaces, connId, {
            ...cur,
            tabs: [...cur.tabs, tab],
            active: tab,
            nextSqlId: cur.nextSqlId + 1,
          }),
          // Optional initial text for the new editor (e.g. pending edits
          // rendered as SQL); the tab consumes the seed on mount.
          ...(seedText !== undefined
            ? { sqlSeeds: { ...state.sqlSeeds, [tabKey(tab)]: seedText } }
            : {}),
        };
      });
    },
    openNewTable(connId: string) {
      set((state) => {
        const cur = getWs(state.workspaces, connId);
        const tab: StudioTab = { kind: "new-table", id: cur.nextNewTableId };
        return {
          workspaces: putWs(state.workspaces, connId, {
            ...cur,
            tabs: [...cur.tabs, tab],
            active: tab,
            nextNewTableId: cur.nextNewTableId + 1,
          }),
        };
      });
    },
    selectTab(connId: string, tab: StudioTab) {
      set((state) => {
        const cur = state.workspaces[connId];
        if (!cur) return state;
        return {
          workspaces: putWs(state.workspaces, connId, { ...cur, active: tab }),
        };
      });
    },
    closeTab(connId: string, tab: StudioTab) {
      set((state) => {
        const cur = state.workspaces[connId];
        if (!cur) return state;
        const idx = cur.tabs.findIndex((t) => tabEquals(t, tab));
        if (idx < 0) return state;
        const tabs = cur.tabs.filter((t) => !tabEquals(t, tab));
        let active = cur.active;
        if (active && tabEquals(active, tab)) {
          active =
            tabs.length === 0 ? null : tabs[Math.min(idx, tabs.length - 1)];
        }
        const paneModes = { ...cur.paneModes };
        delete paneModes[tabKey(tab)];
        const sqlSeeds = { ...state.sqlSeeds };
        delete sqlSeeds[tabKey(tab)];
        return {
          workspaces: putWs(state.workspaces, connId, {
            ...cur,
            tabs,
            active,
            paneModes,
          }),
          sqlSeeds,
        };
      });
    },
    moveTab(connId: string, tab: StudioTab, toIndex: number) {
      set((state) => {
        const cur = state.workspaces[connId];
        if (!cur) return state;
        const from = cur.tabs.findIndex((t) => tabEquals(t, tab));
        if (from < 0) return state;
        const clamped = Math.max(0, Math.min(toIndex, cur.tabs.length - 1));
        if (clamped === from) return state;
        const tabs = [...cur.tabs];
        const [moved] = tabs.splice(from, 1);
        tabs.splice(clamped, 0, moved);
        return {
          workspaces: putWs(state.workspaces, connId, { ...cur, tabs }),
        };
      });
    },
    closeAllTabs(connId: string) {
      bulkCloseTabs(set, connId, null, "all");
    },
    closeToLeft(connId: string, tab: StudioTab) {
      bulkCloseTabs(set, connId, tab, "left");
    },
    closeToRight(connId: string, tab: StudioTab) {
      bulkCloseTabs(set, connId, tab, "right");
    },
    setPaneMode(connId: string, tabKey: string, mode: "data" | "schema") {
      set((state) => {
        const cur = state.workspaces[connId];
        if (!cur) return state;
        return {
          workspaces: putWs(state.workspaces, connId, {
            ...cur,
            paneModes: { ...cur.paneModes, [tabKey]: mode },
          }),
        };
      });
    },
  };
}
