import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockTauriCore } from "@/test/mock-tauri";
import type { DeviceSession } from "../server-sessions";

vi.mock("@tauri-apps/api/core", () => mockTauriCore());

// `WEB` is read once per module load, so each test picks desktop or web by
// mocking `../web` before importing `../server-sessions` fresh (same
// approach as dispatch.test.ts).
async function loadServerSessions(web: boolean) {
  vi.resetModules();
  vi.doMock("../web", () => ({
    WEB: web,
    wcall: vi.fn().mockResolvedValue({ ended: 0 }),
    wcallEmpty: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock("../web-session", () => ({
    webSessionEnded: vi.fn(),
  }));
  return import("../server-sessions");
}

function device(overrides: Partial<DeviceSession> = {}): DeviceSession {
  return {
    id: "s1",
    device_name: "Ada's Mac",
    platform: "desktop",
    created_ms: 1,
    last_used_ms: 2,
    current: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.doUnmock("../web");
  vi.doUnmock("../web-session");
  vi.resetModules();
});

describe("serversSignOut", () => {
  it("desktop: calls the Tauri command with the profile id", async () => {
    const mod = await loadServerSessions(false);
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    expect(await mod.serversSignOut("p1")).toBe(true);
    expect(invoke).toHaveBeenCalledWith("servers_sign_out", {
      profileId: "p1",
    });
  });

  it("web: tells the server, drops the token and reports success", async () => {
    const mod = await loadServerSessions(true);
    const web = await import("../web");
    const webSession = await import("../web-session");

    expect(await mod.serversSignOut("p1")).toBe(true);
    expect(web.wcallEmpty).toHaveBeenCalledWith(
      "POST",
      "/v1/auth/logout",
      undefined,
      true,
    );
    expect(webSession.webSessionEnded).toHaveBeenCalledTimes(1);
  });

  it("web: still drops the token when the server can't be reached, but reports false", async () => {
    vi.resetModules();
    vi.doMock("../web", () => ({
      WEB: true,
      wcall: vi.fn(),
      wcallEmpty: vi.fn().mockRejectedValue(new Error("network")),
    }));
    vi.doMock("../web-session", () => ({ webSessionEnded: vi.fn() }));
    const mod = await import("../server-sessions");
    const webSession = await import("../web-session");

    expect(await mod.serversSignOut("p1")).toBe(false);
    expect(webSession.webSessionEnded).toHaveBeenCalledTimes(1);
  });
});

describe("serversSessionsList", () => {
  it("desktop: calls the Tauri command", async () => {
    const mod = await loadServerSessions(false);
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue([device()]);

    expect(await mod.serversSessionsList("p1")).toEqual([device()]);
    expect(invoke).toHaveBeenCalledWith("servers_sessions_list", {
      profileId: "p1",
    });
  });

  it("web: calls GET /v1/me/sessions with the session's token", async () => {
    const mod = await loadServerSessions(true);
    const web = await import("../web");
    (web.wcall as ReturnType<typeof vi.fn>).mockResolvedValue([device()]);

    expect(await mod.serversSessionsList("p1")).toEqual([device()]);
    expect(web.wcall).toHaveBeenCalledWith(
      "GET",
      "/v1/me/sessions",
      undefined,
      true,
    );
  });
});

describe("serversSessionEnd", () => {
  it("desktop: forwards the session id alongside the profile id", async () => {
    const mod = await loadServerSessions(false);
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    expect(await mod.serversSessionEnd("p1", device({ id: "s2" }))).toBe(
      false,
    );
    expect(invoke).toHaveBeenCalledWith("servers_session_end", {
      profileId: "p1",
      sessionId: "s2",
    });
  });

  it("web: ending another device does not end this one", async () => {
    const mod = await loadServerSessions(true);
    const web = await import("../web");
    const webSession = await import("../web-session");

    const ended = await mod.serversSessionEnd(
      "p1",
      device({ id: "s2", current: false }),
    );
    expect(ended).toBe(false);
    expect(web.wcallEmpty).toHaveBeenCalledWith(
      "DELETE",
      "/v1/me/sessions/s2",
      undefined,
      true,
    );
    expect(webSession.webSessionEnded).not.toHaveBeenCalled();
  });

  it("web: ending this device tells the page it's signed out", async () => {
    const mod = await loadServerSessions(true);
    const webSession = await import("../web-session");

    const ended = await mod.serversSessionEnd(
      "p1",
      device({ id: "s1", current: true }),
    );
    expect(ended).toBe(true);
    expect(webSession.webSessionEnded).toHaveBeenCalledTimes(1);
  });

  it("web: encodes a session id that needs it", async () => {
    const mod = await loadServerSessions(true);
    const web = await import("../web");

    await mod.serversSessionEnd("p1", device({ id: "s/weird id" }));
    expect(web.wcallEmpty).toHaveBeenCalledWith(
      "DELETE",
      "/v1/me/sessions/s%2Fweird%20id",
      undefined,
      true,
    );
  });
});

describe("serversSessionsEndAll", () => {
  it("desktop: calls the Tauri command", async () => {
    const mod = await loadServerSessions(false);
    const { invoke } = await import("@tauri-apps/api/core");

    await mod.serversSessionsEndAll("p1");
    expect(invoke).toHaveBeenCalledWith("servers_sessions_end_all", {
      profileId: "p1",
    });
  });

  it("web: ends every device and tells the page it's signed out", async () => {
    const mod = await loadServerSessions(true);
    const web = await import("../web");
    const webSession = await import("../web-session");

    await mod.serversSessionsEndAll("p1");
    expect(web.wcallEmpty).toHaveBeenCalledWith(
      "DELETE",
      "/v1/me/sessions",
      undefined,
      true,
    );
    expect(webSession.webSessionEnded).toHaveBeenCalledTimes(1);
  });
});

describe("serversOwnerEndSessions", () => {
  it("desktop: forwards the target user id alongside the profile id", async () => {
    const mod = await loadServerSessions(false);
    const { invoke } = await import("@tauri-apps/api/core");
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValue(3);

    expect(await mod.serversOwnerEndSessions("p1", "u1")).toBe(3);
    expect(invoke).toHaveBeenCalledWith("servers_owner_end_sessions", {
      profileId: "p1",
      userId: "u1",
    });
  });

  it("web: calls the admin route and unwraps the count", async () => {
    const mod = await loadServerSessions(true);
    const web = await import("../web");
    (web.wcall as ReturnType<typeof vi.fn>).mockResolvedValue({ ended: 5 });

    expect(await mod.serversOwnerEndSessions("p1", "u1")).toBe(5);
    expect(web.wcall).toHaveBeenCalledWith(
      "DELETE",
      "/v1/admin/users/u1/sessions",
      undefined,
      true,
    );
  });
});
