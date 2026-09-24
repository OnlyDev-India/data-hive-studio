import { describe, expect, it } from "vitest";
import {
  assignableOrgRoles,
  canRemoveMember,
  invitableRoles,
} from "../org-rules";

describe("invitableRoles", () => {
  it("lets an owner pick any role, an admin member or admin, others none", () => {
    expect(invitableRoles("owner")).toEqual(["member", "admin", "owner"]);
    expect(invitableRoles("admin")).toEqual(["member", "admin"]);
    expect(invitableRoles("member")).toEqual([]);
    expect(invitableRoles(undefined)).toEqual([]);
  });
});

describe("assignableOrgRoles", () => {
  it("lets an owner set any role on anyone", () => {
    for (const target of ["member", "admin", "owner"] as const) {
      expect(assignableOrgRoles("owner", target)).toEqual([
        "member",
        "admin",
        "owner",
      ]);
    }
  });

  it("keeps an admin to member and admin, and off owners", () => {
    expect(assignableOrgRoles("admin", "member")).toEqual(["member", "admin"]);
    expect(assignableOrgRoles("admin", "admin")).toEqual(["member", "admin"]);
    expect(assignableOrgRoles("admin", "owner")).toEqual([]);
  });

  it("gives a plain member, or someone not in the org, nothing", () => {
    expect(assignableOrgRoles("member", "member")).toEqual([]);
    expect(assignableOrgRoles(undefined, "member")).toEqual([]);
  });
});

describe("canRemoveMember", () => {
  it("lets anyone leave", () => {
    for (const caller of ["owner", "admin", "member"] as const) {
      expect(canRemoveMember(caller, caller, true)).toBe(true);
    }
  });

  it("lets an owner remove anyone and an admin anyone but an owner", () => {
    expect(canRemoveMember("owner", "owner", false)).toBe(true);
    expect(canRemoveMember("admin", "member", false)).toBe(true);
    expect(canRemoveMember("admin", "admin", false)).toBe(true);
    expect(canRemoveMember("admin", "owner", false)).toBe(false);
  });

  it("stops a plain member removing someone else", () => {
    expect(canRemoveMember("member", "member", false)).toBe(false);
    expect(canRemoveMember(undefined, "member", false)).toBe(false);
  });
});
