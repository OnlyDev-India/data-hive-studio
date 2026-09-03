import type { StoreApi } from "zustand";
import type { GridFilter } from "@/shared/components/data-grid/types";
import { tabEquals, tabKey, type StudioTab } from "./tab-utils";
import type { StudioStore, WorkspaceTabs } from "./types";
import {
  addKeyToLeaf,
  allLeaves,
  emptyLeaf,
  findLeaf,
  findOwnerLeaf,
  insertSplit,
  newPaneId,
  removeKeyFromLayout,
  replaceNode,
  type PaneSplit,
} from "./pane-layout";

type SetState = StoreApi<StudioStore>["setState"];

export const DEFAULT_WORKSPACE: WorkspaceTabs = {
  tabs: [],
  active: null,
  nextSqlId: 0,
  nextNewTableId: 0,
  nextTableId: 0,
  nextMongoTabId: 0,
  paneModes: {},
  layout: emptyLeaf("root"),
  focusedPaneId: "root",
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

/** Insert `tab` (already added to `cur.tabs`) into the currently-focused
 *  pane, making it that pane's — and the workspace's — active tab. Every
 *  `open*` action funnels through this so new tabs land in whichever pane
 *  the user most recently interacted with. Falls back to the first leaf if
 *  `focusedPaneId` is somehow stale. */
function addTabToFocusedPane(
  cur: WorkspaceTabs,
  tab: StudioTab,
): WorkspaceTabs {
  const key = tabKey(tab);
  const focusedId = findLeaf(cur.layout, cur.focusedPaneId)
    ? cur.focusedPaneId
    : (allLeaves(cur.layout)[0]?.id ?? cur.focusedPaneId);
  return {
    ...cur,
    layout: addKeyToLeaf(cur.layout, focusedId, key),
    focusedPaneId: focusedId,
    active: tab,
  };
}

/** Make `tab` (which must already be present in `cur.tabs`) the active tab
 *  of whichever leaf currently owns it, and focus that leaf. Used by
 *  singleton-tab opens (Activity) that may already exist elsewhere. */
function focusExistingTab(cur: WorkspaceTabs, tab: StudioTab): WorkspaceTabs {
  const owner = findOwnerLeaf(cur.layout, tabKey(tab));
  if (!owner) return addTabToFocusedPane(cur, tab);
  return {
    ...cur,
    layout: addKeyToLeaf(cur.layout, owner.id, tabKey(tab)),
    focusedPaneId: owner.id,
    active: tab,
  };
}

/** Bulk-close helper behind "close all / to the left / to the right".
 *  `anchor` is the tab the action was invoked on (ignored for 'all'). For
 *  'left'/'right' this is scoped to the anchor's OWN pane (matches VS
 *  Code) — tabs in other split panes are untouched. 'all' resets the whole
 *  layout back to a single empty pane. */
function bulkCloseTabs(
  set: SetState,
  connId: string,
  anchor: StudioTab | null,
  side: "all" | "left" | "right",
) {
  set((state) => {
    const cur = state.workspaces[connId];
    if (!cur) return state;

    if (side === "all") {
      if (cur.tabs.length === 0) return state;
      return {
        workspaces: putWs(state.workspaces, connId, {
          ...cur,
          tabs: [],
          active: null,
          paneModes: {},
          layout: emptyLeaf("root"),
          focusedPaneId: "root",
        }),
      };
    }

    if (!anchor) return state;
    const owner = findOwnerLeaf(cur.layout, tabKey(anchor));
    if (!owner) return state;
    const anchorIdx = owner.tabKeys.indexOf(tabKey(anchor));
    if (anchorIdx < 0) return state;
    const keep = (i: number) =>
      side === "left" ? i >= anchorIdx : i <= anchorIdx;

    const keptKeys: string[] = [];
    const removedKeys: string[] = [];
    owner.tabKeys.forEach((k, i) => (keep(i) ? keptKeys : removedKeys).push(k));
    if (removedKeys.length === 0) return state;

    const activeTabKey =
      owner.activeTabKey && keptKeys.includes(owner.activeTabKey)
        ? owner.activeTabKey
        : tabKey(anchor);
    const layout = replaceNode(cur.layout, owner.id, (n) =>
      n.type === "leaf" ? { ...n, tabKeys: keptKeys, activeTabKey } : n,
    );
    const removedSet = new Set(removedKeys);
    const tabs = cur.tabs.filter((t) => !removedSet.has(tabKey(t)));
    const focusedLeaf = findLeaf(layout, cur.focusedPaneId);
    const active = focusedLeaf?.activeTabKey
      ? (tabs.find((t) => tabKey(t) === focusedLeaf.activeTabKey) ?? null)
      : cur.active && !removedSet.has(tabKey(cur.active))
        ? cur.active
        : null;
    const paneModes = { ...cur.paneModes };
    for (const k of removedKeys) delete paneModes[k];

    return {
      workspaces: putWs(state.workspaces, connId, {
        ...cur,
        tabs,
        active,
        layout,
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
): WorkspaceTabs {
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
  return addTabToFocusedPane(
    {
      ...cur,
      tabs: [...cur.tabs, tab],
      nextTableId: cur.nextTableId + 1,
      paneModes,
    },
    tab,
  );
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
            workspaces: putWs(
              state.workspaces,
              connId,
              focusExistingTab(cur, existing),
            ),
          };
        }
        const tab: StudioTab = { kind: "activity" };
        return {
          workspaces: putWs(
            state.workspaces,
            connId,
            addTabToFocusedPane({ ...cur, tabs: [...cur.tabs, tab] }, tab),
          ),
        };
      });
    },
    openSql(connId: string, seedText?: string, seedFileName?: string) {
      set((state) => {
        const cur = getWs(state.workspaces, connId);
        const tab: StudioTab = { kind: "sql", id: cur.nextSqlId };
        const next = addTabToFocusedPane(
          {
            ...cur,
            tabs: [...cur.tabs, tab],
            nextSqlId: cur.nextSqlId + 1,
          },
          tab,
        );
        return {
          workspaces: putWs(state.workspaces, connId, next),
          // Optional initial text for the new editor (e.g. pending edits
          // rendered as SQL, or a picked file's contents); the tab consumes
          // the seed on mount.
          ...(seedText !== undefined
            ? { sqlSeeds: { ...state.sqlSeeds, [tabKey(tab)]: seedText } }
            : {}),
          // Only set when the seed came from a real file — marks it as
          // already-saved instead of unsaved new work.
          ...(seedFileName !== undefined
            ? {
                seedFileNames: {
                  ...state.seedFileNames,
                  [tabKey(tab)]: seedFileName,
                },
              }
            : {}),
        };
      });
    },
    openMongo(connId: string, database: string, collection: string) {
      set((state) => {
        const cur = getWs(state.workspaces, connId);
        const tab: StudioTab = {
          kind: "mongo",
          conn_id: connId,
          database,
          collection,
          tabId: cur.nextMongoTabId,
        };
        return {
          workspaces: putWs(
            state.workspaces,
            connId,
            addTabToFocusedPane(
              {
                ...cur,
                tabs: [...cur.tabs, tab],
                nextMongoTabId: cur.nextMongoTabId + 1,
              },
              tab,
            ),
          ),
        };
      });
    },
    openNewTable(connId: string) {
      set((state) => {
        const cur = getWs(state.workspaces, connId);
        const tab: StudioTab = { kind: "new-table", id: cur.nextNewTableId };
        return {
          workspaces: putWs(
            state.workspaces,
            connId,
            addTabToFocusedPane(
              {
                ...cur,
                tabs: [...cur.tabs, tab],
                nextNewTableId: cur.nextNewTableId + 1,
              },
              tab,
            ),
          ),
        };
      });
    },
    /** MongoDB console per connection, one new tab each call (like SQL
     *  editors). `database` is the console's initial db context. */
    openMongoConsole(
      connId: string,
      database: string,
      seedText?: string,
      seedFileName?: string,
    ) {
      set((state) => {
        const cur = getWs(state.workspaces, connId);
        const tab: StudioTab = {
          kind: "mongo-console",
          conn_id: connId,
          database,
          id: cur.nextMongoTabId,
        };
        const next = addTabToFocusedPane(
          {
            ...cur,
            tabs: [...cur.tabs, tab],
            nextMongoTabId: cur.nextMongoTabId + 1,
          },
          tab,
        );
        return {
          workspaces: putWs(state.workspaces, connId, next),
          // Same one-shot seed mechanism as openSql (e.g. opening a picked
          // .js file); the tab consumes it on mount.
          ...(seedText !== undefined
            ? { sqlSeeds: { ...state.sqlSeeds, [tabKey(tab)]: seedText } }
            : {}),
          ...(seedFileName !== undefined
            ? {
                seedFileNames: {
                  ...state.seedFileNames,
                  [tabKey(tab)]: seedFileName,
                },
              }
            : {}),
        };
      });
    },
    selectTab(connId: string, paneId: string, tab: StudioTab) {
      set((state) => {
        const cur = state.workspaces[connId];
        if (!cur) return state;
        const layout = replaceNode(cur.layout, paneId, (n) =>
          n.type === "leaf" ? { ...n, activeTabKey: tabKey(tab) } : n,
        );
        return {
          workspaces: putWs(state.workspaces, connId, {
            ...cur,
            layout,
            focusedPaneId: paneId,
            active: tab,
          }),
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
        const key = tabKey(tab);
        const layout = removeKeyFromLayout(cur.layout, key, () =>
          emptyLeaf("root"),
        );
        const focusedPaneId = findLeaf(layout, cur.focusedPaneId)
          ? cur.focusedPaneId
          : (allLeaves(layout)[0]?.id ?? cur.focusedPaneId);
        const focusedLeaf = findLeaf(layout, focusedPaneId);
        const active = focusedLeaf?.activeTabKey
          ? (tabs.find((t) => tabKey(t) === focusedLeaf.activeTabKey) ?? null)
          : null;
        const paneModes = { ...cur.paneModes };
        delete paneModes[key];
        const sqlSeeds = { ...state.sqlSeeds };
        delete sqlSeeds[key];
        const seedFileNames = { ...state.seedFileNames };
        delete seedFileNames[key];
        return {
          workspaces: putWs(state.workspaces, connId, {
            ...cur,
            tabs,
            active,
            layout,
            focusedPaneId,
            paneModes,
          }),
          sqlSeeds,
          seedFileNames,
        };
      });
    },
    movePaneTab(
      connId: string,
      tab: StudioTab,
      toPaneId: string,
      toIndex: number,
    ) {
      set((state) => {
        const cur = state.workspaces[connId];
        if (!cur) return state;
        const key = tabKey(tab);
        const fromLeaf = findOwnerLeaf(cur.layout, key);
        if (!fromLeaf) return state;

        if (fromLeaf.id === toPaneId) {
          // Same-pane reorder — pure splice within this leaf's tabKeys.
          const from = fromLeaf.tabKeys.indexOf(key);
          if (from < 0) return state;
          const clamped = Math.max(
            0,
            Math.min(toIndex, fromLeaf.tabKeys.length - 1),
          );
          if (clamped === from) return state;
          const tabKeys = [...fromLeaf.tabKeys];
          const [moved] = tabKeys.splice(from, 1);
          tabKeys.splice(clamped, 0, moved);
          const layout = replaceNode(cur.layout, fromLeaf.id, (n) =>
            n.type === "leaf" ? { ...n, tabKeys } : n,
          );
          return {
            workspaces: putWs(state.workspaces, connId, {
              ...cur,
              layout,
              focusedPaneId: fromLeaf.id,
              active: tab,
            }),
          };
        }

        // Cross-pane relocate — remove from source, insert into target.
        const removed = removeKeyFromLayout(cur.layout, key, () =>
          emptyLeaf("root"),
        );
        const targetLeaf = findLeaf(removed, toPaneId);
        if (!targetLeaf) return state;
        const clamped = Math.max(
          0,
          Math.min(toIndex, targetLeaf.tabKeys.length),
        );
        const tabKeys = [...targetLeaf.tabKeys];
        tabKeys.splice(clamped, 0, key);
        const layout = replaceNode(removed, toPaneId, (n) =>
          n.type === "leaf" ? { ...n, tabKeys, activeTabKey: key } : n,
        );
        return {
          workspaces: putWs(state.workspaces, connId, {
            ...cur,
            layout,
            focusedPaneId: toPaneId,
            active: tab,
          }),
        };
      });
    },
    splitPane(
      connId: string,
      targetPaneId: string,
      tab: StudioTab,
      edge: "left" | "right" | "top" | "bottom",
    ) {
      set((state) => {
        const cur = state.workspaces[connId];
        if (!cur) return state;
        const key = tabKey(tab);
        const targetLeaf = findLeaf(cur.layout, targetPaneId);
        if (!targetLeaf) return state;
        // Splitting a pane using its own only tab is meaningless.
        if (targetLeaf.tabKeys.length === 1 && targetLeaf.tabKeys[0] === key) {
          return state;
        }
        const direction: PaneSplit["direction"] =
          edge === "left" || edge === "right" ? "horizontal" : "vertical";
        const before = edge === "left" || edge === "top";
        const newLeafId = newPaneId();
        // Remove the tab from its CURRENT owner first — which may be
        // `targetLeaf` itself (self-split, or a tab a live cross-pane
        // strip-hover already relocated into this pane before the user
        // reached an edge). Doing this before inserting the split avoids
        // a transient state where the key exists in two leaves at once:
        // inserting first and removing after depends on which leaf a
        // depth-first search happens to visit first, which silently
        // undid "left"/"top" splits (the brand-new leaf sorts first in
        // that case, so it lost its only tab immediately).
        const withoutKey = removeKeyFromLayout(cur.layout, key, () =>
          emptyLeaf("root"),
        );
        const layout = insertSplit(
          withoutKey,
          targetPaneId,
          { type: "leaf", id: newLeafId, tabKeys: [key], activeTabKey: key },
          direction,
          before,
        );
        return {
          workspaces: putWs(state.workspaces, connId, {
            ...cur,
            layout,
            focusedPaneId: newLeafId,
            active: tab,
          }),
        };
      });
    },
    focusPane(connId: string, paneId: string) {
      set((state) => {
        const cur = state.workspaces[connId];
        if (!cur) return state;
        const leaf = findLeaf(cur.layout, paneId);
        if (!leaf) return state;
        const active = leaf.activeTabKey
          ? (cur.tabs.find((t) => tabKey(t) === leaf.activeTabKey) ?? null)
          : null;
        return {
          workspaces: putWs(state.workspaces, connId, {
            ...cur,
            focusedPaneId: paneId,
            active,
          }),
        };
      });
    },
    resizeSplit(connId: string, splitId: string, sizes: number[]) {
      set((state) => {
        const cur = state.workspaces[connId];
        if (!cur) return state;
        const layout = replaceNode(cur.layout, splitId, (n) =>
          n.type === "split" ? { ...n, sizes } : n,
        );
        if (layout === cur.layout) return state;
        return {
          workspaces: putWs(state.workspaces, connId, { ...cur, layout }),
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
