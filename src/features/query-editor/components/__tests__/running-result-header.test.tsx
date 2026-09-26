import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { QueryResult } from "@/shared/api";

vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));

import { SqlResults } from "../editor-tab";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(cleanup);

const pending: QueryResult = {
  columns: [],
  rows: [],
  rows_affected: 0,
  is_select: true,
  error: null,
  elapsed_ms: 0,
};

describe("a run with nothing back yet", () => {
  it("keeps the result header and shows the timer with Stop", () => {
    render(
      <SqlResults
        live
        conn_id="c1"
        tab_key="t1"
        result={pending}
        sql="select pg_sleep(10)"
        on_refresh={vi.fn()}
        loading={{ started_at: performance.now(), on_stop: vi.fn() }}
      />,
    );
    expect(screen.getByRole("button", { name: "Result" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Summary" })).toBeTruthy();
    expect(screen.getByText(/Loading/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.queryByText("No rows.")).toBeNull();
  });
});
