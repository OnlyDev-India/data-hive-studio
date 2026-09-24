export type { OrgMember, OrgRole } from "@/shared/api/server-admin";
export type {
  OrgEmailInvite,
  OrgLink,
  PendingInvite,
} from "@/shared/api/server-invites";

export interface ConnLite {
  id: string;
  name: string;
}

export type Tab = "members" | "invites" | "audit" | "devices";

export const TABS: { key: Tab; label: string }[] = [
  { key: "members", label: "Members" },
  { key: "invites", label: "Invites" },
  { key: "audit", label: "Audit log" },
  { key: "devices", label: "My devices" },
];

export const ROLES = ["member", "admin", "owner"] as const;
