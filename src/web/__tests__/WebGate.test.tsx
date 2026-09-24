import { Suspense, lazy } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ webExchange: vi.fn() }));
vi.mock("@/shared/api/web-session", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/web-session")>()),
  webExchange: api.webExchange,
}));
const wcall = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/web", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/web")>()),
  wcall,
}));
vi.mock("@/shared/store", () => ({
  useStudioStore: Object.assign(() => undefined, {
    getState: () => ({ connectServer: vi.fn(), serverSessions: {} }),
    subscribe: () => () => {},
  }),
}));

import { WebGate } from "../WebGate";

/** Mounted the way `App.tsx` mounts it: the gate sits inside a Suspense
 *  boundary and its child is a `lazy()` chunk that is not loaded yet, so the
 *  first render suspends and React throws that render's state away. */
function mountLikeApp() {
  const Studio = lazy(
    () =>
      new Promise<{ default: () => React.JSX.Element }>((resolve) =>
        setTimeout(() => resolve({ default: () => <div>studio</div> }), 20),
      ),
  );
  render(
    <Suspense fallback={<div>splash</div>}>
      <WebGate>
        <Studio />
      </WebGate>
    </Suspense>,
  );
}

beforeEach(() => {
  api.webExchange.mockReset().mockResolvedValue(undefined);
  wcall
    .mockReset()
    .mockImplementation(async (_method: string, path: string) =>
      path === "/auth/providers" ? ["github"] : { orgs: [] },
    );
  localStorage.clear();
  sessionStorage.clear();
  // Like a server nobody is signed in to: no renewal cookie (400), one provider.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string) =>
      path === "/auth/refresh"
        ? { ok: false, status: 400, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ["github"] },
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("WebGate sign in return", () => {
  it("shows the claim step for ?ticket= even though the first render suspends", async () => {
    window.history.replaceState({}, "", "/?ticket=abc123");
    mountLikeApp();
    expect(
      await screen.findByText("This server has no owner yet"),
    ).toBeVisible();
  });

  it("shows why a sign in was refused instead of a bare sign in form", async () => {
    window.history.replaceState({}, "", "/?error=not_invited&email=me%40x.com");
    mountLikeApp();
    expect(await screen.findByText(/hasn't been invited/)).toBeInTheDocument();
  });

  it("trades a ?code= for a session exactly once", async () => {
    window.history.replaceState({}, "", "/?code=one-time-code");
    mountLikeApp();
    await waitFor(() =>
      expect(api.webExchange).toHaveBeenCalledWith("one-time-code"),
    );
    expect(api.webExchange).toHaveBeenCalledTimes(1);
  });

  it("removes the sign in parameters from the address bar once the page is up", async () => {
    window.history.replaceState({}, "", "/?ticket=abc123&keep=1");
    mountLikeApp();
    await screen.findByText("This server has no owner yet");
    expect(window.location.search).toBe("?keep=1");
  });
});

const CODE = "0123456789abcdef01234567";
const GLOBEX = { id: "o9", name: "Globex", slug: "globex", created_ms: 1 };

describe("WebGate invite link (?join=)", () => {
  it("keeps the code for this tab only and removes it from the address bar", async () => {
    window.history.replaceState({}, "", `/?join=${CODE}&keep=1`);
    mountLikeApp();
    await screen.findByText(/You opened an invite link/);
    expect(window.location.search).toBe("?keep=1");
    expect(sessionStorage.getItem("dh.web.join")).toBe(CODE);
    expect(localStorage.length).toBe(0);
  });

  it("ignores a join value that is not shaped like a code", async () => {
    window.history.replaceState({}, "", "/?join=nope");
    mountLikeApp();
    await screen.findByText(/dh-studio — sign in/);
    expect(sessionStorage.length).toBe(0);
    expect(screen.queryByText(/You opened an invite link/)).toBeNull();
  });

  it("redeems the link after sign in and opens that org", async () => {
    window.history.replaceState({}, "", `/?join=${CODE}`);
    mountLikeApp();
    await screen.findByText(/You opened an invite link/);
    // The sign in round trip comes back to a fresh page load with ?code=.
    cleanup();
    wcall.mockImplementation(async (_m: string, path: string) => {
      if (path.startsWith("/v1/links/")) return GLOBEX;
      if (path === "/v1/me/invites") return [];
      return path === "/auth/providers" ? ["github"] : { orgs: [] };
    });
    window.history.replaceState({}, "", "/?code=one-time-code");
    mountLikeApp();
    await screen.findByText("studio");
    await waitFor(() =>
      expect(wcall).toHaveBeenCalledWith(
        "POST",
        `/v1/links/${CODE}/redeem`,
        undefined,
        true,
      ),
    );
    await waitFor(() =>
      expect(screen.queryByText(/dh-studio — sign in/)).toBeNull(),
    );
    expect(sessionStorage.getItem("dh.web.join")).toBeNull();
    const stored = Object.values(
      JSON.parse(localStorage.getItem("dh.web.servers") ?? "{}"),
    ) as { org_id: string }[];
    expect(stored.map((c) => c.org_id)).toEqual(["o9"]);
  });

  it("says plainly when the link no longer works and falls back to the org picker", async () => {
    sessionStorage.setItem("dh.web.join", CODE);
    wcall.mockImplementation(async (_m: string, path: string) => {
      if (path.startsWith("/v1/links/")) throw new Error("404 not found");
      if (path === "/v1/me/invites") return [];
      return path === "/auth/providers" ? ["github"] : { orgs: [] };
    });
    window.history.replaceState({}, "", "/?code=one-time-code");
    mountLikeApp();
    expect(await screen.findByText(/invite link didn't work/)).toBeVisible();
    expect(screen.getByText(/aren't in an organization yet/)).toBeVisible();
    expect(sessionStorage.getItem("dh.web.join")).toBeNull();
  });
});
