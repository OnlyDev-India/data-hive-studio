import { describe, it, expect, beforeEach, vi } from "vitest";

const { closeConnection } = vi.hoisted(() => ({
  closeConnection: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../api/connection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/connection")>()),
  closeConnection,
}));

import { useStudioStore } from "../store";
import type { ConnectionInfo } from "../../api/types";

const conn: ConnectionInfo = {
  id: "c1",
  name: "test.db",
  kind: "sqlite",
  source_path: "/tmp/test.db",
};

describe("closeConn", () => {
  beforeEach(() => {
    useStudioStore.setState({
      open: [],
      activeId: null,
      leftPanelMode: "tables",
      leftPanelOpen: true,
      workspaces: {},
    });
  });

  it("resets leftPanelMode to tables when the last connection closes", () => {
    useStudioStore.getState().openConn(conn);
    useStudioStore.setState({ leftPanelMode: "activity" });
    expect(useStudioStore.getState().leftPanelMode).toBe("activity");

    useStudioStore.getState().closeConn(conn.id);

    expect(useStudioStore.getState().open).toHaveLength(0);
    expect(useStudioStore.getState().view).toBe("home");
    expect(useStudioStore.getState().leftPanelMode).toBe("tables");
  });

  it("leaves leftPanelMode alone when other connections stay open", () => {
    const conn2: ConnectionInfo = {
      ...conn,
      id: "c2",
      name: "other.db",
      source_path: "/tmp/other.db",
    };
    useStudioStore.getState().openConn(conn);
    useStudioStore.getState().openConn(conn2);
    useStudioStore.setState({ leftPanelMode: "activity" });

    useStudioStore.getState().closeConn(conn.id);

    expect(useStudioStore.getState().open).toHaveLength(1);
    expect(useStudioStore.getState().leftPanelMode).toBe("activity");
  });
});

describe("openConn, same database twice", () => {
  const pg = (id: string, read_only?: boolean): ConnectionInfo => ({
    id,
    name: "orders",
    kind: "postgres",
    source_path: null,
    read_only,
  });
  const params = {
    kind: "postgres" as const,
    host: "db.example",
    port: 5432,
    user: "app",
    password: "",
    database: "orders",
  };

  beforeEach(() => {
    closeConnection.mockClear();
    useStudioStore.setState({
      open: [],
      recent: [],
      activeId: null,
      workspaces: {},
      recentParams: { p1: params, p2: params },
    });
  });

  it("reuses the open session when the read only flag matches", () => {
    useStudioStore.getState().openConn(pg("p1"));
    useStudioStore.getState().openConn(pg("p2"));

    expect(useStudioStore.getState().open.map((c) => c.id)).toEqual(["p1"]);
    expect(closeConnection).toHaveBeenCalledWith("p2");
  });

  it("keeps a read only session apart from a writable one", () => {
    useStudioStore.getState().openConn(pg("p1"));
    useStudioStore.getState().openConn(pg("p2", true));

    const open = useStudioStore.getState().open;
    expect(open.map((c) => c.id)).toEqual(["p2", "p1"]);
    expect(open[0].read_only).toBe(true);
    expect(closeConnection).not.toHaveBeenCalled();
  });
});
