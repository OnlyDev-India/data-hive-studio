import { beforeAll, describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlanNode, PlanResult } from "@/shared/api";
import { PlanView } from "../plan-view";
import type { PlanTab } from "../../lib/use-plan-tabs";

// jsdom has no layout, so the virtualizer would see a zero height list and
// render no rows.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    value: 600,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    value: 900,
  });
});

function node(patch: Partial<PlanNode>): PlanNode {
  return {
    id: 1,
    label: "Node",
    target: "",
    condition: "",
    startup_cost: null,
    total_cost: null,
    est_rows: null,
    actual_rows: null,
    actual_time_ms: null,
    loops: null,
    children: [],
    ...patch,
  };
}

function tab(patch: Partial<PlanResult> | null): PlanTab {
  return {
    id: -1,
    label: "Plan 1",
    statement: "SELECT 1",
    source: "SELECT 1",
    result:
      patch === null
        ? null
        : {
            dialect: "postgres",
            mode: "estimate",
            statement: "SELECT 1",
            root: null,
            elapsed_ms: 12,
            cancelled: false,
            truncated: false,
            error: null,
            unsupported: null,
            ...patch,
          },
  };
}

const tree = node({
  label: "Hash Join",
  total_cost: 42,
  est_rows: 1200,
  children: [
    node({
      id: 2,
      label: "Seq Scan",
      target: "orders o",
      condition: "Filter: (x > 1)",
      total_cost: 10.5,
    }),
  ],
});

describe("PlanView", () => {
  it("shows a loading state until the database answers", () => {
    render(<PlanView tab={tab(null)} />);
    expect(screen.getByRole("status", { name: "Loading plan" })).toBeTruthy();
  });

  it("shows the tree with costs and a dash for a missing value", () => {
    render(<PlanView tab={tab({ root: tree })} />);
    expect(screen.getByText("Hash Join")).toBeTruthy();
    expect(screen.getByText("orders o")).toBeTruthy();
    expect(screen.getByText("Filter: (x > 1)")).toBeTruthy();
    expect(screen.getByText("42.00")).toBeTruthy();
    expect(screen.getByText("1.2k")).toBeTruthy();
    // The child has no estimated rows.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // An estimate has no actual columns.
    expect(screen.queryByText("Actual rows")).toBeNull();
    expect(screen.getByText("Estimate")).toBeTruthy();
  });

  it("adds the actual columns for an analyzed plan", () => {
    const analyzed = node({
      label: "Seq Scan",
      actual_rows: 3,
      actual_time_ms: 340,
      loops: 1,
    });
    render(<PlanView tab={tab({ mode: "analyze", root: analyzed })} />);
    expect(screen.getByText("Actual rows")).toBeTruthy();
    expect(screen.getByText("340 ms")).toBeTruthy();
    expect(screen.getByText("Analyzed")).toBeTruthy();
  });

  it("collapses and expands a node", async () => {
    render(<PlanView tab={tab({ root: tree })} />);
    await userEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByText("Seq Scan")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("Seq Scan")).toBeTruthy();
  });

  it("marks a truncated plan", () => {
    render(<PlanView tab={tab({ root: tree, truncated: true })} />);
    expect(screen.getByText("Truncated")).toBeTruthy();
  });

  it("shows the database's own message for an error", () => {
    render(<PlanView tab={tab({ error: 'relation "x" does not exist' })} />);
    expect(screen.getByRole("alert").textContent).toContain(
      'relation "x" does not exist',
    );
  });

  it("explains an unsupported statement", () => {
    render(
      <PlanView
        tab={tab({
          unsupported: "Explain works on SELECT and WITH statements.",
        })}
      />,
    );
    expect(screen.getByText("This statement can't be explained")).toBeTruthy();
    expect(screen.getByText(/Explain works on SELECT/)).toBeTruthy();
  });

  it("says so when the database returns no steps", () => {
    render(<PlanView tab={tab({})} />);
    expect(screen.getByText("No plan steps")).toBeTruthy();
  });

  it("marks a stale plan", () => {
    render(<PlanView tab={tab({ root: tree })} stale />);
    expect(screen.getByText("Stale")).toBeTruthy();
  });

  it("is a tree grid with levels and expanded state", () => {
    render(<PlanView tab={tab({ root: tree })} />);
    expect(screen.getByRole("treegrid", { name: "Query plan" })).toBeTruthy();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].getAttribute("aria-level")).toBe("1");
    expect(rows[0].getAttribute("aria-expanded")).toBe("true");
    expect(rows[1].getAttribute("aria-level")).toBe("2");
    expect(rows[1].getAttribute("aria-expanded")).toBeNull();
  });

  it("moves, collapses and expands with the arrow keys", async () => {
    render(<PlanView tab={tab({ root: tree })} />);
    const grid = screen.getByRole("treegrid");
    grid.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(grid.getAttribute("aria-activedescendant")).toMatch(/-2$/);
    // On a leaf, left goes to the parent, then collapses it.
    await userEvent.keyboard("{ArrowLeft}");
    expect(grid.getAttribute("aria-activedescendant")).toMatch(/-1$/);
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.queryByText("Seq Scan")).toBeNull();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByText("Seq Scan")).toBeTruthy();
  });

  it("keeps a big plan cheap by rendering only the rows in view", () => {
    let id = 100;
    const wide = node({
      id: 99,
      label: "Append",
      children: Array.from({ length: 3000 }, () =>
        node({ id: ++id, label: "Seq Scan" }),
      ),
    });
    render(<PlanView tab={tab({ root: wide })} />);
    expect(screen.getAllByText("Seq Scan").length).toBeLessThan(100);
  });
});
