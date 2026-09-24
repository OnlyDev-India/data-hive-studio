import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MeResult } from "@/shared/api/server-admin";

const api = vi.hoisted(() => ({
  serversList: vi.fn(),
  serversOAuthProviders: vi.fn(),
  serversOAuthLogin: vi.fn(),
}));
vi.mock("@/shared/api/server-admin", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/server-admin")>()),
  ...api,
}));
const inv = vi.hoisted(() => ({
  serversOrgRedeemLinkNew: vi.fn(),
  serversMyInvitesNew: vi.fn(),
  serversInviteAcceptNew: vi.fn(),
  serversInviteDeclineNew: vi.fn(),
}));
vi.mock("@/shared/api/server-invites", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/server-invites")>()),
  ...inv,
}));
// Desktop-only flows (this file): a saved-servers list and an OAuth round
// trip that never touches the network or Tauri IPC directly.
vi.mock("@/shared/api/web", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/web")>()),
  WEB: false,
}));

import { ConnectServerForm, OrgPickerStep } from "../connect-server-dialog";

const me = (over: Partial<MeResult> = {}): MeResult => ({
  user_id: "u1",
  email: "boss@x.com",
  name: "Boss",
  server_role: "member",
  can_manage_roles: false,
  can_create_org: false,
  orgs: [],
  ...over,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.serversList.mockResolvedValue([]);
  Object.values(inv).forEach((f) => f.mockReset());
  inv.serversMyInvitesNew.mockResolvedValue([]);
});
afterEach(cleanup);

/** Renders the form, enters a server URL, and waits for the Google sign in
 *  button so `signIn` has something to click (desktop only shows it once
 *  `serversOAuthProviders` has resolved). */
async function readyToSignIn(providers: string[] = ["google"]) {
  api.serversOAuthProviders.mockResolvedValue(providers);
  render(<ConnectServerForm on_connect={vi.fn()} show_server_fields />);
  await userEvent.type(
    screen.getByLabelText("Server URL"),
    "https://dh.example.com",
  );
  return screen.findByRole(
    "button",
    { name: "Continue with Google" },
    { timeout: 2000 },
  );
}

