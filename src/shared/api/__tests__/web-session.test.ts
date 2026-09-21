import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The session keeps its token in module state, so every test loads a fresh copy.
async function load() {
  vi.resetModules();
  const session = await import("../web-session");
  const web = await import("../web");
  return { session, web };
}

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Stub `fetch` with a router, and keep a log of what was asked. */
function stubFetch(route: Route) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return route(url, init);
    }),
  );
  return calls;
}

const auth = (init: RequestInit) =>
  (init.headers as Record<string, string> | undefined)?.Authorization;

const renewed = (n: number) => ({
  access_token: `dha_renewed${n}`,
  expires_in: 900,
  session_id: "s1",
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renewal", () => {
  it("several callers at once cause exactly one renewal", async () => {
    const calls = stubFetch(() => json(200, renewed(1)));
    const { session } = await load();
    const tokens = await Promise.all([
      session.webAccessToken(),
      session.webAccessToken(),
      session.webAccessToken(),
    ]);
    expect(tokens).toEqual(["dha_renewed1", "dha_renewed1", "dha_renewed1"]);
    expect(calls.filter((c) => c.url === "/auth/refresh")).toHaveLength(1);
  });

  it("sends an empty JSON body and relies on the cookie, never a token", async () => {
    const calls = stubFetch(() => json(200, renewed(1)));
    const { session } = await load();
    await session.webAccessToken();
    const { init } = calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(auth(init)).toBeUndefined();
  });

  it("goes through navigator.locks so tabs take turns", async () => {
    stubFetch(() => json(200, renewed(1)));
    const request = vi.fn((_name: string, fn: () => Promise<string>) => fn());
    vi.stubGlobal("navigator", { ...navigator, locks: { request } });
    const { session } = await load();
    await session.webAccessToken();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("dh-session-renew");
  });

  it("uses a token that still has time, and renews one about to expire", async () => {
    const calls = stubFetch(() => json(200, renewed(1)));
    const { session } = await load();
    session.webSetAccess({ access_token: "dha_fresh", expires_in: 900 });
    expect(await session.webAccessToken()).toBe("dha_fresh");
    expect(calls).toHaveLength(0);

    session.webSetAccess({ access_token: "dha_late", expires_in: 30 });
    expect(await session.webAccessToken()).toBe("dha_renewed1");
    expect(calls).toHaveLength(1);
  });
});

describe("wcall with a session", () => {
  it("attaches the access token, and renews ahead of expiry", async () => {
    const calls = stubFetch((url) =>
      url === "/auth/refresh" ? json(200, renewed(1)) : json(200, { ok: 1 }),
    );
    const { session, web } = await load();
    session.webSetAccess({ access_token: "dha_late", expires_in: 30 });
    await web.wcall("GET", "/v1/me", undefined, true);
    expect(calls.map((c) => c.url)).toEqual(["/auth/refresh", "/v1/me"]);
    expect(auth(calls[1].init)).toBe("Bearer dha_renewed1");
  });

  it("on a 401 renews once and retries once", async () => {
    const calls = stubFetch((url, init) => {
      if (url === "/auth/refresh") return json(200, renewed(1));
      return auth(init) === "Bearer dha_renewed1"
        ? json(200, { ok: 1 })
        : json(401);
    });
    const { session, web } = await load();
    session.webSetAccess({ access_token: "dha_ended", expires_in: 900 });
    expect(await web.wcall("GET", "/v1/me", undefined, true)).toEqual({
      ok: 1,
    });
    expect(calls.map((c) => c.url)).toEqual([
      "/v1/me",
      "/auth/refresh",
      "/v1/me",
    ]);
  });

  it("several calls that all get a 401 cause one renewal", async () => {
    const calls = stubFetch((url, init) => {
      if (url === "/auth/refresh") return json(200, renewed(1));
      return auth(init) === "Bearer dha_renewed1"
        ? json(200, { ok: 1 })
        : json(401);
    });
    const { session, web } = await load();
    session.webSetAccess({ access_token: "dha_ended", expires_in: 900 });
    await Promise.all(
      [1, 2, 3].map(() => web.wcall("GET", "/v1/me", undefined, true)),
    );
    expect(calls.filter((c) => c.url === "/auth/refresh")).toHaveLength(1);
  });

  it("does not loop when the retry is refused too", async () => {
    const calls = stubFetch((url) =>
      url === "/auth/refresh" ? json(200, renewed(1)) : json(401),
    );
    const { session, web } = await load();
    session.webSetAccess({ access_token: "dha_ended", expires_in: 900 });
    await expect(web.wcall("GET", "/v1/me", undefined, true)).rejects.toThrow(
      /401/,
    );
    expect(calls).toHaveLength(3);
  });

  it("sends nothing extra for a call that is not signed in", async () => {
    const calls = stubFetch(() => json(200, ["google"]));
    const { web } = await load();
    await web.wcall("GET", "/auth/providers");
    expect(calls).toHaveLength(1);
    expect(auth(calls[0].init)).toBeUndefined();
  });
});

