import { beforeEach, describe, expect, it } from "vitest";
import { tabKey, tabLabel, type StudioTab } from "../tab-utils";
import { emptyLeaf } from "../pane-layout";
import { stableConnKey, stampLegacySqlTabs } from "../workspace-persistence";
import { useStudioStore } from "../store";
import type { ConnectionInfo } from "../../api/types";
import type { SavedWorkspace, WorkspaceTabs } from "../types";

describe("sql tab key", () => {
  it("differs between connections that both have a tab with the same id", () => {
    const a: StudioTab = { kind: "sql", id: 0, conn_id: "conn-a" };
    const b: StudioTab = { kind: "sql", id: 0, conn_id: "conn-b" };

    expect(tabKey(a)).not.toBe(tabKey(b));
  });

  it("differs between tabs of one connection", () => {
    const first: StudioTab = { kind: "sql", id: 0, conn_id: "c" };
    const second: StudioTab = { kind: "sql", id: 1, conn_id: "c" };

    expect(tabKey(first)).not.toBe(tabKey(second));
  });
});

describe("sql tab label", () => {
  const tab: StudioTab = { kind: "sql", id: 3, conn_id: "c" };

  it("is sql@<database> for the database selected in the tab", () => {
    expect(tabLabel(tab, null, "shop")).toBe("sql@shop");
  });

  it("keeps the saved file name over the database", () => {
    expect(tabLabel(tab, "report.sql", "shop")).toBe("report.sql");
  });

  it("falls back to the numbered label until a database is known", () => {
    expect(tabLabel(tab)).toBe("SQL 4");
  });

  it("does not rename other tab kinds", () => {
    const table: StudioTab = { kind: "table", name: "users", tabId: 1 };

    expect(tabLabel(table, null, "shop")).toBe("users");
  });
});

describe("stampLegacySqlTabs", () => {
  function saved(): SavedWorkspace {
    const legacy: StudioTab = { kind: "sql", id: 0 };
    const table: StudioTab = { kind: "table", name: "users", tabId: 1 };
    const workspace = {
      tabs: [legacy, table],
      active: legacy,
      layout: {
        type: "split",
        id: "s",
        direction: "horizontal",
        sizes: [50, 50],
        children: [
          {
            type: "leaf",
            id: "l1",
            tabKeys: [tabKey(legacy)],
            activeTabKey: tabKey(legacy),
          },
          {
            type: "leaf",
            id: "l2",
            tabKeys: [tabKey(table)],
            activeTabKey: tabKey(table),
          },
        ],
      },
      focusedPaneId: "l1",
    } as unknown as WorkspaceTabs;
    return { workspace, sqlSeeds: { "sql:0": "select 1" } };
  }

  it("moves a legacy tab's key, layout entry and seed onto the connection", () => {
    const out = stampLegacySqlTabs(saved(), "conn-a");

    expect(out.workspace.tabs[0]).toEqual({
      kind: "sql",
      id: 0,
      conn_id: "conn-a",
    });
    expect(out.workspace.active).toBe(out.workspace.tabs[0]);
    const layout = out.workspace.layout;
    if (layout.type !== "split") throw new Error("expected a split");
    expect(layout.children[0]).toMatchObject({
      tabKeys: ["sql:conn-a:0"],
      activeTabKey: "sql:conn-a:0",
    });
    expect(out.sqlSeeds).toEqual({ "sql:conn-a:0": "select 1" });
  });

  it("gives two connections restoring the same legacy key different ones", () => {
    const a = stampLegacySqlTabs(saved(), "conn-a");
    const b = stampLegacySqlTabs(saved(), "conn-b");

    expect(Object.keys(a.sqlSeeds)).not.toEqual(Object.keys(b.sqlSeeds));
  });

  it("returns the same object when no tab needs it", () => {
    const already: SavedWorkspace = {
      workspace: {
        tabs: [{ kind: "sql", id: 0, conn_id: "x" }],
        active: null,
        layout: emptyLeaf("root"),
      } as unknown as WorkspaceTabs,
      sqlSeeds: {},
    };

    expect(stampLegacySqlTabs(already, "conn-a")).toBe(already);
  });
});

