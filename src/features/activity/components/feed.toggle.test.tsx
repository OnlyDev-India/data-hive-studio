import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useStudioStore } from "@/shared/store";
import { ActivityFeed } from "./feed";

function entry(id: number, origin: "user" | "app") {
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
    origin,
  };
}

describe("ActivityFeed app-activity toggle", () => {
  beforeEach(() => {
    useStudioStore.setState({
      activity: [],
      showAppActivity: false,
      activityDetail: null,
    });
  });

  it("hides app-origin entries when the toggle is off, shows them when on", () => {
    useStudioStore.getState().pushActivity(entry(1, "user"));
    useStudioStore.getState().pushActivity(entry(2, "app"));

    render(<ActivityFeed />);

    // Off by default: only the user entry shows.
    expect(screen.getByText("target-1")).toBeInTheDocument();
    expect(screen.queryByText("target-2")).not.toBeInTheDocument();

    const toggle = screen.getByRole("switch", { name: /show app queries/i });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);

    expect(useStudioStore.getState().showAppActivity).toBe(true);
    expect(screen.getByText("target-1")).toBeInTheDocument();
    expect(screen.getByText("target-2")).toBeInTheDocument();
  });

  it("still filters by origin when scoped to a connection (conn_id/conn_key set)", () => {
    useStudioStore.getState().pushActivity({ ...entry(1, "user"), conn_key: "sqlite:/x.db" });
    useStudioStore.getState().pushActivity({ ...entry(2, "app"), conn_key: "sqlite:/x.db" });
    // Different connection — must never show regardless of toggle state.
    useStudioStore
      .getState()
      .pushActivity({ ...entry(3, "app"), conn_id: "c2", conn_key: "sqlite:/y.db" });

    render(<ActivityFeed conn_id="c1" conn_key="sqlite:/x.db" />);

    expect(screen.getByText("target-1")).toBeInTheDocument();
    expect(screen.queryByText("target-2")).not.toBeInTheDocument();
    expect(screen.queryByText("target-3")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: /show app queries/i }));

    expect(screen.getByText("target-1")).toBeInTheDocument();
    expect(screen.getByText("target-2")).toBeInTheDocument();
    expect(screen.queryByText("target-3")).not.toBeInTheDocument();
  });
});
