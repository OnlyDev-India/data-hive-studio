import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ServerProfileView } from "@/shared/api/client";

const flags = vi.hoisted(() => ({ web: false }));
const api = vi.hoisted(() => ({
  serversList: vi.fn(),
  serversSignOut: vi.fn(),
}));
vi.mock("@/shared/api/web", async (orig) => {
  const real = await orig<typeof import("@/shared/api/web")>();
  return {
    ...real,
    get WEB() {
      return flags.web;
    },
  };
});
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@/shared/api/client", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/client")>()),
  serversList: api.serversList,
}));
vi.mock("@/shared/api/server-sessions", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/server-sessions")>()),
  serversSignOut: api.serversSignOut,
}));

import { TooltipProvider } from "@/shared/components/ui/tooltip";
import { ServerMenu } from "../server-menu";

const profile = (over: Partial<ServerProfileView>): ServerProfileView => ({
  id: "p1",
  name: "Acme",
  url: "https://db.acme.com",
  org_id: "o1",
  connected: true,
  signed_in: true,
  ...over,
});

async function openMenu() {
  render(
    <TooltipProvider>
      <ServerMenu />
    </TooltipProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Team servers" }));
}

beforeEach(() => {
  flags.web = false;
  api.serversList.mockReset().mockResolvedValue([profile({})]);
  api.serversSignOut.mockReset().mockResolvedValue(true);
});
afterEach(cleanup);

describe("ServerMenu on desktop", () => {
  it("lists saved servers, Sign out and Add server", async () => {
    await openMenu();
    expect(await screen.findByText("Acme")).toBeVisible();
    expect(screen.getByText(/Sign out · db\.acme\.com/)).toBeVisible();
    expect(screen.getByText(/Add server/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove Acme" })).toBeVisible();
    // Everything else about a server is managed in the admin panel.
    expect(screen.queryByText(/Server access/)).toBeNull();
    expect(screen.queryByText(/My devices/)).toBeNull();
  });
});

describe("ServerMenu on web", () => {
  beforeEach(() => {
    flags.web = true;
  });

  it("shows the server it connected to and Sign out, with no Add server", async () => {
    await openMenu();
    expect(await screen.findByText("db.acme.com")).toBeVisible();
    expect(screen.getByText("connected")).toBeVisible();
    expect(screen.getByText(/Sign out · db\.acme\.com/)).toBeVisible();
    expect(screen.queryByText(/Add server/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Acme" })).toBeNull();
  });

  it("shows one row when several orgs share the server", async () => {
    api.serversList.mockResolvedValue([
      profile({ id: "p1", name: "Acme" }),
      profile({ id: "p2", name: "Beta" }),
    ]);
    await openMenu();
    expect(await screen.findByText("db.acme.com")).toBeVisible();
    expect(screen.getAllByText("connected")).toHaveLength(1);
  });

  it("signs the page out through the server", async () => {
    await openMenu();
    await userEvent.click(await screen.findByText(/Sign out · db\.acme\.com/));
    expect(api.serversSignOut).toHaveBeenCalledWith("p1");
  });
});
