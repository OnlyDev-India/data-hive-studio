import type { StoreApi } from "zustand";
import { closeConnection } from "../api/connection";
import type { ConnectionInfo } from "../api/types";
import type { SavedConnParams, StudioStore } from "./types";
import { stableConnKey } from "./workspace-persistence";

type SetState = StoreApi<StudioStore>["setState"];

/** Whether `a`/`b` are the SAME underlying database, even though each local
 *  connect mints a fresh backend session id (so `a.id !== b.id` for two
 *  connects of the exact same target) — server-backed (`srv:`) connections
 *  already have a stable, deterministic id per (profile, remote) pair and
 *  never need this: identical targets there already share one id. */
function sameConnectionTarget(
  a: ConnectionInfo,
  b: ConnectionInfo,
  recentParams: Record<string, SavedConnParams>,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "sqlite") {
    // Only a real file on disk can collide; two freshly-created in-memory
    // databases (no source_path yet) are legitimately distinct.
    return !!a.source_path && a.source_path === b.source_path;
  }
  const pa = recentParams[a.id];
  const pb = recentParams[b.id];
  if (!pa || !pb) return false;
  return (
    pa.host === pb.host &&
    pa.port === pb.port &&
    pa.user === pb.user &&
    pa.database === pb.database
  );
}

export function connectionActions(set: SetState) {
  return {
    // Populated once at startup from the last-saved workspace snapshot (see
    // studio.tsx's bootstrap effect) and claimed one entry at a time below.
    pendingWorkspaceRestore: {},
    setPendingWorkspaceRestore(map: StudioStore["pendingWorkspaceRestore"]) {
      set({ pendingWorkspaceRestore: map });
    },
    openConn(conn: ConnectionInfo) {
      set((state) => {
        const dup = state.open.find(
          (c) => c.id !== conn.id && sameConnectionTarget(c, conn, state.recentParams),
        );
        if (dup) {
          // Same connection is already open under a different session id —
          // switch to it instead of adding a duplicate tab, and release the
          // redundant backend session `conn` just opened.
          void closeConnection(conn.id);
          const recent = [
            dup,
            ...state.recent.filter((c) => c.id !== dup.id),
          ].slice(0, 8);
          return { activeId: dup.id, recent, view: "workspace" };
        }
        const open = [conn, ...state.open.filter((c) => c.id !== conn.id)];
        const recent = [
          conn,
          ...state.recent.filter((c) => c.id !== conn.id),
        ].slice(0, 8);

        // Claim this connection's saved tabs/layout/editor-text, if this is
        // the same target (by stable identity, not the ephemeral runtime
        // id) as one that had a saved workspace from a previous session.
        // One-shot: removed from the pending bucket either way, so a second
        // connect to the same target later starts fresh rather than
        // re-claiming stale state out from under the first tab.
        const key = stableConnKey(conn);
        const pending = state.pendingWorkspaceRestore[key];
        if (!pending) {
          return { open, recent, activeId: conn.id, view: "workspace" };
        }
        const pendingWorkspaceRestore = { ...state.pendingWorkspaceRestore };
        delete pendingWorkspaceRestore[key];
        return {
          open,
          recent,
          activeId: conn.id,
          view: "workspace",
          workspaces: { ...state.workspaces, [conn.id]: pending.workspace },
          sqlSeeds: { ...state.sqlSeeds, ...pending.sqlSeeds },
          pendingWorkspaceRestore,
        };
      });
    },
    setActive(id: string) {
      set({ activeId: id });
    },
    closeConn(id: string) {
      set((state) => {
        const open = state.open.filter((c) => c.id !== id);
        if (open.length === 0) {
          const workspaces = { ...state.workspaces };
          delete workspaces[id];
          return {
            open,
            activeId: null,
            view: "home",
            workspaces,
            // The landing page shares the SAME left-panel state as a
            // connection's workspace — without this, disconnecting while
            // viewing Activity leaves the home screen stuck showing it too
            // (now scoped to nothing, since there's no connection left)
            // instead of the home sidebar the user actually lands on.
            leftPanelMode: "tables",
          };
        }
        return {
          open,
          activeId: state.activeId === id ? open[0].id : state.activeId,
        };
      });
    },
    /** Replace a connection in place (e.g. after it gains a saved file path). */
    updateConn(id: string, patch: Partial<ConnectionInfo>) {
      set((state) => {
        const open = state.open.map((c) =>
          c.id === id ? { ...c, ...patch } : c,
        );
        const recent = state.recent.map((c) =>
          c.id === id ? { ...c, ...patch } : c,
        );
        return { open, recent };
      });
    },
  };
}
