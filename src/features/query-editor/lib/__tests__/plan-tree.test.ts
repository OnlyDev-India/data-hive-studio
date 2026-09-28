import { describe, expect, it } from "vitest";
import type { PlanNode } from "@/shared/api";
import {
  countNodes,
  flattenPlan,
  formatCost,
  formatCount,
  formatMillis,
  hasActuals,
  initialCollapsed,
  isPlanStale,
  moveActive,
  parentIndex,
} from "../plan-tree";

let next = 0;
function node(
  children: PlanNode[] = [],
  patch: Partial<PlanNode> = {},
): PlanNode {
  return {
    id: ++next,
    label: "n",
    target: "",
    condition: "",
    startup_cost: null,
    total_cost: null,
    est_rows: null,
    actual_rows: null,
    actual_time_ms: null,
    loops: null,
    children,
    ...patch,
  };
}

/** A straight chain `depth` nodes deep. */
function chain(depth: number): PlanNode {
  let n = node();
  for (let i = 1; i < depth; i++) n = node([n]);
  return n;
}

describe("flattenPlan", () => {
  it("lists every node in reading order with its depth", () => {
    const leaf_a = node();
    const leaf_b = node();
    const root = node([node([leaf_a]), leaf_b]);
    const rows = flattenPlan(root, new Set());
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1]);
    expect(rows[2].node).toBe(leaf_a);
    expect(rows[0].has_children && rows[0].expanded).toBe(true);
    expect(rows[2].has_children).toBe(false);
  });

  it("skips what sits under a collapsed node", () => {
    const parent = node([node(), node()]);
    const root = node([parent]);
    const rows = flattenPlan(root, new Set([parent.id]));
    expect(rows).toHaveLength(2);
    expect(rows[1].expanded).toBe(false);
    expect(rows[1].has_children).toBe(true);
  });
});

describe("initialCollapsed", () => {
  it("opens a small plan fully", () => {
    expect(initialCollapsed(chain(50)).size).toBe(0);
  });

  it("opens a big plan to depth 3", () => {
    const big = chain(250);
    const rows = flattenPlan(big, initialCollapsed(big));
    expect(rows.length).toBeLessThan(250);
    expect(Math.max(...rows.map((r) => r.depth))).toBe(2);
  });
});

describe("hasActuals and countNodes", () => {
  it("finds analyzed numbers anywhere in the tree", () => {
    expect(hasActuals(node([node()]))).toBe(false);
    expect(hasActuals(node([node([], { actual_rows: 4 })]))).toBe(true);
  });

  it("counts every node", () => {
    expect(countNodes(chain(7))).toBe(7);
  });
});

describe("number formatting", () => {
  it("shows a dash for a value the database did not give", () => {
    expect(formatCount(null)).toBe("—");
    expect(formatCost(null)).toBe("—");
    expect(formatMillis(null)).toBe("—");
  });

  it("compacts counts", () => {
    expect(formatCount(340)).toBe("340");
    expect(formatCount(1200)).toBe("1.2k");
    expect(formatCount(2_500_000)).toBe("2.5M");
    expect(formatCount(3000)).toBe("3k");
  });

  it("keeps two decimals on small costs", () => {
    expect(formatCost(12.5)).toBe("12.50");
    expect(formatCost(45_200)).toBe("45.2k");
  });

  it("writes times in the unit that reads best", () => {
    expect(formatMillis(0.42)).toBe("0.42 ms");
    expect(formatMillis(340)).toBe("340 ms");
    expect(formatMillis(1200)).toBe("1.2 s");
  });
});

describe("isPlanStale", () => {
  it("is fresh while the editor still holds the statement", () => {
    expect(isPlanStale("SELECT 1", "-- hi\nSELECT 1;\nSELECT 2;")).toBe(false);
  });
  it("goes stale once the statement is edited away", () => {
    expect(isPlanStale("SELECT 1", "SELECT 2;")).toBe(true);
  });
});

describe("keyboard movement", () => {
  const tree = node([node([node()]), node()]);
  const rows = flattenPlan(tree, new Set());
  it("moves down and up and stops at the ends", () => {
    expect(moveActive(rows, 0, "ArrowDown")).toBe(1);
    expect(moveActive(rows, 0, "ArrowUp")).toBeNull();
    expect(moveActive(rows, rows.length - 1, "ArrowDown")).toBeNull();
    expect(moveActive(rows, 2, "Home")).toBe(0);
    expect(moveActive(rows, 0, "End")).toBe(rows.length - 1);
  });
  it("finds the parent row", () => {
    expect(parentIndex(rows, 2)).toBe(1);
    expect(parentIndex(rows, 3)).toBe(0);
    expect(parentIndex(rows, 0)).toBeNull();
  });
});
