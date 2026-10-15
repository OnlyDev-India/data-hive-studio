import { describe, expect, it } from "vitest";
import type { BlockEdge, SessionRow } from "@/shared/api";
import { buildBlockingTree, countBlocked, flatLocks, type LockNode } from "../locks";

const row = (id: string): SessionRow => ({
  id,
  user: "app",
  database: "shop",
  state: "active",
  query_ms: 1,
  xact_ms: null,
  backend_start: null,
  wait: null,
  op_type: null,
  query: null,
  query_hidden: false,
  client: null,
  app_name: null,
  is_this_app: false,
  shard: null,
  run_id: null,
  can_cancel: true,
  can_terminate: true,
});

const edge = (waiter: string, blocker: string, wait_ms = 0): BlockEdge => ({
  waiter_id: waiter,
  blocker_id: blocker,
  lock_mode: "ShareLock",
  relation: "orders",
  wait_ms,
});

/** `id(child, child(...))` as a nested array, for readable expectations. */
const shape = (n: LockNode): unknown =>
  n.children.length ? [n.id, n.children.map(shape)] : n.id;

describe("buildBlockingTree (AC-7)", () => {
  it("puts each root blocker on top with its waiters nested, deepest chains included", () => {
    const sessions = ["A", "B", "C", "D"].map(row);
    const tree = buildBlockingTree(sessions, [
      edge("B", "A", 500),
      edge("C", "B", 100),
      edge("D", "A", 900),
    ]);
    expect(tree.map(shape)).toEqual([["A", ["D", ["B", ["C"]]]]]);
    expect(countBlocked(tree[0])).toBe(3);
    expect(tree[0].edge).toBeNull();
    expect(tree[0].children[1].edge?.lock_mode).toBe("ShareLock");
  });

  it("keeps a blocker that is not in the session list as a root", () => {
    const tree = buildBlockingTree([row("B")], [edge("B", "X")]);
    expect(tree[0].id).toBe("X");
    expect(tree[0].row).toBeNull();
    expect(tree[0].children[0].row?.id).toBe("B");
  });

  it("shows a waiter under every session that blocks it, roots with most blocked first", () => {
    const tree = buildBlockingTree(
      ["A", "B", "C", "D"].map(row),
      [edge("C", "A"), edge("C", "B"), edge("D", "B")],
    );
    expect(tree.map(shape)).toEqual([
      ["B", ["C", "D"]],
      ["A", ["C"]],
    ]);
  });

  it("cuts a deadlock cycle instead of looping", () => {
    const tree = buildBlockingTree(["A", "B"].map(row), [edge("A", "B"), edge("B", "A")]);
    expect(tree.map(shape)).toEqual([
      ["B", ["A"]],
      ["A", ["B"]],
    ]);
  });

  it("is empty when nobody waits", () => {
    expect(buildBlockingTree([row("A")], [])).toEqual([]);
  });
});

describe("flatLocks", () => {
  it("gives one row per waiter and blocker, longest wait first", () => {
    const pairs = flatLocks([row("A"), row("B")], [edge("B", "A", 10), edge("C", "A", 99)]);
    expect(pairs.map((p) => [p.edge.waiter_id, p.waiter?.id ?? null])).toEqual([
      ["C", null],
      ["B", "B"],
    ]);
    expect(pairs[0].blocker?.id).toBe("A");
  });
});
