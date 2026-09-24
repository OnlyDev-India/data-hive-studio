import { afterEach, describe, expect, it, vi } from "vitest";
import { mockTauriCore } from "@/test/mock-tauri";
import type { MeResult, OrgRole } from "../server-admin";

vi.mock("@tauri-apps/api/core", () => mockTauriCore());

// Session related exports of server-admin.ts only (signed_in / reuse /
// sign-out-when-last-profile / friendlyConnectError) — the rest of this file
// is connections and org membership, out of scope for this pass. Same fresh
// module per WEB mode approach as dispatch.test.ts.
async function loadServerAdmin(web: boolean, overrides: Record<string, unknown> = {}) {
  vi.resetModules();
  vi.doMock("../web", () => ({
    WEB: web,
    wcall: vi.fn().mockResolvedValue({}),
    wcallEmpty: vi.fn().mockResolvedValue(undefined),
    webListServers: vi.fn().mockReturnValue([]),
    webServerConfig: vi.fn().mockReturnValue(undefined),
    webRemoveServer: vi.fn(),
    ...overrides,
  }));
  vi.doMock("../web-session", () => ({
    isSignedOut: vi.fn().mockReturnValue(false),
    webRestoreSession: vi.fn().mockResolvedValue(true),
  }));
  vi.doMock("../server-sessions", () => ({
    webSignOut: vi.fn().mockResolvedValue(true),
  }));
  return import("../server-admin");
}

function me(orgs: { id: string; role: OrgRole }[]): MeResult {
  return {
    user_id: "u1",
    email: "u@x.com",
    name: "U",
    server_role: "member",
    can_manage_roles: false,
    can_create_org: false,
    orgs: orgs.map((o) => ({ id: o.id, role: o.role, name: o.id, slug: o.id, created_ms: 0 })),
  };
}

afterEach(() => {
  vi.doUnmock("../web");
  vi.doUnmock("../web-session");
  vi.doUnmock("../server-sessions");
  vi.resetModules();
});

describe("canManageOrg", () => {
  it("owner and admin may manage, member may not", async () => {
    const mod = await loadServerAdmin(false);
    for (const role of ["owner", "admin"] as OrgRole[]) {
      expect(mod.canManageOrg(me([{ id: "o1", role }]), "o1")).toBe(true);
    }
    expect(mod.canManageOrg(me([{ id: "o1", role: "member" }]), "o1")).toBe(false);
  });

  it("is false for an org the person is not in", async () => {
    const mod = await loadServerAdmin(false);
    expect(mod.canManageOrg(me([{ id: "o1", role: "owner" }]), "o2")).toBe(
      false,
    );
  });
});

describe("canPublishConnections", () => {
  it("owner, admin and member may all publish", async () => {
    const mod = await loadServerAdmin(false);
    for (const role of ["owner", "admin", "member"] as OrgRole[]) {
      expect(
        mod.canPublishConnections(me([{ id: "o1", role }]), "o1"),
      ).toBe(true);
    }
  });

  it("is false for an org the person is not in", async () => {
    const mod = await loadServerAdmin(false);
    expect(mod.canPublishConnections(me([{ id: "o1", role: "owner" }]), "o2")).toBe(
      false,
    );
  });
});

