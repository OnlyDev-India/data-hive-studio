import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ServerProfileView } from "@/shared/api/client";

const flags = vi.hoisted(() => ({ web: false }));
const api = vi.hoisted(() => ({
  serversList: vi.fn(),
  serversSignOut: vi.fn(),
  serversMyInvites: vi.fn(),
  serversInviteAccept: vi.fn(),
  serversInviteDecline: vi.fn(),
  serversSaveProfile: vi.fn(),
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
  serversMyInvites: api.serversMyInvites,
  serversInviteAccept: api.serversInviteAccept,
  serversInviteDecline: api.serversInviteDecline,
  serversSaveProfile: api.serversSaveProfile,
}));
vi.mock("@/shared/api/server-sessions", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/server-sessions")>()),
  serversSignOut: api.serversSignOut,
}));

import { useStudioStore } from "@/shared/store";
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
  api.serversMyInvites.mockReset().mockResolvedValue([]);
  api.serversInviteAccept.mockReset();
  api.serversInviteDecline.mockReset().mockResolvedValue(undefined);
  api.serversSaveProfile.mockReset();
  useStudioStore.setState({ serverSessions: {} });
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

const pending = {
  id: "i1",
  org_id: "o9",
  org_name: "Globex",
  role: "member" as const,
  inviter_name: "Dana",
  inviter_email: "dana@x.com",
  expires_ms: null,
};

describe("ServerMenu invitations", () => {
  it("shows the pending count next to Invitations", async () => {
    api.serversMyInvites.mockResolvedValue([pending, { ...pending, id: "i2" }]);
    await openMenu();
    expect(await screen.findByLabelText("2 pending")).toBeVisible();
    expect(screen.getByText("Invitations")).toBeVisible();
    expect(api.serversMyInvites).toHaveBeenCalledWith("p1");
  });

  it("shows Invitations with no count when nothing is waiting", async () => {
    await openMenu();
    expect(await screen.findByText("Invitations")).toBeVisible();
    expect(screen.queryByLabelText(/pending/)).toBeNull();
  });

  it("offers no Invitations entry when no server is signed in", async () => {
    api.serversList.mockResolvedValue([profile({ signed_in: false })]);
    await openMenu();
    await screen.findByText("Acme");
    expect(screen.queryByText("Invitations")).toBeNull();
  });

  it("accepts an invitation and offers to open the organization", async () => {
    api.serversMyInvites.mockResolvedValue([pending]);
    const globex = { id: "o9", name: "Globex", slug: "globex", created_ms: 2 };
    api.serversInviteAccept.mockResolvedValue(globex);
    api.serversSaveProfile.mockResolvedValue({
      id: "p9",
      name: "Globex",
      url: "https://db.acme.com",
      org_id: "o9",
    });
    const connectServer = vi.fn().mockResolvedValue(undefined);
    useStudioStore.setState({ connectServer } as never);
    await openMenu();
    await userEvent.click(await screen.findByText("Invitations"));
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Accept invitation to Globex",
      }),
    );
    expect(api.serversInviteAccept).toHaveBeenCalledWith("p1", "i1");
    await userEvent.click(
      await screen.findByRole("button", { name: "Open Globex" }),
    );
    expect(api.serversSaveProfile).toHaveBeenCalledWith(
      "Globex",
      "https://db.acme.com",
      "o9",
    );
    expect(connectServer).toHaveBeenCalledWith("p9");
  });

  it("declines an invitation without joining", async () => {
    api.serversMyInvites.mockResolvedValue([pending]);
    await openMenu();
    await userEvent.click(await screen.findByText("Invitations"));
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Decline invitation to Globex",
      }),
    );
    expect(api.serversInviteDecline).toHaveBeenCalledWith("p1", "i1");
    expect(api.serversInviteAccept).not.toHaveBeenCalled();
  });
});

describe("ServerMenu New organization", () => {
  const session = (can_create_org: boolean) =>
    ({
      p1: {
        profile: {
          id: "p1",
          name: "Acme",
          url: "https://db.acme.com",
          org_id: "o1",
        },
        me: {
          user_id: "me",
          email: "me@x.com",
          name: "Me",
          server_role: "member",
          can_manage_roles: false,
          can_create_org,
          orgs: [],
        },
        connIds: [],
      },
    }) as never;

  it("is offered only when the server says this person may create one", async () => {
    useStudioStore.setState({ serverSessions: session(false) });
    await openMenu();
    await screen.findByText("Invitations");
    expect(screen.queryByText(/New organization/)).toBeNull();
    cleanup();
    useStudioStore.setState({ serverSessions: session(true) });
    await openMenu();
    expect(await screen.findByText(/New organization/)).toBeVisible();
  });
});

describe("ServerMenu when the org refuses the person", () => {
  it("marks the profile as no longer having access after a 403 on connect", async () => {
    const connectServer = vi
      .fn()
      .mockRejectedValue(new Error("403 not a member of this organization"));
    useStudioStore.setState({ connectServer } as never);
    await openMenu();
    await userEvent.click(await screen.findByText("Acme"));
    // Choosing an item closes the menu; open it again to see the row.
    await userEvent.click(screen.getByRole("button", { name: "Team servers" }));
    expect(await screen.findByText("no longer has access")).toBeVisible();
    const notes = useStudioStore.getState().notifications;
    expect(notes.at(-1)?.detail).toMatch(/no longer have access to "Acme"/);
  });

  it("clears the mark once a later connect works", async () => {
    const connectServer = vi
      .fn()
      .mockRejectedValueOnce(new Error("403 forbidden"))
      .mockResolvedValueOnce(undefined);
    useStudioStore.setState({ connectServer } as never);
    await openMenu();
    await userEvent.click(await screen.findByText("Acme"));
    await userEvent.click(screen.getByRole("button", { name: "Team servers" }));
    await userEvent.click(await screen.findByText("no longer has access"));
    await userEvent.click(screen.getByRole("button", { name: "Team servers" }));
    await screen.findByText("connect");
    expect(screen.queryByText("no longer has access")).toBeNull();
  });
});
