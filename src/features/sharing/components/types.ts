export interface DeviceInfo {
  id: string;
  token: string;
  user_name: string;
  team_name: string | null;
  admin: boolean;
  created_ms: number;
}

export interface ConnLite {
  id: string;
  name: string;
}

export interface GrantRow {
  token: string;
  conn_id: string;
  can_read: boolean;
  can_update: boolean;
  can_delete: boolean;
}

export type Tab = "tokens" | "devices" | "create";

export const TABS: { key: Tab; label: string }[] = [
  { key: "tokens", label: "Tokens" },
  { key: "devices", label: "Devices" },
  { key: "create", label: "Create Token" },
];