describe("stampLegacySqlTabs edge cases", () => {
  function leaf(keys: string[], active: string | null): WorkspaceTabs["layout"] {
    return { type: "leaf", id: "l", tabKeys: keys, activeTabKey: active };
  }
  function workspace(
    tabs: StudioTab[],
    active: StudioTab | null,
    layout: WorkspaceTabs["layout"],
  ): WorkspaceTabs {
    return { tabs, active, layout, focusedPaneId: "l" } as unknown as WorkspaceTabs;
  }

  it("keeps a non SQL active tab active and untouched", () => {
    const legacy: StudioTab = { kind: "sql", id: 0 };
    const table: StudioTab = { kind: "table", name: "users", tabId: 1 };
    const saved: SavedWorkspace = {
      workspace: workspace(
        [legacy, table],
        table,
        leaf([tabKey(legacy), tabKey(table)], tabKey(table)),
      ),
      sqlSeeds: {},
    };

    const out = stampLegacySqlTabs(saved, "conn-a");

    expect(out.workspace.active).toEqual(table);
    expect(out.workspace.tabs[1]).toEqual(table);
    expect(out.workspace.layout).toMatchObject({
      tabKeys: ["sql:conn-a:0", tabKey(table)],
      activeTabKey: tabKey(table),
    });
  });

  it("leaves a tab that already has a connection alone while stamping the others", () => {
    const owned: StudioTab = { kind: "sql", id: 0, conn_id: "conn-x" };
    const legacy: StudioTab = { kind: "sql", id: 1 };
    const saved: SavedWorkspace = {
      workspace: workspace(
        [owned, legacy],
        null,
        leaf([tabKey(owned), tabKey(legacy)], null),
      ),
      sqlSeeds: { "sql:conn-x:0": "select 'mine'", "sql:1": "select 'old'" },
    };

    const out = stampLegacySqlTabs(saved, "conn-a");

    expect(out.workspace.tabs).toEqual([
      owned,
      { kind: "sql", id: 1, conn_id: "conn-a" },
    ]);
    expect(out.sqlSeeds).toEqual({
      "sql:conn-x:0": "select 'mine'",
      "sql:conn-a:1": "select 'old'",
    });
  });

  it("keeps a pane that had no active tab without one", () => {
    const legacy: StudioTab = { kind: "sql", id: 0 };
    const saved: SavedWorkspace = {
      workspace: workspace([legacy], null, leaf([tabKey(legacy)], null)),
      sqlSeeds: {},
    };

    const out = stampLegacySqlTabs(saved, "conn-a");

    expect(out.workspace.active).toBeNull();
    expect(out.workspace.layout).toMatchObject({ activeTabKey: null });
  });

  it("does not change the saved object it was given", () => {
    const legacy: StudioTab = { kind: "sql", id: 0 };
    const saved: SavedWorkspace = {
      workspace: workspace([legacy], legacy, leaf([tabKey(legacy)], tabKey(legacy))),
      sqlSeeds: { "sql:0": "select 1" },
    };

    stampLegacySqlTabs(saved, "conn-a");

    expect(saved.workspace.tabs[0]).toEqual({ kind: "sql", id: 0 });
    expect(saved.sqlSeeds).toEqual({ "sql:0": "select 1" });
  });
});

const connA: ConnectionInfo = {
  id: "conn-a",
  name: "shop.db",
  kind: "sqlite",
  source_path: "/tmp/shop.db",
};
const connB: ConnectionInfo = {
  id: "conn-b",
  name: "blog.db",
  kind: "sqlite",
  source_path: "/tmp/blog.db",
};

function resetStore() {
  useStudioStore.setState({
    open: [],
    recent: [],
    activeId: null,
    workspaces: {},
    sqlSeeds: {},
    pendingWorkspaceRestore: {},
  });
}

describe("opening a SQL tab", () => {
  beforeEach(resetStore);

  it("stamps the new tab with the connection it was opened on", () => {
    useStudioStore.getState().openSql("conn-a");

    const tab = useStudioStore.getState().workspaces["conn-a"].tabs[0];
    expect(tab).toEqual({ kind: "sql", id: 0, conn_id: "conn-a" });
  });

  it("keeps two connections' first editors apart, text included", () => {
    useStudioStore.getState().openSql("conn-a", "select 'a'");
    useStudioStore.getState().openSql("conn-b", "select 'b'");

    expect(useStudioStore.getState().sqlSeeds).toEqual({
      "sql:conn-a:0": "select 'a'",
      "sql:conn-b:0": "select 'b'",
    });
  });

  it("numbers a connection's editors one after another", () => {
    useStudioStore.getState().openSql("conn-a");
    useStudioStore.getState().openSql("conn-a");

    const ids = useStudioStore
      .getState()
      .workspaces["conn-a"].tabs.map((t) => (t.kind === "sql" ? t.id : null));
    expect(ids).toEqual([0, 1]);
  });
});

describe("connecting to a target with a workspace saved before SQL tabs carried a connection", () => {
  beforeEach(resetStore);

  function legacySaved(): SavedWorkspace {
    const legacy: StudioTab = { kind: "sql", id: 0 };
    return {
      workspace: {
        tabs: [legacy],
        active: legacy,
        layout: {
          type: "leaf",
          id: "l",
          tabKeys: [tabKey(legacy)],
          activeTabKey: tabKey(legacy),
        },
        focusedPaneId: "l",
      } as unknown as WorkspaceTabs,
      sqlSeeds: { "sql:0": "select * from orders" },
    };
  }

  it("restores the editor and its text under the connection it just opened", () => {
    useStudioStore.setState({
      pendingWorkspaceRestore: { [stableConnKey(connA)]: legacySaved() },
    });

    useStudioStore.getState().openConn(connA);

    const state = useStudioStore.getState();
    expect(state.workspaces["conn-a"].tabs[0]).toEqual({
      kind: "sql",
      id: 0,
      conn_id: "conn-a",
    });
    expect(state.sqlSeeds["sql:conn-a:0"]).toBe("select * from orders");
    expect(state.sqlSeeds["sql:0"]).toBeUndefined();
  });

  it("uses the saved workspace once, so a second connect starts fresh", () => {
    useStudioStore.setState({
      pendingWorkspaceRestore: { [stableConnKey(connA)]: legacySaved() },
    });

    useStudioStore.getState().openConn(connA);

    expect(useStudioStore.getState().pendingWorkspaceRestore).toEqual({});
  });

  it("does not hand another target's saved editor to this connection", () => {
    useStudioStore.setState({
      pendingWorkspaceRestore: { [stableConnKey(connB)]: legacySaved() },
    });

    useStudioStore.getState().openConn(connA);

    const state = useStudioStore.getState();
    expect(state.workspaces["conn-a"]).toBeUndefined();
    expect(Object.keys(state.pendingWorkspaceRestore)).toEqual([
      stableConnKey(connB),
    ]);
  });
});
