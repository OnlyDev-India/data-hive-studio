import { beforeEach, describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PlanResult } from "@/shared/api";

const explainSql = vi.fn();
vi.mock("@/shared/api", () => ({
  canCancelPlan: () => true,
  explainSql: (...args: unknown[]) => explainSql(...args),
  explainMongo: vi.fn(),
}));

import { usePlanTabs } from "../use-plan-tabs";

function plan(patch: Partial<PlanResult> = {}): PlanResult {
  return {
    dialect: "sqlite",
    mode: "estimate",
    statement: "SELECT 1",
    root: null,
    elapsed_ms: 1,
    cancelled: false,
    truncated: false,
    error: null,
    unsupported: null,
    ...patch,
  };
}

function setup(keep_all_tabs = true) {
  return renderHook(() =>
    usePlanTabs({
      conn_id: "c1",
      dialect: "sqlite",
      keep_all_tabs,
      on_open: () => {},
      on_activate: () => {},
    }),
  );
}

beforeEach(() => explainSql.mockReset());

describe("explain", () => {
  it("opens one plan tab per statement and closes one at a time", async () => {
    explainSql.mockResolvedValue(plan());
    const { result } = setup();
    await act(async () => {
      result.current.explain([
        { source: "a", statement: "a" },
        { source: "b", statement: "b" },
      ]);
    });
    await waitFor(() => expect(result.current.tabs).toHaveLength(2));
    expect(result.current.tabs.every((t) => t.id < 0)).toBe(true);
    act(() => result.current.close(result.current.tabs[0].id));
    expect(result.current.tabs).toHaveLength(1);
  });

  it("stops an analyze run at the first statement that fails", async () => {
    explainSql.mockResolvedValueOnce(plan({ error: "boom" }));
    const { result } = setup();
    await act(async () => {
      result.current.explain(
        [
          { source: "a", statement: "a" },
          { source: "b", statement: "b" },
        ],
        true,
      );
    });
    await waitFor(() => expect(result.current.tabs).toHaveLength(1));
    expect(explainSql).toHaveBeenCalledTimes(1);
  });

  it("names every plan tab plainly, without a number", async () => {
    explainSql.mockResolvedValue(plan());
    const { result } = setup();
    await act(async () => {
      result.current.explain([
        { source: "a", statement: "a" },
        { source: "b", statement: "b" },
      ]);
    });
    await waitFor(() => expect(result.current.tabs).toHaveLength(2));
    expect(result.current.tabs.map((t) => t.label)).toEqual(["Plan", "Plan"]);
  });

  it("reuses one plan tab for a single statement while new tab per run is off", async () => {
    explainSql.mockResolvedValue(plan());
    const { result } = setup(false);
    await act(async () => {
      result.current.explain([{ source: "a", statement: "a" }]);
    });
    await waitFor(() => expect(result.current.tabs[0]?.result).not.toBeNull());
    const id = result.current.tabs[0].id;
    await act(async () => {
      result.current.explain([{ source: "b", statement: "b" }]);
    });
    await waitFor(() => expect(result.current.tabs[0].statement).toBe("b"));
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].id).toBe(id);
    // A selection of several statements still gets a tab each.
    await act(async () => {
      result.current.explain([
        { source: "c", statement: "c" },
        { source: "d", statement: "d" },
      ]);
    });
    await waitFor(() => expect(result.current.tabs).toHaveLength(3));
  });

  it("opens a new plan tab each time while new tab per run is on", async () => {
    explainSql.mockResolvedValue(plan());
    const { result } = setup(true);
    for (const q of ["a", "b"]) {
      await act(async () => {
        result.current.explain([{ source: q, statement: q }]);
      });
    }
    await waitFor(() => expect(result.current.tabs).toHaveLength(2));
  });
});
