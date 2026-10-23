import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioStore } from "../store";
import {
  buildWorkspaceSnapshot,
  stableConnKey,
} from "../workspace-persistence";
import type { ConnectionInfo } from "../../api/types";

vi.mock("../../api/connection", () => ({ closeConnection: vi.fn() }));

// No default database, so the stable key falls back to `user@host`.
const first: ConnectionInfo = { id: "m1", name: "root@db", kind: "mysql" };
const again: ConnectionInfo = { id: "m2", name: "root@db", kind: "mysql" };

beforeEach(() => {
  useStudioStore.setState({
    open: [],
    recent: [],
    activeId: null,
    workspaces: {},
    sqlSeeds: {},
    seedFilePaths: {},
    recentParams: {},
    pendingWorkspaceRestore: {},
    pausedTabs: {},
    showSystemDatabases: {},
  } as never);
});

describe("Show system databases (spec 0025 AC-6)", () => {
  it("survives a reconnect and a restart, even with no tabs open", () => {
    const s = useStudioStore.getState();
    s.openConn(first);
    s.setShowSystemDatabases(first.id, true);

    const snap = buildWorkspaceSnapshot(useStudioStore.getState());
    expect(snap.byConn[stableConnKey(first)]?.showSystemDatabases).toBe(true);

    useStudioStore.getState().closeConn(first.id);
    expect(useStudioStore.getState().showSystemDatabases).toEqual({});
    useStudioStore.getState().openConn(again);
    expect(useStudioStore.getState().showSystemDatabases).toEqual({
      m2: true,
    });
  });

  it("turning it off leaves nothing to save", () => {
    const s = useStudioStore.getState();
    s.openConn(first);
    s.setShowSystemDatabases(first.id, true);
    s.setShowSystemDatabases(first.id, false);
    const snap = buildWorkspaceSnapshot(useStudioStore.getState());
    expect(snap.byConn[stableConnKey(first)]).toBeUndefined();
  });
});
