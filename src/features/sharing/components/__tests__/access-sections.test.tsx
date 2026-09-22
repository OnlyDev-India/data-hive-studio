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
import { useStudioStore } from "@/shared/store";
import type { StudioStore } from "@/shared/store/types";

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

import { AccessInvitesSection, inviteWhen } from "../access-invites-section";
import { AccessPeopleSection } from "../access-people-section";

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

function invites() {
  return render(<AccessInvitesSection profileId="p1" />);
}

function people(caller: MeResult) {
  return render(<AccessPeopleSection profileId="p1" me={caller} />);
}

let original_push_notification: StudioStore["pushNotification"];

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
  original_push_notification = useStudioStore.getState().pushNotification;
});
afterEach(() => {
  cleanup();
  useStudioStore.setState({ pushNotification: original_push_notification });
});

describe("inviteWhen", () => {
  const NOW = 1_700_000_000_000;

  it("says who joined, or just Used, for a used invite", () => {
    expect(
      inviteWhen(invite({ status: "used", used_by: "a@x.com" }), NOW),
    ).toBe("Joined as a@x.com");
    expect(inviteWhen(invite({ status: "used", used_by: null }), NOW)).toBe(
      "Used",
    );
  });

  it("says Never expires when expires_ms is null, regardless of status", () => {
    expect(inviteWhen(invite({ expires_ms: null }), NOW)).toBe(
      "Never expires",
    );
  });

  it("says Expired once the status has flipped, even if the math is close", () => {
    expect(
      inviteWhen(invite({ status: "expired", expires_ms: NOW - 1 }), NOW),
    ).toBe("Expired");
  });

  it("rounds down to a same-day warning inside the last 24 hours", () => {
    expect(
      inviteWhen(invite({ status: "open", expires_ms: NOW + 3_600_000 }), NOW),
    ).toBe("Expires within a day");
  });

  it("counts whole days remaining otherwise", () => {
    expect(
      inviteWhen(
        invite({ status: "open", expires_ms: NOW + 3 * 86_400_000 }),
        NOW,
      ),
    ).toBe("Expires in 3 days");
  });
});

describe("Server invites", () => {
  it("tells the person when invites fail to load", async () => {
    api.serverInvitesList.mockRejectedValue(new Error("500 — boom"));
    const push = vi.fn();
    useStudioStore.setState({ pushNotification: push });
    invites();
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "error",
          title: "Couldn't load invites",
        }),
      ),
    );
    // Falls back to an empty list rather than staying stuck loading forever.
    expect(
      await screen.findByText(/No invites yet/),
    ).toBeVisible();
  });

  it("tells the person when creating an invite fails, and does not clear the form", async () => {
    api.serverInviteCreate.mockRejectedValue(new Error("409 — already_has_account"));
    const push = vi.fn();
    useStudioStore.setState({ pushNotification: push });
    invites();
    await userEvent.type(
      screen.getByLabelText("Email to invite"),
      "taken@x.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "error",
          title: "Couldn't create the invite",
        }),
      ),
    );
    expect(screen.getByLabelText("Email to invite")).toHaveValue(
      "taken@x.com",
    );
  });

  it("creates an invite for the typed email with the 7 day default", async () => {
    api.serverInviteCreate.mockResolvedValue(invite({}));
    invites();
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
    invites();
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

describe("Server accounts", () => {
  const peopleLoaded = () => screen.findByText("boss@x.com");

  it("tells the person when accounts fail to load", async () => {
    api.serverAccountsList.mockRejectedValue(new Error("500 — boom"));
    const push = vi.fn();
    useStudioStore.setState({ pushNotification: push });
    people(me("owner"));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "error",
          title: "Couldn't load people",
        }),
      ),
    );
  });

  it("gives an owner a role select on every row and the switch on admins", async () => {
    people(me("owner"));
    await peopleLoaded();
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
    people(me("admin", true));
    await peopleLoaded();
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