describe("a session that ends", () => {
  it("startup with no session is a plain false, not an event", async () => {
    stubFetch(() => json(400, "send the renewal token"));
    const { session } = await load();
    const onSignedOut = vi.fn();
    window.addEventListener(session.SIGNED_OUT_EVENT, onSignedOut);
    expect(await session.webRestoreSession()).toBe(false);
    expect(onSignedOut).not.toHaveBeenCalled();
    window.removeEventListener(session.SIGNED_OUT_EVENT, onSignedOut);
  });

  it("a refused renewal after a working session tells the page", async () => {
    stubFetch(() => json(401));
    const { session, web } = await load();
    const onSignedOut = vi.fn();
    window.addEventListener(session.SIGNED_OUT_EVENT, onSignedOut);
    session.webSetAccess({ access_token: "dha_old", expires_in: 30 });
    await expect(web.wcall("GET", "/v1/me", undefined, true)).rejects.toThrow(
      "signed_out",
    );
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(session.isSignedOut(new Error("signed_out"))).toBe(true);
    window.removeEventListener(session.SIGNED_OUT_EVENT, onSignedOut);
  });

  it("a network error is not a sign out", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const { session } = await load();
    await expect(session.webRestoreSession()).rejects.toThrow(TypeError);
  });
});

describe("sign in", () => {
  it("trades the code with the kept verifier, and keeps the token in memory only", async () => {
    const calls = stubFetch((url) =>
      url === "/auth/exchange"
        ? json(200, { ...renewed(7), user: { id: "u1" } })
        : json(200, {}),
    );
    const { session } = await load();
    const { verifier, challenge } = await session.makePkce();
    session.rememberVerifier(verifier);
    await session.webExchange("dhc_code");

    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent).toMatchObject({
      code: "dhc_code",
      code_verifier: verifier,
      platform: "web",
    });
    expect(sent.device_id).toBe(localStorage.getItem("dh.device_id"));
    expect(challenge).not.toBe(verifier);
    // The verifier is gone once used, and the token is usable without a call.
    expect(session.takeVerifier()).toBeNull();
    expect(await session.webAccessToken()).toBe("dha_renewed7");
    expect(calls).toHaveLength(1);
  });

  it("puts no token or code anywhere in browser storage (AC-2)", async () => {
    stubFetch((url) =>
      url === "/auth/exchange" ? json(200, renewed(7)) : json(200, renewed(8)),
    );
    const { session } = await load();
    const { verifier } = await session.makePkce();
    session.rememberVerifier(verifier);
    await session.webExchange("dhc_code");
    await session.webRenew("dha_renewed7");
    const stored = JSON.stringify({ ...localStorage, ...sessionStorage });
    expect(stored).not.toMatch(/dha_|dhr_|dhc_|dhs_/);
  });

  it("refuses to trade a code it did not start", async () => {
    const calls = stubFetch(() => json(200, renewed(1)));
    const { session } = await load();
    await expect(session.webExchange("dhc_code")).rejects.toThrow(
      /not started on this page/,
    );
    expect(calls).toHaveLength(0);
  });

  it("makes a PKCE pair whose challenge is the hash of the verifier", async () => {
    const { session } = await load();
    const { verifier, challenge } = await session.makePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    const expected = btoa(String.fromCharCode(...digest))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(challenge).toBe(expected);
  });

  it("keeps one device id per browser", async () => {
    const { session } = await load();
    const first = session.webDeviceId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(session.webDeviceId()).toBe(first);
  });
});

describe("old saved tokens", () => {
  it("are deleted from dh.web.servers when the page loads (AC-17)", async () => {
    localStorage.setItem(
      "dh.web.servers",
      JSON.stringify({
        a__o1: {
          id: "a__o1",
          url: "",
          token: "dhs_oldtoken",
          name: "Acme",
          org_id: "o1",
        },
      }),
    );
    await load();
    const saved = JSON.parse(localStorage.getItem("dh.web.servers") ?? "{}");
    expect(saved.a__o1).toEqual({
      id: "a__o1",
      url: "",
      name: "Acme",
      org_id: "o1",
    });
    expect(localStorage.getItem("dh.web.servers")).not.toContain("dhs_");
  });
});
