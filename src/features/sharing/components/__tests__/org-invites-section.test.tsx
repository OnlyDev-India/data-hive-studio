import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OrgEmailInvite } from "@/shared/api/server-invites";

const api = vi.hoisted(() => ({
  serversOrgInviteCreate: vi.fn(),
  serversOrgInviteRevoke: vi.fn(),
}));
const mail = vi.hoisted(() => ({ openMailto: vi.fn() }));
vi.mock("@/shared/api/client", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/client")>()),
  ...api,
}));
vi.mock("../../invite-message", async (orig) => ({
  ...(await orig<typeof import("../../invite-message")>()),
  ...mail,
}));
vi.mock("@/shared/api/web", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/web")>()),
  WEB: false,
}));
vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));

import { useStudioStore } from "@/shared/store";
import { OrgInvitesSection } from "../org-invites-section";

const invite = (over: Partial<OrgEmailInvite> = {}): OrgEmailInvite => ({
  id: "i1",
  org_id: "o1",
  email: "bob@x.com",
  role: "member",
  created_by: "me@x.com",
  created_ms: 1,
  expires_ms: null,
  used_ms: null,
  used_by: null,
  status: "open",
  ...over,
});

function setup(role: "owner" | "admin", invites: OrgEmailInvite[] = []) {
  const onChanged = vi.fn();
  useStudioStore.setState({
    serverSessions: {
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
          name: "Dana",
          server_role: "member",
          can_manage_roles: false,
          can_create_org: false,
          orgs: [
            { id: "o1", name: "Acme Inc", slug: "acme", created_ms: 1, role },
          ],
        },
        connIds: [],
      },
    } as never,
  });
  render(
    <OrgInvitesSection
      invites={invites}
      profileId="p1"
      orgId="o1"
      onChanged={onChanged}
    />,
  );
  return onChanged;
}

beforeEach(() => {
  useStudioStore.setState({ notifications: [] });
  api.serversOrgInviteCreate.mockReset().mockResolvedValue(invite());
  api.serversOrgInviteRevoke.mockReset().mockResolvedValue(undefined);
  mail.openMailto.mockReset().mockResolvedValue(undefined);
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
afterEach(cleanup);

describe("OrgInvitesSection", () => {
  it("invites an email with the chosen role and the default 7 day expiry", async () => {
    const onChanged = setup("owner");
    await userEvent.type(
      screen.getByLabelText("Email to invite"),
      " bob@x.com ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() =>
      expect(api.serversOrgInviteCreate).toHaveBeenCalledWith(
        "p1",
        "o1",
        "bob@x.com",
        "member",
        7,
      ),
    );
    expect(onChanged).toHaveBeenCalled();
    expect(screen.getByLabelText("Email to invite")).toHaveValue("");
  });

  it("limits an admin's role choices to member and admin", async () => {
    setup("admin");
    await userEvent.click(screen.getByLabelText("Role"));
    expect(await screen.findByRole("option", { name: "admin" })).toBeVisible();
    expect(screen.getByRole("option", { name: "member" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "owner" })).toBeNull();
  });

  it("offers owner to an org owner", async () => {
    setup("owner");
    await userEvent.click(screen.getByLabelText("Role"));
    expect(await screen.findByRole("option", { name: "owner" })).toBeVisible();
  });

  it("shows a plain message when the email is already in the org", async () => {
    api.serversOrgInviteCreate.mockRejectedValue(
      new Error("409 already_member"),
    );
    setup("owner");
    await userEvent.type(screen.getByLabelText("Email to invite"), "bob@x.com");
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() =>
      expect(
        useStudioStore
          .getState()
          .notifications.filter((n) => n.kind === "error")
          .at(-1)?.detail,
      ).toMatch(/already in this organization/),
    );
  });

  it("Copy message puts the ready made message on the clipboard", async () => {
    setup("owner", [invite({ role: "admin" })]);
    await userEvent.click(
      screen.getByRole("button", { name: "Copy message for bob@x.com" }),
    );
    const text = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
    expect(text).toContain("Dana invited you to Acme Inc on DH Studio");
    expect(text).toContain("as an admin");
    expect(text).toContain("https://db.acme.com");
    expect(text).toContain("bob@x.com");
  });

  it("Email opens the same message in the mail app", async () => {
    setup("owner", [invite()]);
    await userEvent.click(
      screen.getByRole("button", { name: "Email bob@x.com" }),
    );
    expect(mail.openMailto).toHaveBeenCalledTimes(1);
    const url = new URL(mail.openMailto.mock.calls[0][0] as string);
    expect(decodeURIComponent(url.pathname)).toBe("bob@x.com");
    expect(url.searchParams.get("subject")).toBe(
      "Dana invited you to Acme Inc on DH Studio",
    );
  });

  it("revokes only after a second click, and a used invite has no actions", async () => {
    const onChanged = setup("owner", [
      invite(),
      invite({
        id: "i2",
        email: "used@x.com",
        status: "used",
        used_by: "used@x.com",
      }),
    ]);
    expect(
      screen.queryByRole("button", {
        name: "Revoke invitation for used@x.com",
      }),
    ).toBeNull();
    const revoke = screen.getByRole("button", {
      name: "Revoke invitation for bob@x.com",
    });
    await userEvent.click(revoke);
    expect(api.serversOrgInviteRevoke).not.toHaveBeenCalled();
    await userEvent.click(revoke);
    await waitFor(() =>
      expect(api.serversOrgInviteRevoke).toHaveBeenCalledWith("p1", "o1", "i1"),
    );
    expect(onChanged).toHaveBeenCalled();
  });
});
