import { afterEach, describe, expect, it, vi } from "vitest";
import { mockTauriCore } from "@/test/mock-tauri";

vi.mock("@tauri-apps/api/core", () => mockTauriCore());

// Fresh module per WEB mode, the same approach as server-admin.test.ts.
async function load(web: boolean) {
  vi.resetModules();
  const wcall = vi.fn().mockResolvedValue({});
  const wcallEmpty = vi.fn().mockResolvedValue(undefined);
  vi.doMock("../web", () => ({ WEB: web, wcall, wcallEmpty }));
  const mod = await import("../server-invites");
  // After resetModules, so it is the same mocked instance `mod` calls.
  const { invoke } = await import("@tauri-apps/api/core");
  return { mod, wcall, wcallEmpty, invoke: vi.mocked(invoke) };
}

afterEach(() => {
  vi.doUnmock("../web");
  vi.resetModules();
});

describe("email invites on the web", () => {
  it("uses the org invites routes, with the email in the body", async () => {
    const { mod, wcall, wcallEmpty } = await load(true);
    await mod.serversOrgInviteCreate("p1", "o 1", "bob@x.com", "admin", null);
    expect(wcall).toHaveBeenCalledWith(
      "POST",
      "/v1/orgs/o%201/invites",
      { email: "bob@x.com", role: "admin", expires_days: null },
      true,
    );
    await mod.serversOrgInvitesList("p1", "o1");
    expect(wcall).toHaveBeenLastCalledWith(
      "GET",
      "/v1/orgs/o1/invites",
      undefined,
      true,
    );
    await mod.serversOrgInviteRevoke("p1", "o1", "i1");
    expect(wcallEmpty).toHaveBeenCalledWith(
      "DELETE",
      "/v1/orgs/o1/invites/i1",
      undefined,
      true,
    );
  });

  it("accepts and declines through the person's own routes", async () => {
    const { mod, wcall, wcallEmpty } = await load(true);
    await mod.serversMyInvites("p1");
    expect(wcall).toHaveBeenCalledWith(
      "GET",
      "/v1/me/invites",
      undefined,
      true,
    );
    await mod.serversInviteAccept("p1", "i1");
    expect(wcall).toHaveBeenLastCalledWith(
      "POST",
      "/v1/me/invites/i1/accept",
      undefined,
      true,
    );
    await mod.serversInviteDecline("p1", "i1");
    expect(wcallEmpty).toHaveBeenCalledWith(
      "POST",
      "/v1/me/invites/i1/decline",
      undefined,
      true,
    );
    await mod.serversInviteAcceptNew("https://x", "i2");
    expect(wcall).toHaveBeenLastCalledWith(
      "POST",
      "/v1/me/invites/i2/accept",
      undefined,
      true,
    );
  });

  it("keeps shareable links on their own routes", async () => {
    const { mod, wcall, wcallEmpty } = await load(true);
    await mod.serversOrgLinksList("p1", "o1");
    expect(wcall).toHaveBeenCalledWith(
      "GET",
      "/v1/orgs/o1/links",
      undefined,
      true,
    );
    await mod.serversOrgLinkCreate("p1", "o1", 5, 30);
    expect(wcall).toHaveBeenLastCalledWith(
      "POST",
      "/v1/orgs/o1/links",
      { max_uses: 5, expires_days: 30 },
      true,
    );
    await mod.serversOrgLinkRevoke("p1", "o1", "abc");
    expect(wcallEmpty).toHaveBeenCalledWith(
      "DELETE",
      "/v1/orgs/o1/links/abc",
      undefined,
      true,
    );
    await mod.serversOrgRedeemLinkNew("https://x", "abc");
    expect(wcall).toHaveBeenLastCalledWith(
      "POST",
      "/v1/links/abc/redeem",
      undefined,
      true,
    );
  });
});

describe("email invites on desktop", () => {
  it("calls the Tauri commands with camelCase arguments", async () => {
    const { mod, invoke } = await load(false);
    invoke.mockResolvedValue({});
    await mod.serversOrgInviteCreate("p1", "o1", "bob@x.com", "member", 7);
    expect(invoke).toHaveBeenLastCalledWith("servers_org_invite_create", {
      profileId: "p1",
      orgId: "o1",
      email: "bob@x.com",
      role: "member",
      expiresDays: 7,
    });
    await mod.serversOrgInviteRevoke("p1", "o1", "i1");
    expect(invoke).toHaveBeenLastCalledWith("servers_org_invite_revoke", {
      profileId: "p1",
      orgId: "o1",
      inviteId: "i1",
    });
    await mod.serversMyInvitesNew("https://x");
    expect(invoke).toHaveBeenLastCalledWith("servers_my_invites_new", {
      url: "https://x",
    });
    await mod.serversInviteDecline("p1", "i1");
    expect(invoke).toHaveBeenLastCalledWith("servers_invite_decline", {
      profileId: "p1",
      inviteId: "i1",
    });
    await mod.serversOrgLinkCreate("p1", "o1", 5, 7);
    expect(invoke).toHaveBeenLastCalledWith("servers_org_link_create", {
      profileId: "p1",
      orgId: "o1",
      maxUses: 5,
      expiresDays: 7,
    });
    await mod.serversOrgRedeemLinkNew("https://x", "abc");
    expect(invoke).toHaveBeenLastCalledWith("servers_org_redeem_link_new", {
      url: "https://x",
      code: "abc",
    });
  });
});
