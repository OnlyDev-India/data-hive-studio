import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MeResult } from "@/shared/api/server-admin";
import type { ServerAccount, ServerInvite } from "@/shared/api/server-access";

const api = vi.hoisted(() => ({
  serverInvitesList: vi.fn(),
  serverInviteCreate: vi.fn(),
  serverInviteRevoke: vi.fn(),
  serverAccountsList: vi.fn(),
  serverAccountSetRole: vi.fn(),
  serverAccountSetManageRoles: vi.fn(),
}));
vi.mock("@/shared/api/server-access", async (orig) => ({
  ...(await orig<typeof import("@/shared/api/server-access")>()),
  ...api,
}));
// Store changes schedule a debounced workspace save; keep it off Tauri IPC.
vi.mock("@/shared/api/workspace-state", () => ({
  saveWorkspaceState: vi.fn().mockResolvedValue(undefined),
}));

import { ServerAccessDialog } from "../server-access-dialog";

const me = (
  server_role: MeResult["server_role"],
  can_manage_roles = false,
): MeResult => ({
  user_id: "me",
  email: "me@x.com",
  name: "Me",
  server_role,
  can_manage_roles,
  orgs: [],
});

const invite = (over: Partial<ServerInvite>): ServerInvite => ({
  id: "i1",
  email: "new@x.com",
  created_by: "boss@x.com",
  created_ms: 1,
  expires_ms: null,
  used_ms: null,
  used_by: null,
  status: "open",
  ...over,
});

const account = (over: Partial<ServerAccount>): ServerAccount => ({
  id: "a1",
  email: "a@x.com",
  name: "A",
  avatar_url: null,
  server_role: "member",
  can_manage_roles: false,
  providers: ["google"],
  created_ms: 1,
  ...over,
});

function open(caller: MeResult) {
  return render(
    <ServerAccessDialog
      open
      onOpenChange={() => {}}
      profileId="p1"
      serverName="Acme server"
      me={caller}
    />,
  );
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.serverInvitesList.mockResolvedValue([]);
  api.serverAccountsList.mockResolvedValue([
    account({
      id: "o1",
      email: "boss@x.com",
      name: "Boss",
      server_role: "owner",
    }),
    account({
      id: "ad1",
      email: "admin@x.com",
      name: "Adm",
      server_role: "admin",
    }),
    account({ id: "m1", email: "mem@x.com", name: "Mem" }),
  ]);
});
afterEach(cleanup);

describe("who sees what", () => {
  it("shows an owner Invites and People", async () => {
    open(me("owner"));
    expect(screen.getByRole("tab", { name: "Invites" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "People" })).toBeVisible();
    expect(
      screen.queryByText(/Managing people is off/),
    ).not.toBeInTheDocument();
  });

  it("shows an admin without the switch only Invites, and says why", () => {
    open(me("admin", false));
    expect(screen.getByRole("tab", { name: "Invites" })).toBeVisible();
    expect(
      screen.queryByRole("tab", { name: "People" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Managing people is off/)).toBeVisible();
  });

  it("shows an admin with the switch on People too", () => {
    open(me("admin", true));
    expect(screen.getByRole("tab", { name: "People" })).toBeVisible();
  });

  it("shows a member nothing", () => {
    const { container } = open(me("member"));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Server access")).not.toBeInTheDocument();
    expect(api.serverInvitesList).not.toHaveBeenCalled();
  });
});

describe("Invites", () => {
  it("creates an invite for the typed email with the 7 day default", async () => {
    api.serverInviteCreate.mockResolvedValue(invite({}));
    open(me("owner"));
    await userEvent.type(
      screen.getByLabelText("Email to invite"),
      " New@X.com ",
    );
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() =>
      expect(api.serverInviteCreate).toHaveBeenCalledWith("p1", "New@X.com", 7),
    );
  });

  it("lists invites with their status and revokes an unused one on the second click", async () => {
    api.serverInvitesList.mockResolvedValue([
      invite({ id: "i1", email: "open@x.com" }),
      invite({
        id: "i2",
        email: "old@x.com",
        status: "expired",
        expires_ms: 1,
      }),
      invite({
        id: "i3",
        email: "done@x.com",
        status: "used",
        used_ms: 5,
        used_by: "done@x.com",
      }),
    ]);
    api.serverInviteRevoke.mockResolvedValue(undefined);
    open(me("admin"));
    expect(await screen.findByText("open@x.com")).toBeVisible();
    expect(screen.getByText("expired")).toBeVisible();
    expect(screen.getByText("used")).toBeVisible();
    // A used invite cannot be revoked.
    expect(
      screen.queryByRole("button", { name: "Revoke invite for done@x.com" }),
    ).not.toBeInTheDocument();

    const revoke = screen.getByRole("button", {
      name: "Revoke invite for open@x.com",
    });
    await userEvent.click(revoke);
    expect(api.serverInviteRevoke).not.toHaveBeenCalled();
    await userEvent.click(revoke);
    await waitFor(() =>
      expect(api.serverInviteRevoke).toHaveBeenCalledWith("p1", "i1"),
    );
  });
});

describe("People", () => {
  async function peopleTab() {
    await userEvent.click(screen.getByRole("tab", { name: "People" }));
    return screen.findByText("boss@x.com");
  }

  it("gives an owner a role select on every row and the switch on admins", async () => {
    open(me("owner"));
    await peopleTab();
    for (const email of ["boss@x.com", "admin@x.com", "mem@x.com"]) {
      expect(screen.getByLabelText(`Role for ${email}`)).toBeVisible();
    }
    expect(screen.getAllByRole("switch")).toHaveLength(1);
    await userEvent.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(api.serverAccountSetManageRoles).toHaveBeenCalledWith(
        "p1",
        "ad1",
        true,
      ),
    );
  });

  it("keeps an owner row read only for an admin with the switch, and offers no switch", async () => {
    open(me("admin", true));
    await peopleTab();
    // The owner row shows a plain badge, not a select.
    expect(
      screen.queryByLabelText("Role for boss@x.com"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Role for admin@x.com")).toBeVisible();
    expect(screen.getByLabelText("Role for mem@x.com")).toBeVisible();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    const owner_row = screen.getByText("boss@x.com").closest("div.flex-wrap")!;
    expect(within(owner_row as HTMLElement).getByText("owner")).toBeVisible();
  });
});
