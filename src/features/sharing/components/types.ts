export type { OrgMember, OrgInvite, OrgRole } from "@/shared/api/server-admin";

export interface ConnLite {
  id: string;
  name: string;
}

export type Tab = "members" | "invites" | "audit";

export const TABS: { key: Tab; label: string }[] = [
  { key: "members", label: "Members" },
  { key: "invites", label: "Invites" },
  { key: "audit", label: "Audit log" },
];

export const ROLES = ["viewer", "member", "admin", "owner"] as const;
