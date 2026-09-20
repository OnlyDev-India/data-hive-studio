import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { tabKey, useStudioStore, type GridBridge } from "@/shared/store";

vi.mock("@/shared/api/web", () => ({ WEB: false }));

import { ActionBar } from "../action-bar";

const CONN = "c1";
const TAB = { kind: "table", name: "users", tabId: 1 } as const;

function open_table_with_bridge(over: Partial<GridBridge>) {
  const refresh = vi.fn();
  useStudioStore.setState({
    open: [{ id: CONN, name: "db", kind: "postgres" }],
    activeId: CONN,
    workspaces: { [CONN]: { active: TAB, tabs: [TAB], paneModes: {} } },
    gridBridges: {
      [tabKey(TAB)]: {
        rows: 0,
        total: 0,
        loading: false,
        table: "users",
        page_size: 50,
        pending_exists: false,
        refresh,
        get_filtered_op: () => ({ kind: "select", table: "users" }),
        ...over,
      } as unknown as GridBridge,
    },
  } as never);
  return refresh;
}

const press_reload = () =>
  fireEvent.keyDown(window, { key: "r", metaKey: true });

beforeEach(() => {
  useStudioStore.setState({ gridBridges: {}, workspaces: {} } as never);
});
afterEach(() => {
  cleanup();
  useStudioStore.setState({ gridBridges: {}, workspaces: {} } as never);
});

describe("Reload shortcut", () => {
  it("reloads the active table's grid", () => {
    const refresh = open_table_with_bridge({});
    render(<ActionBar />);
    press_reload();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing while the grid is still loading", () => {
    const refresh = open_table_with_bridge({ loading: true });
    render(<ActionBar />);
    press_reload();
    expect(refresh).not.toHaveBeenCalled();
  });
});
