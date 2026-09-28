import type { PlanNode } from "@/shared/api";

/** One visible row of the plan tree, ready to render. */
export interface PlanRow {
  node: PlanNode;
  depth: number;
  has_children: boolean;
  expanded: boolean;
}

/** A plan bigger than this opens collapsed below depth 3. */
const BIG_PLAN_NODES = 200;
const BIG_PLAN_OPEN_DEPTH = 3;

export function countNodes(root: PlanNode): number {
  let n = 0;
  const stack = [root];
  for (let node = stack.pop(); node; node = stack.pop()) {
    n++;
    stack.push(...node.children);
  }
  return n;
}

/** Ids of the nodes a fresh plan tab starts collapsed. Trees open fully
 *  expanded, or to depth 3 when the plan is big. */
export function initialCollapsed(root: PlanNode): Set<number> {
  const collapsed = new Set<number>();
  if (countNodes(root) <= BIG_PLAN_NODES) return collapsed;
  const walk = (node: PlanNode, depth: number) => {
    if (depth >= BIG_PLAN_OPEN_DEPTH - 1 && node.children.length > 0) {
      collapsed.add(node.id);
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(root, 0);
  return collapsed;
}

/** The rows to show, in reading order, skipping everything under a collapsed
 *  node. */
export function flattenPlan(
  root: PlanNode,
  collapsed: ReadonlySet<number>,
): PlanRow[] {
  const rows: PlanRow[] = [];
  const walk = (node: PlanNode, depth: number) => {
    const has_children = node.children.length > 0;
    const expanded = has_children && !collapsed.has(node.id);
    rows.push({ node, depth, has_children, expanded });
    if (expanded) for (const child of node.children) walk(child, depth + 1);
  };
  walk(root, 0);
  return rows;
}

/** Whether any node carries analyzed numbers, so the tree shows the actual
 *  columns. */
export function hasActuals(root: PlanNode): boolean {
  const stack = [root];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (
      node.actual_rows !== null ||
      node.actual_time_ms !== null ||
      node.loops !== null
    ) {
      return true;
    }
    stack.push(...node.children);
  }
  return false;
}

const DASH = "—";

/** `1.2k`, `340`, `2.5M`; a dash when the database gave no value. */
export function formatCount(value: number | null): string {
  if (value === null) return DASH;
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trim(value / 1e9)}B`;
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e3) return `${trim(value / 1e3)}k`;
  return String(Math.round(value));
}

/** Costs are small decimals, so they keep two places below 1000. */
export function formatCost(value: number | null): string {
  if (value === null) return DASH;
  return Math.abs(value) >= 1000 ? formatCount(value) : value.toFixed(2);
}

/** `0.42 ms`, `340 ms`, `1.2 s`; a dash when there is no value. */
export function formatMillis(value: number | null): string {
  if (value === null) return DASH;
  if (value >= 1000) return `${trim(value / 1000)} s`;
  if (value >= 100) return `${Math.round(value)} ms`;
  if (value >= 1) return `${trim(value)} ms`;
  return `${value.toFixed(2)} ms`;
}

/** One decimal, dropped when it is a whole number. */
function trim(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** A plan tab is stale once the editor no longer holds the statement it was
 *  made for. */
export function isPlanStale(source: string, editor_text: string): boolean {
  return !editor_text.includes(source);
}

/** Where the arrow keys take the active row of the tree grid. Returns the
 *  new active index, or `null` when the key does nothing there. Left and
 *  right collapse/expand are handled by the caller, since they change the
 *  rows rather than move within them. */
export function moveActive(
  rows: readonly PlanRow[],
  index: number,
  key: "ArrowDown" | "ArrowUp" | "Home" | "End",
): number | null {
  if (rows.length === 0) return null;
  const next =
    key === "ArrowDown"
      ? Math.min(index + 1, rows.length - 1)
      : key === "ArrowUp"
        ? Math.max(index - 1, 0)
        : key === "Home"
          ? 0
          : rows.length - 1;
  return next === index ? null : next;
}

/** Index of the row's parent: the nearest earlier row one level up. */
export function parentIndex(
  rows: readonly PlanRow[],
  index: number,
): number | null {
  const depth = rows[index]?.depth ?? 0;
  for (let i = index - 1; i >= 0; i--) {
    if (rows[i].depth < depth) return i;
  }
  return null;
}
