import { describe, it, expect, beforeEach } from "vitest";
import { useStudioStore } from "./store";
import type { ConnectionInfo } from "../api/types";

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
    const conn2: ConnectionInfo = { ...conn, id: "c2", name: "other.db", source_path: "/tmp/other.db" };
    useStudioStore.getState().openConn(conn);
    useStudioStore.getState().openConn(conn2);
    useStudioStore.setState({ leftPanelMode: "activity" });

    useStudioStore.getState().closeConn(conn.id);

    expect(useStudioStore.getState().open).toHaveLength(1);
    expect(useStudioStore.getState().leftPanelMode).toBe("activity");
  });
});
