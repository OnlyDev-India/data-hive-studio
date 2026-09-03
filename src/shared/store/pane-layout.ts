/** Pane layout tree for split-view (drag-a-tab-to-split, VS Code style).
 *
 * This module is pure and framework-agnostic — no React/Zustand imports —
 * so the tree shape and its structural operations are unit-testable in
 * isolation from the store.
 *
 * Only `tabKey` strings are stored here, never `StudioTab` objects. A tab's
 * identity/state (its seed text, dirty flag, grid bridge, etc.) lives
 * entirely in `WorkspaceTabs.tabs` and the various `tabKey`-keyed maps on
 * the store, independent of which pane currently displays it.
 *
 * Invariant every mutator must preserve: a given `tabKey` appears in the
 * `tabKeys` of EXACTLY ONE leaf at any time, and the union of every leaf's
 * `tabKeys` equals the workspace's `tabs` as a set. This is what guarantees
 * a tab is moved between panes, never mirrored open in two at once.
 */

export interface PaneLeaf {
  type: "leaf";
  id: string;
  tabKeys: string[];
  activeTabKey: string | null;
}

export interface PaneSplit {
  type: "split";
  id: string;
  /** Matches ResizablePanelGroup's `orientation`: "horizontal" = side by
   *  side (left/right), "vertical" = stacked (top/bottom). */
  direction: "horizontal" | "vertical";
  /** Length >= 2. */
  children: PaneNode[];
  /** Percentages, same order as `children`, sums to 100. */
  sizes: number[];
}

export type PaneNode = PaneLeaf | PaneSplit;

let pane_seq = 0;
export function newPaneId(): string {
  pane_seq += 1;
  return `pane-${pane_seq}`;
}

export function emptyLeaf(id: string = newPaneId()): PaneLeaf {
  return { type: "leaf", id, tabKeys: [], activeTabKey: null };
}

export function findNode(tree: PaneNode, id: string): PaneNode | null {
  if (tree.id === id) return tree;
  if (tree.type === "split") {
    for (const c of tree.children) {
      const found = findNode(c, id);
      if (found) return found;
    }
  }
  return null;
}

export function findLeaf(tree: PaneNode, id: string): PaneLeaf | null {
  const n = findNode(tree, id);
  return n && n.type === "leaf" ? n : null;
}

/** The leaf whose `tabKeys` currently contains `key`, or null if it's not
 *  owned by any pane (shouldn't happen given the invariant above). */
export function findOwnerLeaf(tree: PaneNode, key: string): PaneLeaf | null {
  if (tree.type === "leaf") return tree.tabKeys.includes(key) ? tree : null;
  for (const c of tree.children) {
    const found = findOwnerLeaf(c, key);
    if (found) return found;
  }
  return null;
}

/** The split node directly containing `nodeId` as one of its children, or
 *  null if `nodeId` is the tree root or not found. */
export function findParent(tree: PaneNode, nodeId: string): PaneSplit | null {
  if (tree.type !== "split") return null;
  for (const c of tree.children) {
    if (c.id === nodeId) return tree;
    const found = findParent(c, nodeId);
    if (found) return found;
  }
  return null;
}

export function allLeaves(tree: PaneNode): PaneLeaf[] {
  if (tree.type === "leaf") return [tree];
  return tree.children.flatMap(allLeaves);
}

/** Immutably rewrite the node with id `nodeId` via `replacer`. Returns
 *  `tree` unchanged (same reference) if `nodeId` isn't found anywhere. */
