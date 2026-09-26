import type { ConnectionInfo } from "../api/types";
import { loadWorkspaceState, saveWorkspaceState } from "../api/workspace-state";
import { tabKey } from "./tab-utils";
import type { PaneNode } from "./pane-layout";
import type { SavedWorkspace, StudioStore } from "./types";

/** Identity a connection's saved workspace is filed under — NEVER the
 *  runtime `conn_id` (a fresh UUID every connect, per
 *  `crates/dh-core/src/db/mod.rs`'s `open_database`/`connect_postgres`/etc.
 *  — it can't survive a restart or even a manual disconnect/reconnect).
 *  `source_path` is the most precise identity available for a file-based
 *  SQLite connection; everything else falls back to kind+name, which is
 *  what the connect dialogs already treat as "the same target" for
 *  duplicate-tab detection (see `connections.ts`'s `sameConnectionTarget`). */
export function stableConnKey(
  conn: Pick<ConnectionInfo, "kind" | "name" | "source_path">,
): string {
  if (conn.kind === "sqlite" && conn.source_path) {
    return `sqlite:${conn.source_path}`;
  }
  return `${conn.kind}:${conn.name}`;
}

/** Give SQL tabs saved before their key carried a connection (`sql:0`) the
 *  connection they're being restored into, so they stop sharing store
 *  entries with another connection's same-numbered tab. Rewrites every place
 *  the old key was stored: the tab list, the active tab, the pane layout and
 *  the saved editor text. Returns `saved` itself when nothing needs it. */
export function stampLegacySqlTabs(
  saved: SavedWorkspace,
  connId: string,
): SavedWorkspace {
  const renamed = new Map<string, string>();
  const tabs = saved.workspace.tabs.map((tab) => {
    if (tab.kind !== "sql" || tab.conn_id) return tab;
    const stamped = { ...tab, conn_id: connId };
    renamed.set(tabKey(tab), tabKey(stamped));
    return stamped;
  });
  if (renamed.size === 0) return saved;

  const rekey = (key: string) => renamed.get(key) ?? key;
  const rekeyLayout = (node: PaneNode): PaneNode =>
    node.type === "leaf"
      ? {
          ...node,
          tabKeys: node.tabKeys.map(rekey),
          activeTabKey: node.activeTabKey && rekey(node.activeTabKey),
        }
      : { ...node, children: node.children.map(rekeyLayout) };
  const { active } = saved.workspace;
  return {
    workspace: {
      ...saved.workspace,
      tabs,
      active:
        active &&
        (tabs.find((t) => tabKey(t) === rekey(tabKey(active))) ?? active),
      layout: rekeyLayout(saved.workspace.layout),
    },
    sqlSeeds: Object.fromEntries(
      Object.entries(saved.sqlSeeds).map(([k, v]) => [rekey(k), v]),
    ),
  };
}

interface WorkspaceSnapshotV1 {
  version: 1;
  byConn: Record<string, SavedWorkspace>;
}

/** A connection's tabs plus their editor text, or null with no tabs. */
export function savedWorkspaceOf(
  state: StudioStore,
  conn: ConnectionInfo,
): SavedWorkspace | null {
  const ws = state.workspaces[conn.id];
  if (!ws || ws.tabs.length === 0) return null;
  const sqlSeeds: Record<string, string> = {};
  for (const tab of ws.tabs) {
    const tk = tabKey(tab);
    const seed = state.sqlSeeds[tk];
    if (seed !== undefined) sqlSeeds[tk] = seed;
  }
  return { workspace: ws, sqlSeeds };
}

/** Build the full snapshot to persist — every currently-open connection
 *  that actually has tabs, re-keyed from its ephemeral `conn_id` to a
 *  stable identity so it can be matched up again after a restart. Tabs
 *  still waiting for a reconnect are kept too. */
export function buildWorkspaceSnapshot(
  state: StudioStore,
): WorkspaceSnapshotV1 {
  const byConn: Record<string, SavedWorkspace> = {
    ...state.pendingWorkspaceRestore,
  };
  for (const conn of state.open) {
    const saved = savedWorkspaceOf(state, conn);
    if (saved) byConn[stableConnKey(conn)] = saved;
  }
  return { version: 1, byConn };
}

/** Debounced disk write — several store fields can change in a burst (e.g.
 *  every keystroke in a query editor updates `sqlSeeds`), and this is
 *  cheap to coalesce since only the LAST snapshot in a burst matters. */
let save_timer: ReturnType<typeof setTimeout> | null = null;
export function scheduleWorkspaceSave(getState: () => StudioStore): void {
  if (save_timer !== null) clearTimeout(save_timer);
  save_timer = setTimeout(() => {
    save_timer = null;
    void saveWorkspaceState(buildWorkspaceSnapshot(getState()));
  }, 800);
}

/** Load the last-saved snapshot at startup. Returns `{}` for a missing,
 *  corrupt, or pre-this-feature file — never throws. */
export async function loadPendingWorkspaceRestores(): Promise<
  Record<string, SavedWorkspace>
> {
  const raw = await loadWorkspaceState().catch(() => null);
  if (!raw || typeof raw !== "object") return {};
  const snap = raw as Partial<WorkspaceSnapshotV1>;
  if (snap.version !== 1 || !snap.byConn) return {};
  return snap.byConn;
}
