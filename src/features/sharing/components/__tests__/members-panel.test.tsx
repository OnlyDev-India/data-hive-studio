import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OrgMember, OrgRole } from "@/shared/api/server-admin";

const api = vi.hoisted(() => ({
  serversOrgRemoveMember: vi.fn(),
  serversOrgSetMemberRole: vi.fn(),
}));
vi.mock("@/shared/api/client", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/client")>()),
  ...api,
}));
vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));

import { useStudioStore } from "@/shared/store";
import { MembersPanel } from "../members-panel";

const member = (id: string, role: OrgRole): OrgMember => ({
  user_id: id,
  email: `${id}@x.com`,
  name: id.toUpperCase(),
  role,
  joined_ms: 1,
});

/** `me` is the person using the panel, with `role` in org o1. */
function setup(role: OrgRole, members: OrgMember[]) {
  const onChanged = vi.fn();
  const disconnectServer = vi.fn().mockResolvedValue(undefined);
  useStudioStore.setState({
    disconnectServer,
    notifications: [],
    serverSessions: {
      p1: {
        profile: { id: "p1", name: "Acme", url: "https://x.com", org_id: "o1" },
        me: {
          user_id: "me",
          email: "me@x.com",
          name: "Me",
          server_role: "member",
          can_manage_roles: false,
          can_create_org: false,
          orgs: [
            { id: "o1", name: "Acme Inc", slug: "a", created_ms: 1, role },
          ],
        },
        connIds: [],
      },
    } as never,
  });
  render(
    <MembersPanel
      members={members}
      profileId="p1"
      orgId="o1"
      onChanged={onChanged}
    />,
  );
  return { onChanged, disconnectServer };
}

const errors = () =>
  useStudioStore
    .getState()
    .notifications.filter((n) => n.kind === "error")
    .map((n) => n.detail);

beforeEach(() => {
  api.serversOrgRemoveMember.mockReset().mockResolvedValue(undefined);
  api.serversOrgSetMemberRole.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("MembersPanel role choices", () => {
  it("lets an owner set any role on another member", async () => {
    setup("owner", [member("me", "owner"), member("bob", "member")]);
    await userEvent.click(screen.getByLabelText("Role of bob@x.com"));
    for (const r of ["member", "admin", "owner"]) {
      expect(await screen.findByRole("option", { name: r })).toBeVisible();
    }
  });

  it("limits an admin to member and admin", async () => {
    setup("admin", [
      member("me", "admin"),
      member("bob", "member"),
      member("boss", "owner"),
      member("zed", "owner"),
    ]);
    await userEvent.click(screen.getByLabelText("Role of bob@x.com"));
    expect(await screen.findByRole("option", { name: "admin" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "owner" })).toBeNull();
  });

  it("shows an owner row to an admin as a fixed badge, not a select", () => {
    setup("admin", [
      member("me", "admin"),
      member("boss", "owner"),
      member("zed", "owner"),
    ]);
    expect(screen.queryByLabelText("Role of boss@x.com")).toBeNull();
    expect(screen.getAllByText("owner")).toHaveLength(2);
  });

  it("gives a plain member no controls except leaving", () => {
    setup("member", [member("me", "member"), member("bob", "member")]);
    expect(screen.queryByLabelText(/^Role of/)).toBeNull();
    expect(screen.queryByLabelText("Remove bob@x.com")).toBeNull();
    expect(screen.getByLabelText("Leave organization")).toBeVisible();
  });

  it("changes a role through the server and reloads", async () => {
    const { onChanged } = setup("owner", [
      member("me", "owner"),
      member("bob", "member"),
    ]);
    await userEvent.click(screen.getByLabelText("Role of bob@x.com"));
    await userEvent.click(await screen.findByRole("option", { name: "admin" }));
    await waitFor(() =>
      expect(api.serversOrgSetMemberRole).toHaveBeenCalledWith(
        "p1",
        "o1",
        "bob",
        "admin",
      ),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("explains a refusal in plain words and reloads what the server has", async () => {
    api.serversOrgSetMemberRole.mockRejectedValue(new Error("409 last_owner"));
    const { onChanged } = setup("owner", [
      member("me", "owner"),
      member("bob", "owner"),
    ]);
    await userEvent.click(screen.getByLabelText("Role of bob@x.com"));
    await userEvent.click(
      await screen.findByRole("option", { name: "member" }),
    );
    await waitFor(() => expect(errors().join()).toMatch(/at least one owner/));
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("MembersPanel last owner guard", () => {
  it("locks the only owner: no role select and no remove or leave", () => {
    setup("owner", [member("me", "owner"), member("bob", "member")]);
    expect(screen.queryByLabelText("Role of me@x.com")).toBeNull();
    expect(screen.queryByLabelText("Leave organization")).toBeNull();
    expect(screen.getByTitle(/last owner can't be demoted/)).toBeVisible();
  });

  it("unlocks the owners once there are two", () => {
    setup("owner", [member("me", "owner"), member("bob", "owner")]);
    expect(screen.getByLabelText("Role of me@x.com")).toBeVisible();
    expect(screen.getByLabelText("Leave organization")).toBeVisible();
    expect(screen.getByLabelText("Remove bob@x.com")).toBeVisible();
  });
});

describe("MembersPanel remove and leave", () => {
  it("removes someone only after a second click", async () => {
    const { onChanged } = setup("admin", [
      member("me", "admin"),
      member("bob", "member"),
    ]);
    const remove = screen.getByLabelText("Remove bob@x.com");
    await userEvent.click(remove);
    expect(api.serversOrgRemoveMember).not.toHaveBeenCalled();
    await userEvent.click(remove);
    await waitFor(() =>
      expect(api.serversOrgRemoveMember).toHaveBeenCalledWith(
        "p1",
        "o1",
        "bob",
      ),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("never offers an admin a way to remove an owner", () => {
    setup("admin", [
      member("me", "admin"),
      member("boss", "owner"),
      member("zed", "owner"),
    ]);
    expect(screen.queryByLabelText("Remove boss@x.com")).toBeNull();
  });

  it("leaving removes yourself and drops the org's connection", async () => {
    const { disconnectServer, onChanged } = setup("member", [
      member("me", "member"),
      member("bob", "owner"),
    ]);
    const leave = screen.getByLabelText("Leave organization");
    await userEvent.click(leave);
    await userEvent.click(leave);
    await waitFor(() =>
      expect(api.serversOrgRemoveMember).toHaveBeenCalledWith("p1", "o1", "me"),
    );
    await waitFor(() => expect(disconnectServer).toHaveBeenCalledWith("p1"));
    expect(onChanged).not.toHaveBeenCalled();
  });
});
