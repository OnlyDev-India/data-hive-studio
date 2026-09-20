import { describe, it, expect } from "vitest";
import {
  accessErrorMessage,
  assignableRoles,
  canInvite,
  canManageAccounts,
} from "../server-access";

const owner = { server_role: "owner", can_manage_roles: false } as const;
const admin = { server_role: "admin", can_manage_roles: false } as const;
const helper = { server_role: "admin", can_manage_roles: true } as const;
const member = { server_role: "member", can_manage_roles: false } as const;

describe("what each caller may see", () => {
  it("owners and admins invite; members do not", () => {
    expect(canInvite(owner)).toBe(true);
    expect(canInvite(admin)).toBe(true);
    expect(canInvite(helper)).toBe(true);
    expect(canInvite(member)).toBe(false);
  });

  it("people is for owners and for admins with the switch on", () => {
    expect(canManageAccounts(owner)).toBe(true);
    expect(canManageAccounts(helper)).toBe(true);
    expect(canManageAccounts(admin)).toBe(false);
    expect(canManageAccounts(member)).toBe(false);
  });
});

describe("assignableRoles", () => {
  it("lets an owner set any role on anyone", () => {
    for (const target of ["member", "admin", "owner"] as const) {
      expect(assignableRoles(owner, target)).toEqual([
        "member",
        "admin",
        "owner",
      ]);
    }
  });

  it("limits an admin with the switch to member and admin, never an owner", () => {
    expect(assignableRoles(helper, "member")).toEqual(["member", "admin"]);
    expect(assignableRoles(helper, "admin")).toEqual(["member", "admin"]);
    expect(assignableRoles(helper, "owner")).toEqual([]);
  });

  it("offers nothing to an admin without the switch or to a member", () => {
    expect(assignableRoles(admin, "member")).toEqual([]);
    expect(assignableRoles(member, "member")).toEqual([]);
  });
});

describe("accessErrorMessage", () => {
  it("turns the server's codes into plain words", () => {
    expect(accessErrorMessage(new Error("409 — already_has_account"))).toMatch(
      /already has an account/,
    );
    expect(accessErrorMessage("409 — last_owner")).toMatch(
      /at least one owner/,
    );
    expect(accessErrorMessage("409 — already_used")).toMatch(/already used/);
    expect(accessErrorMessage("409 — not_an_admin")).toMatch(
      /only applies to an admin/,
    );
    expect(accessErrorMessage("403 — forbidden")).toMatch(/permission/);
    expect(accessErrorMessage("400 — enter a valid email address")).toBe(
      "400 — enter a valid email address",
    );
  });
});