describe("serversReuseSession", () => {
  it("desktop: calls the Tauri command", async () => {
    const mod = await loadServerAdmin(false);
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue({ me: me([]) });

    expect(await mod.serversReuseSession("https://x")).toEqual({ me: me([]) });
    expect(invoke).toHaveBeenCalledWith("servers_reuse_session", {
      url: "https://x",
    });
  });

  it("web: a usable session returns /v1/me", async () => {
    const mod = await loadServerAdmin(true);
    const web = await import("../web");
    (web.wcall as ReturnType<typeof vi.fn>).mockResolvedValue(me([]));

    expect(await mod.serversReuseSession("https://x")).toEqual({ me: me([]) });
    expect(web.wcall).toHaveBeenCalledWith("GET", "/v1/me", undefined, true);
  });

  it("web: no usable session is null, not a throw", async () => {
    vi.resetModules();
    vi.doMock("../web", () => ({
      WEB: true,
      wcall: vi.fn(),
      wcallEmpty: vi.fn(),
      webListServers: vi.fn(),
      webServerConfig: vi.fn(),
      webRemoveServer: vi.fn(),
    }));
    vi.doMock("../web-session", () => ({
      isSignedOut: vi.fn(),
      webRestoreSession: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock("../server-sessions", () => ({ webSignOut: vi.fn() }));
    const mod = await import("../server-admin");
    expect(await mod.serversReuseSession("https://x")).toBeNull();
  });

  it("web: an unreachable server is also null", async () => {
    vi.resetModules();
    vi.doMock("../web", () => ({
      WEB: true,
      wcall: vi.fn(),
      wcallEmpty: vi.fn(),
      webListServers: vi.fn(),
      webServerConfig: vi.fn(),
      webRemoveServer: vi.fn(),
    }));
    vi.doMock("../web-session", () => ({
      isSignedOut: vi.fn(),
      webRestoreSession: vi.fn().mockRejectedValue(new TypeError("fetch")),
    }));
    vi.doMock("../server-sessions", () => ({ webSignOut: vi.fn() }));
    const mod = await import("../server-admin");
    expect(await mod.serversReuseSession("https://x")).toBeNull();
  });
});

describe("serversList", () => {
  const profile = {
    id: "p1",
    name: "Acme",
    url: "https://x",
    org_id: "o1",
  };

  it("desktop: calls the Tauri command", async () => {
    const mod = await loadServerAdmin(false);
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await mod.serversList();
    expect(invoke).toHaveBeenCalledWith("servers_list");
  });

  it("web: signed in marks every saved profile connected", async () => {
    const mod = await loadServerAdmin(true, {
      webListServers: vi.fn().mockReturnValue([profile]),
    });
    expect(await mod.serversList()).toEqual([
      { ...profile, connected: true, signed_in: true },
    ]);
  });

  it("web: signed out marks profiles not connected", async () => {
    vi.resetModules();
    vi.doMock("../web", () => ({
      WEB: true,
      wcall: vi.fn(),
      wcallEmpty: vi.fn(),
      webListServers: vi.fn().mockReturnValue([profile]),
      webServerConfig: vi.fn(),
      webRemoveServer: vi.fn(),
    }));
    vi.doMock("../web-session", () => ({
      isSignedOut: vi.fn(),
      webRestoreSession: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock("../server-sessions", () => ({ webSignOut: vi.fn() }));
    const mod = await import("../server-admin");
    expect(await mod.serversList()).toEqual([
      { ...profile, connected: false, signed_in: false },
    ]);
  });

  it("web: an unreachable server is unknown, not shown as signed out", async () => {
    vi.resetModules();
    vi.doMock("../web", () => ({
      WEB: true,
      wcall: vi.fn(),
      wcallEmpty: vi.fn(),
      webListServers: vi.fn().mockReturnValue([profile]),
      webServerConfig: vi.fn(),
      webRemoveServer: vi.fn(),
    }));
    vi.doMock("../web-session", () => ({
      isSignedOut: vi.fn(),
      webRestoreSession: vi.fn().mockRejectedValue(new TypeError("fetch")),
    }));
    vi.doMock("../server-sessions", () => ({ webSignOut: vi.fn() }));
    const mod = await import("../server-admin");
    expect(await mod.serversList()).toEqual([
      { ...profile, connected: false, signed_in: true },
    ]);
  });
});

describe("serversRemove", () => {
  it("desktop: calls the Tauri command", async () => {
    const mod = await loadServerAdmin(false);
    const { invoke } = await import("@tauri-apps/api/core");

    await mod.serversRemove("p1");
    expect(invoke).toHaveBeenCalledWith("servers_remove", {
      profileId: "p1",
    });
  });

  it("web: removes the profile, and signs out when it was the last one", async () => {
    const mod = await loadServerAdmin(true, {
      webListServers: vi.fn().mockReturnValue([]),
    });
    const web = await import("../web");
    const sessions = await import("../server-sessions");

    await mod.serversRemove("p1");
    expect(web.webRemoveServer).toHaveBeenCalledWith("p1");
    expect(sessions.webSignOut).toHaveBeenCalledTimes(1);
  });

  it("web: leaves the session alone when another profile remains", async () => {
    const mod = await loadServerAdmin(true, {
      webListServers: vi
        .fn()
        .mockReturnValue([{ id: "p2", name: "Other", url: "", org_id: "o2" }]),
    });
    const sessions = await import("../server-sessions");

    await mod.serversRemove("p1");
    expect(sessions.webSignOut).not.toHaveBeenCalled();
  });
});

describe("friendlyConnectError", () => {
  it("signed out points at Sign in again", async () => {
    const mod = await loadServerAdmin(false);
    const web = await import("../web-session");
    (web.isSignedOut as ReturnType<typeof vi.fn>).mockReturnValue(true);

    expect(mod.friendlyConnectError("Acme", new Error("signed_out"))).toMatch(
      /Acme.*Sign in again/,
    );
  });

  it("anything else names the server and the cause", async () => {
    const mod = await loadServerAdmin(false);
    const web = await import("../web-session");
    (web.isSignedOut as ReturnType<typeof vi.fn>).mockReturnValue(false);

    expect(mod.friendlyConnectError("Acme", new Error("boom"))).toBe(
      'Couldn\'t connect to "Acme": Error: boom',
    );
  });
});
