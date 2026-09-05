import type { ConnectionInfo } from "../api/types";
import { loadWorkspaceState, saveWorkspaceState } from "../api/workspace-state";
import { tabKey } from "./tab-utils";
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

interface WorkspaceSnapshotV1 {
  version: 1;
  byConn: Record<string, SavedWorkspace>;
}

/** Build the full snapshot to persist — every currently-open connection
 *  that actually has tabs, re-keyed from its ephemeral `conn_id` to a
 *  stable identity so it can be matched up again after a restart. */
export function buildWorkspaceSnapshot(state: StudioStore): WorkspaceSnapshotV1 {
  const byConn: Record<string, SavedWorkspace> = {};
  for (const conn of state.open) {
    const ws = state.workspaces[conn.id];
    if (!ws || ws.tabs.length === 0) continue;
    const sqlSeeds: Record<string, string> = {};
    for (const tab of ws.tabs) {
      const tk = tabKey(tab);
      const seed = state.sqlSeeds[tk];
      if (seed !== undefined) sqlSeeds[tk] = seed;
    }
    byConn[stableConnKey(conn)] = { workspace: ws, sqlSeeds };
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
