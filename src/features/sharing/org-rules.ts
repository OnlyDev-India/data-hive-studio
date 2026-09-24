import type { OrgRole } from "@/shared/api/server-admin";

// What the caller may do in an org. Mirrors the server (spec 0011): it only
// decides what to SHOW, the server enforces every call itself.

/** The org roles the caller may put on an email invite. An owner may invite
 *  as any role; an admin as member or admin only; anyone else cannot invite. */
export function invitableRoles(myRole: OrgRole | undefined): OrgRole[] {
  if (myRole === "owner") return ["member", "admin", "owner"];
  if (myRole === "admin") return ["member", "admin"];
  return [];
}

/** The roles the caller may give a member who currently has `target`. Empty
 *  means the row is read only for this caller. An owner may set any role; an
 *  admin only moves people between member and admin and never touches an
 *  owner; a plain member changes nobody. */
export function assignableOrgRoles(
  caller: OrgRole | undefined,
  target: OrgRole,
): OrgRole[] {
  if (caller === "owner") return ["member", "admin", "owner"];
  if (caller === "admin" && target !== "owner") return ["member", "admin"];
  return [];
}

/** Whether the caller may remove a member with role `target`. Anyone may
 *  remove themselves (leave); an owner removes anyone; an admin removes a
 *  member or an admin, never an owner. */
export function canRemoveMember(
  caller: OrgRole | undefined,
  target: OrgRole,
  isSelf: boolean,
): boolean {
  if (isSelf) return true;
  if (caller === "owner") return true;
  return caller === "admin" && target !== "owner";
}
