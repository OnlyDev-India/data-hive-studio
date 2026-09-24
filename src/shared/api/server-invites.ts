import { invoke } from "@tauri-apps/api/core";
import { WEB, wcall, wcallEmpty } from "./web";
import type { Organization, OrgRole } from "./server-admin";
import type { InviteStatus } from "./server-access";

// Organization invites (spec 0011): an email invite that only the named
// person can accept, and a shareable link with a use limit and an expiry. The
// server decides who may do each of these and answers 403 when the caller may
// not, so nothing here checks a role before calling.

/** An email invite into one org, as the org's Invites tab shows it. */
export interface OrgEmailInvite {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  /** Email of the person who made the invite. */
  created_by: string;
  created_ms: number;
  /** `null` means the invite never expires. */
  expires_ms: number | null;
  used_ms: number | null;
  /** Email of the account that accepted it. */
  used_by: string | null;
  status: InviteStatus;
}

/** An invite waiting for the signed in person to accept or decline. */
export interface PendingInvite {
  id: string;
  org_id: string;
  org_name: string;
  role: OrgRole;
  inviter_name: string;
  inviter_email: string;
  expires_ms: number | null;
}

/** A shareable link's code. It always grants the member role, and always has
 *  a use limit (1 to 100) and an expiry. */
export interface OrgLink {
  code: string;
  org_id: string;
  role: OrgRole;
  created_by: string;
  max_uses: number;
  uses_count: number;
  expires_ms: number;
  created_ms: number;
}

/** Link lifetimes the server accepts, in days. */
export const LINK_EXPIRY_DAYS = [1, 7, 30] as const;
export type LinkExpiryDays = (typeof LINK_EXPIRY_DAYS)[number];
export const DEFAULT_LINK_EXPIRY_DAYS: LinkExpiryDays = 7;
export const DEFAULT_LINK_MAX_USES = 10;
export const MAX_LINK_USES = 100;

const org = (orgId: string) => `/v1/orgs/${encodeURIComponent(orgId)}`;

// ---- Email invites -----------------------------------------------------------

export function serversOrgInvitesList(
  profileId: string,
  orgId: string,
): Promise<OrgEmailInvite[]> {
  if (WEB) return wcall("GET", `${org(orgId)}/invites`, undefined, true);
  return invoke("servers_org_invites_list", { profileId, orgId });
}

/** Invite an email into an org. An email that already has an unused invite
 *  into this org gets that invite refreshed, so calling twice is safe.
 *  `expiresDays` is 1, 7 or 30, or `null` for never. */
export function serversOrgInviteCreate(
  profileId: string,
  orgId: string,
  email: string,
  role: OrgRole,
  expiresDays: number | null,
): Promise<OrgEmailInvite> {
  if (WEB) {
    return wcall(
      "POST",
      `${org(orgId)}/invites`,
      { email, role, expires_days: expiresDays },
      true,
    );
  }
  return invoke("servers_org_invite_create", {
    profileId,
    orgId,
    email,
    role,
    expiresDays,
  });
}

export function serversOrgInviteRevoke(
  profileId: string,
  orgId: string,
  inviteId: string,
): Promise<void> {
  if (WEB) {
    return wcallEmpty(
      "DELETE",
      `${org(orgId)}/invites/${encodeURIComponent(inviteId)}`,
      undefined,
      true,
    );
  }
  return invoke("servers_org_invite_revoke", { profileId, orgId, inviteId });
}

// ---- The signed in person's own invites -----------------------------------------

export function serversMyInvites(profileId: string): Promise<PendingInvite[]> {
  if (WEB) return wcall("GET", "/v1/me/invites", undefined, true);
  return invoke("servers_my_invites", { profileId });
}

export function serversInviteAccept(
  profileId: string,
  inviteId: string,
): Promise<Organization> {
  if (WEB) {
    return wcall(
      "POST",
      `/v1/me/invites/${encodeURIComponent(inviteId)}/accept`,
      undefined,
      true,
    );
  }
  return invoke("servers_invite_accept", { profileId, inviteId });
}

export function serversInviteDecline(
  profileId: string,
  inviteId: string,
): Promise<void> {
  if (WEB) {
    return wcallEmpty(
      "POST",
      `/v1/me/invites/${encodeURIComponent(inviteId)}/decline`,
      undefined,
      true,
    );
  }
  return invoke("servers_invite_decline", { profileId, inviteId });
}

// The same three for a server the person just signed in to and has not saved
// as a profile yet (the org picker), so they take the server address.

export function serversMyInvitesNew(url: string): Promise<PendingInvite[]> {
  if (WEB) return wcall("GET", "/v1/me/invites", undefined, true);
  return invoke("servers_my_invites_new", { url });
}

export function serversInviteAcceptNew(
  url: string,
  inviteId: string,
): Promise<Organization> {
  if (WEB) {
    return wcall(
      "POST",
      `/v1/me/invites/${encodeURIComponent(inviteId)}/accept`,
      undefined,
      true,
    );
  }
  return invoke("servers_invite_accept_new", { url, inviteId });
}

export function serversInviteDeclineNew(
  url: string,
  inviteId: string,
): Promise<void> {
  if (WEB) {
    return wcallEmpty(
      "POST",
      `/v1/me/invites/${encodeURIComponent(inviteId)}/decline`,
      undefined,
      true,
    );
  }
  return invoke("servers_invite_decline_new", { url, inviteId });
}

// ---- Shareable links ---------------------------------------------------------------

export function serversOrgLinksList(
  profileId: string,
  orgId: string,
): Promise<OrgLink[]> {
  if (WEB) return wcall("GET", `${org(orgId)}/links`, undefined, true);
  return invoke("servers_org_links_list", { profileId, orgId });
}

/** Make a link. `maxUses` is 1 to 100 and `expiresDays` is 1, 7 or 30; the
 *  link always grants the member role. */
export function serversOrgLinkCreate(
  profileId: string,
  orgId: string,
  maxUses: number,
  expiresDays: LinkExpiryDays,
): Promise<OrgLink> {
  if (WEB) {
    return wcall(
      "POST",
      `${org(orgId)}/links`,
      { max_uses: maxUses, expires_days: expiresDays },
      true,
    );
  }
  return invoke("servers_org_link_create", {
    profileId,
    orgId,
    maxUses,
    expiresDays,
  });
}

export function serversOrgLinkRevoke(
  profileId: string,
  orgId: string,
  code: string,
): Promise<void> {
  if (WEB) {
    return wcallEmpty(
      "DELETE",
      `${org(orgId)}/links/${encodeURIComponent(code)}`,
      undefined,
      true,
    );
  }
  return invoke("servers_org_link_revoke", { profileId, orgId, code });
}

/** Redeem a shareable link's code on the server the person just signed in to. */
export function serversOrgRedeemLinkNew(
  url: string,
  code: string,
): Promise<Organization> {
  if (WEB) {
    return wcall<Organization>(
      "POST",
      `/v1/links/${encodeURIComponent(code)}/redeem`,
      undefined,
      true,
    );
  }
  return invoke("servers_org_redeem_link_new", { url, code });
}
