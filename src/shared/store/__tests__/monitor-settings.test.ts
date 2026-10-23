import { beforeEach, describe, expect, it } from "vitest";
import { useStudioStore } from "@/shared/store";
import {
  DEFAULT_MONITOR_SETTINGS,
  normalizeMonitorSettings,
} from "../monitor-settings";
import { savedWorkspaceOf } from "../workspace-persistence";

describe("normalizeMonitorSettings (spec 0025, AC-2)", () => {
  it("fills defaults for an older snapshot with nothing saved", () => {
    expect(normalizeMonitorSettings(undefined)).toEqual(DEFAULT_MONITOR_SETTINGS);
    expect(DEFAULT_MONITOR_SETTINGS).toEqual({
      refresh_ms: 2000,
      slow_ms: 5000,
      show_idle: false,
    });
  });

  it("loads an unknown rate as 2 seconds and clamps the slow limit", () => {
    expect(normalizeMonitorSettings({ refresh_ms: 3000 }).refresh_ms).toBe(2000);
    expect(normalizeMonitorSettings({ refresh_ms: 0 }).refresh_ms).toBe(0);
    expect(normalizeMonitorSettings({ slow_ms: 10 }).slow_ms).toBe(500);
    expect(normalizeMonitorSettings({ slow_ms: 9e9 }).slow_ms).toBe(3_600_000);
    expect(normalizeMonitorSettings({ show_idle: "yes" }).show_idle).toBe(false);
  });
});

describe("the monitor tab and its settings in the store", () => {
  const conn = { id: "m1", name: "shop", kind: "postgres" } as const;

  beforeEach(() => {
    useStudioStore.setState({
      open: [conn],
      activeId: conn.id,
      workspaces: {},
      monitorSettings: {},
    });
  });

  it("opens one Monitor tab per connection and focuses it again (AC-1)", () => {
    const s = useStudioStore.getState();
    s.openMonitor(conn.id);
    s.openSql(conn.id);
    s.openMonitor(conn.id);
    const ws = useStudioStore.getState().workspaces[conn.id];
    expect(ws.tabs.filter((t) => t.kind === "monitor")).toHaveLength(1);
    expect(ws.active?.kind).toBe("monitor");
  });

  it("saves the settings with the workspace, even with no tabs open (AC-2)", () => {
    useStudioStore.getState().setMonitorSettings(conn.id, { refresh_ms: 10000 });
    const saved = savedWorkspaceOf(useStudioStore.getState(), conn);
    expect(saved?.monitorSettings).toEqual({
      refresh_ms: 10000,
      slow_ms: 5000,
      show_idle: false,
    });
  });
});
