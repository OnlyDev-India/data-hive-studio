import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStudioStore } from "../store";
import { tabKey, tabLabel, type StudioTab } from "../tab-utils";
import {
  buildWorkspaceSnapshot,
  stableConnKey,
} from "../workspace-persistence";
import type { ConnectionInfo } from "../../api/types";

vi.mock("../../api/connection", () => ({ closeConnection: vi.fn() }));

const first: ConnectionInfo = { id: "m1", name: "shop", kind: "mongodb" };
const again: ConnectionInfo = { id: "m2", name: "shop", kind: "mongodb" };

beforeEach(() => {
  useStudioStore.setState({
    open: [],
    recent: [],
    activeId: null,
    workspaces: {},
    sqlSeeds: {},
    aggregationTabs: {},
    recentParams: {},
    pendingWorkspaceRestore: {},
    pausedTabs: {},
  } as never);
});

const tabs = (id: string) =>
  useStudioStore.getState().workspaces[id]?.tabs ?? [];

describe("aggregation tabs", () => {
  it("opens a new tab every time, each with the fixed label", () => {
    const s = useStudioStore.getState();
    s.openConn(first);
    s.openAggregation(first.id, "shop", "orders");
    s.openAggregation(first.id, "shop", "orders");

    const opened = tabs(first.id);
    expect(opened).toHaveLength(2);
    expect(new Set(opened.map(tabKey)).size).toBe(2);
    expect(opened.map((t) => tabLabel(t))).toEqual([
      "Aggregation",
      "Aggregation",
    ]);
  });

  it("starts with a $match card when given a seed, and empty without", () => {
    const s = useStudioStore.getState();
    s.openConn(first);
    s.openAggregation(first.id, "shop", "orders", '{ status: "A" }');
    s.openAggregation(first.id, "shop", "orders", null);

    const [seeded, plain] = tabs(first.id).map(
      (t) => useStudioStore.getState().aggregationTabs[tabKey(t)],
    );
    expect(seeded.stages.map((st) => [st.op, st.body])).toEqual([
      ["$match", '{ status: "A" }'],
    ]);
    expect(plain.stages).toEqual([]);
    expect(plain.preview_cap).toBe(1000);
    expect(plain.auto_preview).toBe(true);
  });

  it("drops the pipeline when its tab closes", () => {
    const s = useStudioStore.getState();
    s.openConn(first);
    s.openAggregation(first.id, "shop", "orders");
    const tab = tabs(first.id)[0] as StudioTab;
    s.closeTab(first.id, tab);
    expect(useStudioStore.getState().aggregationTabs[tabKey(tab)]).toBe(
      undefined,
    );
  });

  it("saves the pipeline in the snapshot and brings it back on reconnect", () => {
    const s = useStudioStore.getState();
    s.openConn(first);
    s.openAggregation(first.id, "shop", "orders", "{}");
    const key = tabKey(tabs(first.id)[0]);

    const snap = buildWorkspaceSnapshot(useStudioStore.getState());
    expect(
      snap.byConn[stableConnKey(first)]?.aggregationSetups?.[key]?.stages,
    ).toHaveLength(1);

    s.closeConn(first.id);
    useStudioStore.getState().openConn(again);
    const restored = tabs(again.id)[0];
    expect(restored?.kind).toBe("aggregation");
    expect(
      useStudioStore.getState().aggregationTabs[tabKey(restored)]?.stages[0]
        ?.op,
    ).toBe("$match");
  });
});
