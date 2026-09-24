import { invoke } from "@tauri-apps/api/core";
import { WEB, wcall, wcallEmpty } from "./web";
import type { MeResult, ServerRole } from "./server-admin";

// Server access: who may join this server, and with what server role. The
// server decides who is allowed to do each of these, and answers 403 when the
// caller may not, so nothing here checks a role before calling.

export type InviteStatus = "open" | "used" | "expired";

export interface ServerInvite {
  id: string;
  email: string;
  /** Email of the person who made the invite. */
  created_by: string;
  created_ms: number;
  /** `null` means the invite never expires. */
  expires_ms: number | null;
  used_ms: number | null;
  /** Email of the account the invite created, once used. */
  used_by: string | null;
  status: InviteStatus;
}

export interface ServerAccount {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  server_role: ServerRole;
  can_manage_roles: boolean;
  /** Only ever true for an admin an owner switched it on for. */
  can_create_orgs: boolean;
  /** Providers this person has signed in with, such as `google`. */
  providers: string[];
  created_ms: number;
}

/** One row of the server owner's org list: names and counts only. */
export interface ServerOrg {
  id: string;
  name: string;
  slug: string;
  created_ms: number;
  /** Email of the creator; `null` for an org that predates this feature. */
  created_by: string | null;
  member_count: number;
  /** Emails of the org's owners. */
  owners: string[];
}

export interface ServerSettings {
  open_org_creation: boolean;
}

/** Invite lifetimes the server accepts; `null` is "never". */
export const INVITE_EXPIRY_DAYS = [1, 7, 30, null] as const;
export type InviteExpiryDays = (typeof INVITE_EXPIRY_DAYS)[number];
export const DEFAULT_INVITE_EXPIRY_DAYS = 7;

export function serverInvitesList(profileId: string): Promise<ServerInvite[]> {
  if (WEB) {
    return wcall("GET", "/v1/server/invites", undefined, true);
  }
  return invoke("servers_access_invites_list", { profileId });
}

/** Invite an email. An email that already has an open (or expired) invite gets
 *  that invite refreshed, so calling this twice is safe. */
export function serverInviteCreate(
  profileId: string,
  email: string,
  expiresDays: InviteExpiryDays,
): Promise<ServerInvite> {
  if (WEB) {
    return wcall(
      "POST",
      "/v1/server/invites",
      { email, expires_days: expiresDays },
      true,
    );
  }
  return invoke("servers_access_invite_create", {
    profileId,
    email,
    expiresDays,
  });
}

export function serverInviteRevoke(
  profileId: string,
  inviteId: string,
): Promise<void> {
  if (WEB) {
    return wcallEmpty(
      "DELETE",
      `/v1/server/invites/${encodeURIComponent(inviteId)}`,
      undefined,
      true,
    );
  }
  return invoke("servers_access_invite_revoke", { profileId, inviteId });
}

export function serverAccountsList(
  profileId: string,
): Promise<ServerAccount[]> {
  if (WEB) {
    return wcall("GET", "/v1/server/accounts", undefined, true);
  }
  return invoke("servers_access_accounts_list", { profileId });
}

export function serverAccountSetRole(
  profileId: string,
  userId: string,
  role: ServerRole,
): Promise<void> {
  if (WEB) {
    return wcallEmpty(
      "PUT",
      `/v1/server/accounts/${encodeURIComponent(userId)}/role`,
      { role },
      true,
    );
  }
  return invoke("servers_access_set_role", { profileId, userId, role });
}

export function serverAccountSetManageRoles(
  profileId: string,
  userId: string,
  enabled: boolean,
): Promise<void> {
  if (WEB) {
    return wcallEmpty(
      "PUT",
      `/v1/server/accounts/${encodeURIComponent(userId)}/manage-roles`,
      { enabled },
      true,
    );
  }
  return invoke("servers_access_set_manage_roles", {
    profileId,
    userId,
    enabled,
  });
}

/** Turn "Can create organizations" on or off for an admin (owner only). */
export function serverAccountSetCreateOrgs(
  profileId: string,
  userId: string,
  enabled: boolean,
): Promise<void> {
  if (WEB) {
    return wcallEmpty(
      "PUT",
      `/v1/server/accounts/${encodeURIComponent(userId)}/create-orgs`,
      { enabled },
      true,
    );
  }
  return invoke("servers_access_set_create_orgs", {
    profileId,
    userId,
    enabled,
  });
}

/** Every org on the server, names and counts only (owner only). */
export function serverOrgsList(profileId: string): Promise<ServerOrg[]> {
  if (WEB) {
    return wcall("GET", "/v1/server/orgs", undefined, true);
  }
  return invoke("servers_access_orgs_list", { profileId });
}

export function serverSettingsGet(profileId: string): Promise<ServerSettings> {
  if (WEB) {
    return wcall("GET", "/v1/server/settings", undefined, true);
  }
  return invoke("servers_access_settings_get", { profileId });
}

/** Open org creation to every signed in person, one org each (owner only). */
export function serverSetOpenOrgCreation(
  profileId: string,
  enabled: boolean,
): Promise<void> {
  if (WEB) {
    return wcallEmpty(
      "PUT",
      "/v1/server/settings/open-org-creation",
      { enabled },
      true,
    );
  }
  return invoke("servers_access_set_open_org_creation", {
    profileId,
    enabled,
  });
}

// ---- What the signed in person may see and do ------------------------------
//
// Mirrors `AuthCtx` on the server (`can_invite`, `can_manage_accounts`). Only
// decides what to SHOW: the server enforces every call itself.

/** Owners and admins may invite and revoke. */
export function canInvite(me: Pick<MeResult, "server_role">): boolean {
  return me.server_role === "owner" || me.server_role === "admin";
}

/** Owners, and admins whose switch is on, may list accounts and change roles. */
export function canManageAccounts(
  me: Pick<MeResult, "server_role" | "can_manage_roles">,
): boolean {
  return (
    me.server_role === "owner" ||
    (me.server_role === "admin" && me.can_manage_roles)
  );
}

/** The roles the caller may give an account that currently has `target`.
 *  Empty means the row is read only for this caller. An owner may set any
 *  role; an admin with the switch on may only move people between member and
 *  admin, and never touches an owner. */
export function assignableRoles(
  me: Pick<MeResult, "server_role" | "can_manage_roles">,
  target: ServerRole,
): ServerRole[] {
  if (me.server_role === "owner") return ["member", "admin", "owner"];
  if (canManageAccounts(me) && target !== "owner") return ["member", "admin"];
  return [];
}

/** Plain words for a refused access call, from the server's answer. */
export function accessErrorMessage(e: unknown): string {
  const raw = String(e instanceof Error ? e.message : e);
  if (raw.includes("already_has_account")) {
    return "That email already has an account on this server.";
  }
  if (raw.includes("already_used")) {
    return "That invite was already used, so it can't be changed.";
  }
  if (raw.includes("last_owner")) {
    return "An organization must keep at least one owner. Make someone else an owner first.";
  }
  if (raw.includes("already_member")) {
    return "That person is already in this organization.";
  }
  if (raw.includes("invite_expired")) {
    return "That invitation has expired. Ask them to send a new one.";
  }
  if (raw.includes("org_limit")) {
    return "You've already created an organization. Each person can create one.";
  }
  if (raw.includes("not_an_admin")) {
    return "This switch only applies to an admin.";
  }
  if (raw.includes("403")) {
    return "You don't have permission to do that.";
  }
  return raw;
}
