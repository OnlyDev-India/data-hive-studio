import type { StoreApi } from "zustand";
import type { ConnectionInfo } from "../api/types";
import type { StudioStore } from "./types";

type SetState = StoreApi<StudioStore>["setState"];

export function connectionActions(set: SetState) {
  return {
    openConn(conn: ConnectionInfo) {
      set((state) => {
        const open = [conn, ...state.open.filter((c) => c.id !== conn.id)];
        const recent = [
          conn,
          ...state.recent.filter((c) => c.id !== conn.id),
        ].slice(0, 8);
        return { open, recent, activeId: conn.id, view: "workspace" };
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
          return { open, activeId: null, view: "home", workspaces };
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