export function replaceNode(
  tree: PaneNode,
  nodeId: string,
  replacer: (n: PaneNode) => PaneNode,
): PaneNode {
  if (tree.id === nodeId) return replacer(tree);
  if (tree.type !== "split") return tree;
  let changed = false;
  const children = tree.children.map((c) => {
    const next = replaceNode(c, nodeId, replacer);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...tree, children } : tree;
}

/** Insert `key` into leaf `leafId`'s `tabKeys` (no-op if already present)
 *  and make it that leaf's active tab. Returns `tree` unchanged if the leaf
 *  isn't found. */
export function addKeyToLeaf(
  tree: PaneNode,
  leafId: string,
  key: string,
): PaneNode {
  return replaceNode(tree, leafId, (n) => {
    if (n.type !== "leaf") return n;
    const tabKeys = n.tabKeys.includes(key) ? n.tabKeys : [...n.tabKeys, key];
    return { ...n, tabKeys, activeTabKey: key };
  });
}

/** Remove `key` from whichever leaf owns it. If it was that leaf's active
 *  tab, a neighbor (by index, clamped) becomes active instead. If the leaf
 *  becomes empty, it's collapsed out of the tree via `removeLeaf`. No-op if
 *  `key` isn't owned anywhere. */
export function removeKeyFromLayout(
  tree: PaneNode,
  key: string,
  emptyLeafFactory: () => PaneLeaf,
): PaneNode {
  const owner = findOwnerLeaf(tree, key);
  if (!owner) return tree;
  const idx = owner.tabKeys.indexOf(key);
  const tabKeys = owner.tabKeys.filter((k) => k !== key);
  if (tabKeys.length === 0) return removeLeaf(tree, owner.id, emptyLeafFactory);
  const activeTabKey =
    owner.activeTabKey === key
      ? tabKeys[Math.min(idx, tabKeys.length - 1)]
      : owner.activeTabKey;
  return replaceNode(tree, owner.id, (n) =>
    n.type === "leaf" ? { ...n, tabKeys, activeTabKey } : n,
  );
}

/** Remove the (now-empty) leaf `leafId` from the tree. Collapses a parent
 *  split down to its one remaining child when only one sibling is left
 *  (renormalizing sizes to sum to 100), cascading naturally: a collapsed
 *  split is replaced by a bare node in ITS OWN parent's children, so no
 *  further passes are needed. Returns a fresh empty leaf via
 *  `emptyLeafFactory` if the whole tree becomes empty. */
export function removeLeaf(
  tree: PaneNode,
  leafId: string,
  emptyLeafFactory: () => PaneLeaf,
): PaneNode {
  if (tree.type === "leaf") {
    return tree.id === leafId ? emptyLeafFactory() : tree;
  }
  const idx = tree.children.findIndex((c) => c.id === leafId);
  if (idx < 0) {
    let changed = false;
    const children = tree.children.map((c) => {
      const next = removeLeaf(c, leafId, emptyLeafFactory);
      if (next !== c) changed = true;
      return next;
    });
    return changed ? { ...tree, children } : tree;
  }
  const children = tree.children.filter((_, i) => i !== idx);
  const sizes = tree.sizes.filter((_, i) => i !== idx);
  if (children.length === 1) return children[0];
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return { ...tree, children, sizes: sizes.map((s) => (s / total) * 100) };
}

/** Split leaf `targetLeafId` in `direction`, inserting `newLeaf` before/after
 *  it. If the target's parent is already a same-direction split, `newLeaf`
 *  is spliced in as a sibling instead of nesting a level deeper — matches
 *  VS Code's handling of 3+-way splits along one axis. Otherwise the target
 *  leaf is wrapped in a brand-new 2-child split. No-op if `targetLeafId`
 *  isn't found. */
export function insertSplit(
  tree: PaneNode,
  targetLeafId: string,
  newLeaf: PaneLeaf,
  direction: PaneSplit["direction"],
  before: boolean,
): PaneNode {
  const target = findLeaf(tree, targetLeafId);
  if (!target) return tree;
  const parent = findParent(tree, targetLeafId);
  if (parent && parent.direction === direction) {
    const idx = parent.children.findIndex((c) => c.id === targetLeafId);
    if (idx < 0) return tree;
    const half = parent.sizes[idx] / 2;
    const children = [...parent.children];
    const sizes = [...parent.sizes];
    sizes[idx] = half;
    const insertAt = before ? idx : idx + 1;
    children.splice(insertAt, 0, newLeaf);
    sizes.splice(insertAt, 0, half);
    return replaceNode(tree, parent.id, () => ({ ...parent, children, sizes }));
  }
  const wrapped: PaneSplit = {
    type: "split",
    id: newPaneId(),
    direction,
    children: before ? [newLeaf, target] : [target, newLeaf],
    sizes: [50, 50],
  };
  return replaceNode(tree, targetLeafId, () => wrapped);
}
