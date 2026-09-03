import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";

const apiMocks = vi.hoisted(() => ({
  serversConnect: vi.fn(),
  serversDisconnect: vi.fn(),
  serversDeleteConnection: vi.fn(),
}));

vi.mock("@/shared/api/client", () => ({
  serversConnect: apiMocks.serversConnect,
  serversDisconnect: apiMocks.serversDisconnect,
  serversDeleteConnection: apiMocks.serversDeleteConnection,
  srvConnId: (profileId: string, remoteConnId: string) =>
    `srv:${profileId}:${remoteConnId}`,
}));

// Imported after the mock so sharing-slice.ts picks up the mocked module.
const { sharingActions } = await import("./sharing-slice");

function session(overrides?: { connId?: string }) {
  const connId = overrides?.connId ?? "c1";
  return {
    profile: { id: "p1", name: "Team", url: "https://example.test" },
    me: { device_id: "dev1", is_admin: false },
    connections: [
      {
        id: connId,
        name: "prod",
        host: "db.internal",
        port: 5432,
        user: "alice",
        database: "appdb",
        ssl_mode: null,
        data_access: "readwrite" as const,
        can_edit: true,
        can_delete: true,
      },
    ],
  };
}

/** Minimal store: the sharing slice plus a stub closeConn/view so its
 *  cross-slice calls (get().closeConn, view for the admin-page bounce) work
 *  without pulling in the whole StudioStore. */
function makeStore() {
  return create<
    ReturnType<typeof sharingActions> & {
      closeConn: (id: string) => void;
      closedIds: string[];
      view: string;
      pins: string[];
    }
  >()((set, get) => ({
    ...sharingActions(set as never, get as never),
    closedIds: [],
    closeConn(id: string) {
      set((s) => ({ closedIds: [...s.closedIds, id] }));
    },
    view: "home",
    pins: [],
  }));
}

beforeEach(() => {
  apiMocks.serversConnect.mockReset();
  apiMocks.serversDisconnect.mockReset();
  apiMocks.serversDeleteConnection.mockReset();
});

describe("sharingActions", () => {
  it("connectServer stores the session keyed by profile id, namespaced by srvConnId", async () => {
    apiMocks.serversConnect.mockResolvedValue(session());
    const store = makeStore();
    await store.getState().connectServer("p1");
    const sess = store.getState().serverSessions.p1;
    expect(sess.connIds).toEqual(["srv:p1:c1"]);
    expect(sess.connections[0].id).toBe("srv:p1:c1");
    expect(store.getState().serverBusy).toBe(false);
  });

  it("refreshServers re-fetches only already-connected profiles", async () => {
    apiMocks.serversConnect.mockResolvedValue(session());
    const store = makeStore();
    await store.getState().connectServer("p1");

    apiMocks.serversConnect.mockResolvedValue(session({ connId: "c2" }));
    await store.getState().refreshServers();

    expect(apiMocks.serversConnect).toHaveBeenCalledTimes(2);
    expect(store.getState().serverSessions.p1.connIds).toEqual(["srv:p1:c2"]);
  });

  it("refreshServers is a no-op when nothing is connected", async () => {
    const store = makeStore();
    await store.getState().refreshServers();
    expect(apiMocks.serversConnect).not.toHaveBeenCalled();
  });

  it("disconnectServer closes every tab from that session and drops it", async () => {
    apiMocks.serversConnect.mockResolvedValue(session());
    apiMocks.serversDisconnect.mockResolvedValue(undefined);
    const store = makeStore();
    await store.getState().connectServer("p1");
    // connectServer itself closes stale tabs on connect — isolate what
    // disconnectServer specifically closes.
    store.setState({ closedIds: [] });

    await store.getState().disconnectServer("p1");
    expect(store.getState().closedIds).toEqual(["srv:p1:c1"]);
    expect(store.getState().serverSessions.p1).toBeUndefined();
  });

  it("deleteServerConnection removes just that connection and resyncs", async () => {
    apiMocks.serversConnect.mockResolvedValue(session());
    apiMocks.serversDeleteConnection.mockResolvedValue(undefined);
    const store = makeStore();
    await store.getState().connectServer("p1");

    apiMocks.serversConnect.mockResolvedValue({
      ...session(),
      connections: [],
    });
    await store.getState().deleteServerConnection("p1", "c1", "srv:p1:c1");

    expect(apiMocks.serversDeleteConnection).toHaveBeenCalledWith("p1", "c1");
    expect(store.getState().closedIds).toContain("srv:p1:c1");
    expect(store.getState().serverSessions.p1.connIds).toEqual([]);
  });
});
