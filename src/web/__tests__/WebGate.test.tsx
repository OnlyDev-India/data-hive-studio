import { Suspense, lazy } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ webExchange: vi.fn() }));
vi.mock("@/shared/api/web-session", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/web-session")>()),
  webExchange: api.webExchange,
}));
vi.mock("@/shared/api/web", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/web")>()),
  wcall: vi.fn(async (_method: string, path: string) =>
    path === "/auth/providers" ? ["github"] : { orgs: [] },
  ),
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
  localStorage.clear();
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
