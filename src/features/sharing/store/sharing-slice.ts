import type { StoreApi } from "zustand";
import {
  serversConnect as apiServersConnect,
  serversDisconnect as apiServersDisconnect,
  serversDeleteConnection as apiServersDeleteConnection,
  srvConnId,
} from "@/shared/api/client";
import type { StudioStore } from "@/shared/store/types";

type SetState = StoreApi<StudioStore>["setState"];
type GetState = StoreApi<StudioStore>["getState"];

type ServerSessionPayload = Awaited<ReturnType<typeof apiServersConnect>>;

/** Normalize a server payload into session-connection entries keyed by the
 *  namespaced `srv:<profile>:<conn>` id. */
function mapSessionConns(profileId: string, session: ServerSessionPayload) {
  return session.connections.map((c) => ({
    id: srvConnId(profileId, c.id),
    name: c.name,
    kind: c.kind ?? "postgres",
    host: c.host,
    port: c.port,
    user: c.user,
    database: c.database,
    ssl_mode: c.ssl_mode ?? null,
    auth_db: c.auth_db,
    srv: c.srv ?? false,
    tls: c.tls ?? false,
    data_access: c.data_access,
    can_edit: c.can_edit,
    can_delete: c.can_delete,
  }));
}

/** Team-server (dh-server profile) session state: connected profiles' shared
 *  catalogs, keyed by profile id, plus the connect/disconnect/refresh/delete
 *  actions that keep them in sync. */
export function sharingActions(set: SetState, get: GetState) {
  return {
    // Explicit type (not just `{}`, which TS infers as the empty-object
    // type) so this slice's own return type is correct standalone —
    // matters for testing it in isolation (see sharing-slice.test.ts).
    serverSessions: {} as StudioStore["serverSessions"],
    serverBusy: false,
    /** Connect to a team server: fetch its shared-connection catalog into
     *  the session. Does NOT open anything — the landing sidebar lists
     *  what's shared and the user connects explicitly. */
    async connectServer(profileId: string) {
      set({ serverBusy: true });
      try {
        const session = await apiServersConnect(profileId);
        const conns = mapSessionConns(profileId, session);
        set((s) => {
          // Drop any stale tabs from a previous session of this profile.
          for (const c of conns) get().closeConn(c.id);
          return {
            serverSessions: {
              ...s.serverSessions,
              [profileId]: {
                profile: session.profile,
                me: session.me,
                connIds: conns.map((c) => c.id),
                connections: conns,
              },
            },
          };
        });
      } finally {
        set({ serverBusy: false });
      }
    },

    /** Refresh every connected server's catalog in place — open tabs and
     *  workspaces stay untouched; new/removed shares reflect in lists. */
    async refreshServers() {
      const ids = Object.keys(get().serverSessions);
      if (ids.length === 0) return;
      set({ serverBusy: true });
      try {
        await Promise.all(
          ids.map(async (profileId) => {
            try {
              const session = await apiServersConnect(profileId);
              const conns = mapSessionConns(profileId, session);
              set((s) => {
                const cur = s.serverSessions[profileId];
                if (!cur) return {};
                return {
                  serverSessions: {
                    ...s.serverSessions,
                    [profileId]: {
                      ...cur,
                      profile: session.profile,
                      me: session.me,
                      connIds: conns.map((c) => c.id),
                      connections: conns,
                    },
                  },
                };
              });
            } catch {
              // offline/unreachable — keep current catalog until next try
            }
          }),
        );
      } finally {
        set({ serverBusy: false });
      }
    },
    async disconnectServer(profileId: string) {
      await apiServersDisconnect(profileId);
      set((s) => {
        const sess = s.serverSessions[profileId];
        if (!sess) return {};
        for (const id of sess.connIds) get().closeConn(id);
        const next = { ...s.serverSessions };
        delete next[profileId];
        // Leaving the admin page when its session is gone.
        const still_admin = Object.values(next).some((x) => x.me.is_admin);
        if (s.view === "admin" && !still_admin)
          return { serverSessions: next, view: "home" };
        return { serverSessions: next };
      });
    },
    async deleteServerConnection(
      profileId: string,
      connId: string,
      srvId: string,
    ) {
      await apiServersDeleteConnection(profileId, connId);
      set((s) => {
        get().closeConn(srvId);
        const sess = s.serverSessions[profileId];
        if (!sess) return {};
        return {
          serverSessions: {
            ...s.serverSessions,
            [profileId]: {
              ...sess,
              connections: sess.connections.filter((c) => c.id !== connId),
              connIds: sess.connIds.filter((id) => id !== srvId),
            },
          },
          pins: s.pins.filter((p) => p !== srvId),
        };
      });
      // Resync with the server so any drift (e.g. deletions from other
      // devices) also reflects immediately.
      void get().refreshServers();
    },
  };
}
