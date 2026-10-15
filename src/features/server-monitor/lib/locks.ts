import type { BlockEdge, SessionRow } from "@/shared/api";

/** One node of the blocking tree: a session, and the edge that put it under
 *  its parent (`null` for a root blocker). */
export interface LockNode {
  id: string;
  /** `null` when the session is not in the snapshot (it ended, or is not a
   *  client session). */
  row: SessionRow | null;
  edge: BlockEdge | null;
  children: LockNode[];
}

/** The Postgres blocking tree (AC-7): each root blocker at the top, the
 *  sessions it blocks nested under it, and so on down. Built from the whole
 *  snapshot, so a blocker the Sessions filters would hide still shows. A
 *  waiter blocked by two sessions shows under both; a cycle (a deadlock the
 *  server has not broken yet) is cut where it would repeat. */
export function buildBlockingTree(
  sessions: SessionRow[],
  blocks: BlockEdge[],
): LockNode[] {
  const rows = new Map(sessions.map((s) => [s.id, s]));
  const waitersOf = new Map<string, BlockEdge[]>();
  const waiting = new Set<string>();
  for (const b of blocks) {
    waiting.add(b.waiter_id);
    const list = waitersOf.get(b.blocker_id) ?? [];
    list.push(b);
    waitersOf.set(b.blocker_id, list);
  }

  const grow = (
    id: string,
    edge: BlockEdge | null,
    path: Set<string>,
  ): LockNode => {
    const next = new Set(path).add(id);
    const children = (waitersOf.get(id) ?? [])
      .filter((e) => !next.has(e.waiter_id))
      .sort((a, b) => b.wait_ms - a.wait_ms)
      .map((e) => grow(e.waiter_id, e, next));
    return { id, row: rows.get(id) ?? null, edge, children };
  };

  let roots = [...waitersOf.keys()].filter((id) => !waiting.has(id));
  // Only cycles: start from every blocker so nothing goes missing.
  if (roots.length === 0) roots = [...waitersOf.keys()];
  return roots
    .map((id) => grow(id, null, new Set()))
    .sort((a, b) => countBlocked(b) - countBlocked(a));
}

/** How many sessions sit under a node, all the way down. */
export function countBlocked(node: LockNode): number {
  return node.children.reduce((n, c) => n + 1 + countBlocked(c), 0);
}

/** The Flat view: one row per waiting session and blocker. */
export interface FlatLock {
  edge: BlockEdge;
  waiter: SessionRow | null;
  blocker: SessionRow | null;
}

export function flatLocks(
  sessions: SessionRow[],
  blocks: BlockEdge[],
): FlatLock[] {
  const rows = new Map(sessions.map((s) => [s.id, s]));
  return [...blocks]
    .sort((a, b) => b.wait_ms - a.wait_ms)
    .map((edge) => ({
      edge,
      waiter: rows.get(edge.waiter_id) ?? null,
      blocker: rows.get(edge.blocker_id) ?? null,
    }));
}
