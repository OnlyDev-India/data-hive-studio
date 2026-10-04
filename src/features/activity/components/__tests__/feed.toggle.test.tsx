import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";

const { clearActivity } = vi.hoisted(() => ({
  clearActivity: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/shared/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/api")>()),
  clearActivity,
  setSaveAppActivity: vi.fn(() => Promise.resolve()),
}));

import { useStudioStore } from "@/shared/store";
import { ActivityFeed } from "../feed";

function entry(id: number, origin?: "user" | "app") {
  return {
    id,
    ts_ms: Date.now(),
    conn_id: "c1",
    kind: "schema",
    target: `target-${id}`,
    ok: true,
    rows: 0,
    duration_ms: 1,
    error: null,
    sql: null,
    ...(origin ? { origin } : {}),
  };
}

describe("ActivityFeed and the Save app queries setting", () => {
  beforeEach(() => {
    clearActivity.mockClear();
    useStudioStore.setState({
      activity: [],
      saveAppActivity: false,
      activityDetail: null,
    });
  });

  it("has no app queries switch, and no origin filter while the setting is off", () => {
    render(<ActivityFeed />);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText(/app queries/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("filters by origin once the setting is on", () => {
    useStudioStore.setState({ saveAppActivity: true });
    useStudioStore.getState().pushActivity(entry(1, "user"));
    useStudioStore.getState().pushActivity(entry(2, "app"));
    useStudioStore.getState().pushActivity(entry(3));

    render(<ActivityFeed />);
    expect(screen.getByRole("radio", { name: "All" })).toBeChecked();
    expect(screen.getByText("target-2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "App" }));
    expect(screen.getByText("target-2")).toBeInTheDocument();
    expect(screen.queryByText("target-1")).not.toBeInTheDocument();
    expect(screen.queryByText("target-3")).not.toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Mine" }));
    expect(screen.queryByText("target-2")).not.toBeInTheDocument();
    expect(screen.getByText("target-1")).toBeInTheDocument();
    expect(screen.getByText("target-3")).toBeInTheDocument();
  });

  it("shows only your entries when the setting goes off with App picked", () => {
    useStudioStore.setState({ saveAppActivity: true });
    useStudioStore.getState().pushActivity(entry(1, "user"));
    useStudioStore.getState().pushActivity(entry(2, "app"));

    render(<ActivityFeed />);
    fireEvent.click(screen.getByRole("radio", { name: "App" }));
    act(() => useStudioStore.setState({ saveAppActivity: false }));

    expect(screen.getByText("target-1")).toBeInTheDocument();
    expect(screen.queryByText("target-2")).not.toBeInTheDocument();
  });

  it("hides app entries while the setting is off and shows them once it is on", () => {
    useStudioStore.getState().pushActivity(entry(1, "user"));
    useStudioStore.getState().pushActivity(entry(2, "app"));
    useStudioStore.getState().pushActivity(entry(3));

    render(<ActivityFeed />);

    expect(screen.getByText("target-1")).toBeInTheDocument();
    expect(screen.queryByText("target-2")).not.toBeInTheDocument();
    // No origin counts as user.
    expect(screen.getByText("target-3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();

    act(() => useStudioStore.setState({ saveAppActivity: true }));

    expect(screen.getByText("target-2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("still filters by origin when scoped to a connection", () => {
    useStudioStore
      .getState()
      .pushActivity({ ...entry(1, "user"), conn_key: "sqlite:/x.db" });
    useStudioStore
      .getState()
      .pushActivity({ ...entry(2, "app"), conn_key: "sqlite:/x.db" });
    useStudioStore.getState().pushActivity({
      ...entry(3, "app"),
      conn_id: "c2",
      conn_key: "sqlite:/y.db",
    });

    render(<ActivityFeed conn_id="c1" conn_key="sqlite:/x.db" />);

    expect(screen.getByText("target-1")).toBeInTheDocument();
    expect(screen.queryByText("target-2")).not.toBeInTheDocument();

    act(() => useStudioStore.setState({ saveAppActivity: true }));

    expect(screen.getByText("target-2")).toBeInTheDocument();
    expect(screen.queryByText("target-3")).not.toBeInTheDocument();
  });

  it("shows the plain empty message when only app entries exist", () => {
    useStudioStore.getState().pushActivity(entry(1, "app"));
    render(<ActivityFeed />);
    expect(
      screen.getByText("No queries yet. Queries you run show up here."),
    ).toBeInTheDocument();
  });

  it("Clear removes the connection's entries, hidden app entries included", async () => {
    useStudioStore
      .getState()
      .pushActivity({ ...entry(1, "user"), conn_key: "sqlite:/x.db" });
    useStudioStore
      .getState()
      .pushActivity({ ...entry(2, "app"), conn_key: "sqlite:/x.db" });

    render(<ActivityFeed conn_id="c1" conn_key="sqlite:/x.db" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Clear this connection's activity" }),
    );

    expect(clearActivity).toHaveBeenCalledWith("sqlite:/x.db", "c1");
    await waitFor(() => expect(useStudioStore.getState().activity).toEqual([]));
  });
});