describe("ConnectServerForm sign in outcomes", () => {
  it("moves to the claim step when the server has no owner yet", async () => {
    const button = await readyToSignIn();
    api.serversOAuthLogin.mockResolvedValue({
      kind: "claim",
      ticket: "tix-1",
    });
    await userEvent.click(button);
    expect(
      await screen.findByText("This server has no owner yet"),
    ).toBeVisible();
  });

  it("shows the refusal message and stays on the sign in step so the person can retry", async () => {
    const button = await readyToSignIn();
    api.serversOAuthLogin.mockResolvedValue({
      kind: "refused",
      error: "not_invited",
      email: "a@x.com",
    });
    await userEvent.click(button);
    expect(
      await screen.findByText(/a@x\.com.*hasn't been invited/),
    ).toBeVisible();
    // Refused, not claim: the claim step must not appear.
    expect(
      screen.queryByText("This server has no owner yet"),
    ).not.toBeInTheDocument();
    // Still able to retry.
    expect(
      screen.getByRole("button", { name: "Continue with Google" }),
    ).toBeEnabled();
  });

  it("moves to the org picker when the sign in lands in an existing account", async () => {
    const button = await readyToSignIn();
    api.serversOAuthLogin.mockResolvedValue({
      kind: "signed_in",
      me: me({ orgs: [] }),
    });
    await userEvent.click(button);
    expect(await screen.findByText("Signed in as boss@x.com")).toBeVisible();
  });

  it("shows a plain error message when the OAuth round trip itself fails", async () => {
    const button = await readyToSignIn();
    api.serversOAuthLogin.mockRejectedValue(new Error("network unreachable"));
    await userEvent.click(button);
    expect(await screen.findByText(/network unreachable/)).toBeVisible();
  });
});

describe("OrgPickerStep", () => {
  const acme = { id: "o1", name: "Acme", slug: "acme", created_ms: 1 };
  const picker = (over: Partial<MeResult> = {}) =>
    render(
      <OrgPickerStep
        me={me(over)}
        url="https://dh.example.com"
        busy={false}
        onSelect={vi.fn()}
      />,
    );

  it("offers New organization only when the person may create one", async () => {
    picker({ can_create_org: false, orgs: [{ ...acme, role: "member" }] });
    expect(screen.getByRole("button", { name: /Acme/ })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "New organization" }),
    ).not.toBeInTheDocument();
    cleanup();
    picker({ can_create_org: true, orgs: [{ ...acme, role: "member" }] });
    expect(
      screen.getByRole("button", { name: "New organization" }),
    ).toBeVisible();
  });

  it("lands on the create form for someone with no org who may create one", () => {
    picker({ can_create_org: true, orgs: [] });
    expect(screen.getByLabelText("Organization name")).toBeVisible();
  });

  it("explains how to join when there is no org and creating is not allowed", () => {
    picker({ can_create_org: false, orgs: [] });
    expect(screen.getByText(/invite you by email/)).toBeVisible();
    expect(
      screen.queryByLabelText("Organization name"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Have an invite code/ }),
    ).toBeVisible();
  });

  describe("pending invitations", () => {
    const pending = {
      id: "i1",
      org_id: "o9",
      org_name: "Globex",
      role: "admin" as const,
      inviter_name: "Dana",
      inviter_email: "dana@x.com",
      expires_ms: null,
    };
    const pickerWith = (over: Partial<MeResult>, onSelect = vi.fn()) => {
      render(
        <OrgPickerStep
          me={me(over)}
          url="https://dh.example.com"
          busy={false}
          onSelect={onSelect}
        />,
      );
      return onSelect;
    };

    it("lists invitations with who sent them and the role", async () => {
      inv.serversMyInvitesNew.mockResolvedValue([pending]);
      pickerWith({ orgs: [{ ...acme, role: "member" }] });
      expect(await screen.findByText("Globex")).toBeVisible();
      expect(screen.getByText(/admin · from Dana/)).toBeVisible();
      expect(inv.serversMyInvitesNew).toHaveBeenCalledWith(
        "https://dh.example.com",
      );
    });

    it("accepting joins that org and hands it to onSelect", async () => {
      inv.serversMyInvitesNew.mockResolvedValue([pending]);
      const globex = {
        id: "o9",
        name: "Globex",
        slug: "globex",
        created_ms: 2,
      };
      inv.serversInviteAcceptNew.mockResolvedValue(globex);
      const onSelect = pickerWith({ orgs: [] });
      await userEvent.click(
        await screen.findByRole("button", {
          name: "Accept invitation to Globex",
        }),
      );
      await waitFor(() => expect(onSelect).toHaveBeenCalledWith(globex));
      expect(inv.serversInviteAcceptNew).toHaveBeenCalledWith(
        "https://dh.example.com",
        "i1",
      );
    });

    it("declining removes the invitation and never selects an org", async () => {
      inv.serversMyInvitesNew.mockResolvedValue([pending]);
      inv.serversInviteDeclineNew.mockResolvedValue(undefined);
      const onSelect = pickerWith({ orgs: [{ ...acme, role: "member" }] });
      await userEvent.click(
        await screen.findByRole("button", {
          name: "Decline invitation to Globex",
        }),
      );
      await waitFor(() =>
        expect(screen.queryByText("Globex")).not.toBeInTheDocument(),
      );
      expect(inv.serversInviteDeclineNew).toHaveBeenCalledWith(
        "https://dh.example.com",
        "i1",
      );
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("shows an invitation instead of the create form for someone with no org", async () => {
      inv.serversMyInvitesNew.mockResolvedValue([pending]);
      pickerWith({ can_create_org: true, orgs: [] });
      expect(await screen.findByText("Globex")).toBeVisible();
      expect(
        screen.queryByLabelText("Organization name"),
      ).not.toBeInTheDocument();
    });

    it("says why an expired invitation could not be accepted", async () => {
      inv.serversMyInvitesNew.mockResolvedValue([pending]);
      inv.serversInviteAcceptNew.mockRejectedValue(
        new Error("409 invite_expired"),
      );
      pickerWith({ orgs: [] });
      await userEvent.click(
        await screen.findByRole("button", {
          name: "Accept invitation to Globex",
        }),
      );
      expect(await screen.findByText(/has expired/)).toBeVisible();
    });
  });

  describe("invite link or code", () => {
    const CODE = "0123456789abcdef01234567";
    const globex = { id: "o9", name: "Globex", slug: "globex", created_ms: 2 };

    async function redeemWith(text: string) {
      inv.serversOrgRedeemLinkNew.mockResolvedValue(globex);
      const onSelect = vi.fn();
      render(
        <OrgPickerStep
          me={me({ orgs: [] })}
          url="https://dh.example.com"
          busy={false}
          onSelect={onSelect}
        />,
      );
      await userEvent.click(
        screen.getByRole("button", { name: /Have an invite code/ }),
      );
      await userEvent.type(screen.getByLabelText("Invite link or code"), text);
      await userEvent.click(
        screen.getByRole("button", { name: "Join organization" }),
      );
      await waitFor(() => expect(onSelect).toHaveBeenCalledWith(globex));
    }

    it("redeems a bare code", async () => {
      await redeemWith(CODE);
      expect(inv.serversOrgRedeemLinkNew).toHaveBeenCalledWith(
        "https://dh.example.com",
        CODE,
      );
    });

    it("takes a whole pasted link and redeems just its code", async () => {
      await redeemWith(`https://db.acme.com/?join=${CODE}`);
      expect(inv.serversOrgRedeemLinkNew).toHaveBeenCalledWith(
        "https://dh.example.com",
        CODE,
      );
    });
  });
});
