import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioStore } from "../store";
import { tabKey, type StudioTab } from "../tab-utils";
import {
  buildWorkspaceSnapshot,
  stableConnKey,
} from "../workspace-persistence";
import type { ConnectionInfo } from "../../api/types";

vi.mock("../../api/connection", () => ({ closeConnection: vi.fn() }));

const first: ConnectionInfo = { id: "s1", name: "shop", kind: "postgres" };
const again: ConnectionInfo = { id: "s2", name: "shop", kind: "postgres" };
const other: ConnectionInfo = { id: "o1", name: "logs", kind: "postgres" };
const users: StudioTab = { kind: "table", name: "users", tabId: 1 };
const query: StudioTab = { kind: "sql", id: 0, conn_id: "s1" };

beforeEach(() => {
  useStudioStore.setState({
    open: [],
    recent: [],
    activeId: null,
    workspaces: {},
    sqlSeeds: {},
    recentParams: {},
    pendingWorkspaceRestore: {},
    pausedTabs: {},
  } as never);
});

function open_with_tabs(conn: ConnectionInfo) {
  const s = useStudioStore.getState();
  s.openConn(conn);
  useStudioStore.setState((st) => ({
    workspaces: {
      ...st.workspaces,
      [conn.id]: {
        ...st.workspaces[conn.id],
        tabs: [users, query],
        active: users,
      },
    },
    sqlSeeds: { ...st.sqlSeeds, [tabKey(query)]: "select 1" },
  }));
}

describe("disconnect then reconnect", () => {
  it("brings back the tabs the connection had open", () => {
    open_with_tabs(first);
    useStudioStore.getState().closeConn(first.id);
    useStudioStore.getState().openConn(again);

    const s = useStudioStore.getState();
    expect(s.workspaces[again.id]?.tabs.map((t) => t.kind)).toEqual([
      "table",
      "sql",
    ]);
    expect(s.sqlSeeds[tabKey(query)]).toBe("select 1");
  });

  it("also works when another connection stays open", () => {
    useStudioStore.getState().openConn(other);
    open_with_tabs(first);
    useStudioStore.getState().closeConn(first.id);
    useStudioStore.getState().openConn(again);

    expect(useStudioStore.getState().workspaces[again.id]?.tabs).toHaveLength(
      2,
    );
  });

  it("keeps a disconnected connection's tabs in the saved snapshot", () => {
    open_with_tabs(first);
    useStudioStore.getState().closeConn(first.id);

    const snap = buildWorkspaceSnapshot(useStudioStore.getState());
    expect(snap.byConn[stableConnKey(first)]?.workspace.tabs).toHaveLength(2);
  });

  it("holds back the restored table tabs until a reload", () => {
    open_with_tabs(first);
    useStudioStore.getState().closeConn(first.id);
    useStudioStore.getState().openConn(again);

    expect(useStudioStore.getState().pausedTabs).toEqual({
      [tabKey(users)]: true,
    });
    useStudioStore.getState().resumeTab(tabKey(users));
    expect(useStudioStore.getState().pausedTabs).toEqual({});
  });

  it("does not hold back tabs on a first connect", () => {
    open_with_tabs(first);
    expect(useStudioStore.getState().pausedTabs).toEqual({});
  });
});
