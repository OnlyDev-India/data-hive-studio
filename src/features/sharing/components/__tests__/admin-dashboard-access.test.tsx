import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MeResult } from "@/shared/api/server-admin";

const api = vi.hoisted(() => ({
  serversOrgMembers: vi.fn(),
  serversOrgInvitesList: vi.fn(),
  serversOrgLinksList: vi.fn(),
  serversOrgAudit: vi.fn(),
  serverInvitesList: vi.fn(),
  serverAccountsList: vi.fn(),
  serverOrgsList: vi.fn(),
  serverSettingsGet: vi.fn(),
}));
vi.mock("@/shared/api/client", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/client")>()),
  serversOrgMembers: api.serversOrgMembers,
  serversOrgInvitesList: api.serversOrgInvitesList,
  serversOrgLinksList: api.serversOrgLinksList,
  serversOrgAudit: api.serversOrgAudit,
}));
vi.mock("@/shared/api/server-access", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/server-access")>()),
  serverInvitesList: api.serverInvitesList,
  serverAccountsList: api.serverAccountsList,
  serverOrgsList: api.serverOrgsList,
  serverSettingsGet: api.serverSettingsGet,
}));
// Store changes schedule a debounced workspace save; keep it off Tauri IPC.
vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));

import { useStudioStore } from "@/shared/store";
import { AdminDashboard } from "../admin-dashboard";

const me = (
  server_role: MeResult["server_role"],
  can_manage_roles = false,
): MeResult => ({
  user_id: "me",
  email: "me@x.com",
  name: "Me",
  server_role,
  can_manage_roles,
  can_create_org: false,
  orgs: [{ id: "o1", name: "Acme", role: "admin" }],
});

function setup(server_role: MeResult["server_role"], can_manage_roles = false) {
  useStudioStore.setState({
    serverSessions: {
      p1: {
        profile: { id: "p1", name: "Acme", url: "https://x.com", org_id: "o1" },
        me: me(server_role, can_manage_roles),
        connIds: [],
      },
    } as never,
  });
  render(<AdminDashboard profileId="p1" orgId="o1" />);
}

beforeEach(() => {
  api.serversOrgMembers.mockReset().mockResolvedValue([]);
  api.serversOrgInvitesList.mockReset().mockResolvedValue([]);
  api.serversOrgLinksList.mockReset().mockResolvedValue([]);
  api.serversOrgAudit.mockReset().mockResolvedValue([]);
  api.serverInvitesList.mockReset().mockResolvedValue([]);
  api.serverAccountsList.mockReset().mockResolvedValue([]);
  api.serverOrgsList.mockReset().mockResolvedValue([]);
  api.serverSettingsGet
    .mockReset()
    .mockResolvedValue({ open_org_creation: false });
});
afterEach(cleanup);

describe("AdminDashboard server sections", () => {
  it("has no separate Server access tab", () => {
    setup("owner");
    expect(screen.queryByRole("tab", { name: "Server access" })).toBeNull();
  });

  it("adds server invites under Invites for a server admin", async () => {
    setup("admin");
    await userEvent.click(screen.getByRole("tab", { name: "Invites" }));
    expect(
      await screen.findByRole("heading", { name: "Server invites" }),
    ).toBeVisible();
    expect(api.serverInvitesList).toHaveBeenCalledWith("p1");
  });

  it("adds server accounts under Members for an owner", async () => {
    setup("owner");
    expect(
      await screen.findByRole("heading", { name: "Server accounts" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(api.serverAccountsList).toHaveBeenCalledWith("p1"),
    );
  });

  it("tells an admin without the switch why accounts are hidden", async () => {
    setup("admin");
    expect(await screen.findByText(/Managing people is off/)).toBeVisible();
    expect(api.serverAccountsList).not.toHaveBeenCalled();
  });

  it("shows an admin with the switch on the accounts list", async () => {
    setup("admin", true);
    await waitFor(() =>
      expect(api.serverAccountsList).toHaveBeenCalledWith("p1"),
    );
    expect(screen.queryByText(/Managing people is off/)).toBeNull();
  });

  it("shows a plain member no server sections", async () => {
    setup("member");
    await userEvent.click(screen.getByRole("tab", { name: "Invites" }));
    expect(
      screen.queryByRole("heading", { name: "Server invites" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Server accounts" }),
    ).toBeNull();
    expect(api.serverInvitesList).not.toHaveBeenCalled();
    expect(api.serverAccountsList).not.toHaveBeenCalled();
  });
});

describe("AdminDashboard after losing access", () => {
  it("says so plainly instead of a failed load, when the server refuses with 403", async () => {
    api.serversOrgMembers.mockRejectedValue(
      new Error("403 not a member of this organization"),
    );
    setup("member");
    expect(
      await screen.findByText(/You no longer have access to this organization/),
    ).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Members" })).toBeNull();
  });

  it("still reports other load failures as errors", async () => {
    api.serversOrgMembers.mockRejectedValue(new Error("500 database is down"));
    setup("member");
    await waitFor(() =>
      expect(
        useStudioStore
          .getState()
          .notifications.some((n) => n.title === "Failed to load admin data"),
      ).toBe(true),
    );
    expect(screen.queryByText(/no longer have access/)).toBeNull();
  });
});
