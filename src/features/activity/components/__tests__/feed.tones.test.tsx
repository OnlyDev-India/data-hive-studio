import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useStudioStore } from "@/shared/store";
import { ActivityFeed } from "../feed";

function entry(id: number, kind: string) {
  return {
    id,
    ts_ms: Date.now(),
    conn_id: "c1",
    kind,
    target: `target-${id}`,
    ok: true,
    rows: 0,
    duration_ms: 1,
    error: null,
    sql: null,
    origin: "user" as const,
  };
}

describe("ActivityFeed kind badges", () => {
  beforeEach(() => {
    useStudioStore.setState({
      activity: [],
      showAppActivity: false,
      activityDetail: null,
    });
  });

  it.each([
    ["select", "SELECT", "bg-muted"],
    ["count", "COUNT", "bg-muted"],
    ["disconnect", "CLOSE", "bg-muted"],
    ["insert", "INSERT", "bg-success-light"],
    ["duplicate", "CLONE", "bg-success-light"],
    ["update", "UPDATE", "bg-warning-light"],
    ["delete", "DELETE", "bg-destructive-light"],
    ["drop_table", "DROP", "bg-destructive-light"],
    ["ddl", "DDL", "bg-info-light"],
    ["schema", "SCHEMA", "bg-info-light"],
    ["sql", "SQL", "bg-primary-light"],
    ["vacuum", "VACUUM", "bg-muted"],
  ])("renders %s as %s on %s", (kind, label, cls) => {
    useStudioStore.getState().pushActivity(entry(1, kind));
    render(<ActivityFeed />);
    const badge = screen.getByText(label);
    expect(badge).toHaveClass(cls, "font-mono");
    expect(badge).not.toHaveClass("uppercase");
  });
});
