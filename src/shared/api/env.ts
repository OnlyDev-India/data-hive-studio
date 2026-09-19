import type { ConnGuard } from "./types";

// Environment labels (spec 0007). A label is display only, with one effect:
// a Production label (or the Confirm before writes box) makes every write
// ask first. It never refuses anything, that is read only's job.

/** The palette keys a custom label may use. Keep in step with the `--env-*`
 *  variables in `src/index.css` and `ENV_COLOR_KEYS` in
 *  `crates/dh-core/src/api/common.rs`. */
export const ENV_COLORS = [
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "purple",
  "grey",
] as const;

export type EnvColor = (typeof ENV_COLORS)[number];

/** Longest label, in characters. Same limit as the Rust side. */
export const ENV_LABEL_MAX = 24;

/** The three named environments, each with a fixed colour. */
export const ENV_PRESETS = [
  { label: "Production", color: "red" },
  { label: "Staging", color: "amber" },
  { label: "Development", color: "green" },
] as const satisfies readonly { label: string; color: EnvColor }[];

export type EnvPresetLabel = (typeof ENV_PRESETS)[number]["label"];

/** The preset a label names (case insensitive), or null for a custom label. */
export function envPreset(
  label: string | null | undefined,
): (typeof ENV_PRESETS)[number] | null {
  const key = label?.trim().toLowerCase();
  if (!key) return null;
  return ENV_PRESETS.find((p) => p.label.toLowerCase() === key) ?? null;
}

/** A label as it is stored: trimmed, at most `ENV_LABEL_MAX` characters, and
 *  null when nothing is left. */
export function tidyEnvLabel(raw: string | null | undefined): string | null {
  const label = (raw ?? "").trim();
  if (!label) return null;
  return Array.from(label).slice(0, ENV_LABEL_MAX).join("");
}

export function isEnvColor(key: string | null | undefined): key is EnvColor {
  return !!key && (ENV_COLORS as readonly string[]).includes(key);
}

/** The palette key a connection's chip uses, or null when it has no label. A
 *  preset label always wears its own colour; a custom one uses `env_color`,
 *  and an unknown or missing key renders grey. */
export function envColorKey(conn: ConnGuard): EnvColor | null {
  const label = tidyEnvLabel(conn.env_label);
  if (!label) return null;
  const preset = envPreset(label);
  if (preset) return preset.color;
  return isEnvColor(conn.env_color) ? conn.env_color : "grey";
}

/** True when the label is the Production preset. */
export function isProductionEnv(conn: ConnGuard): boolean {
  return envPreset(conn.env_label)?.label === "Production";
}

/** Whether a write on this connection should ask first: a Production label,
 *  or Confirm before writes turned on. A custom label never asks by itself. */
export function needsWriteConfirm(conn: ConnGuard): boolean {
  return isProductionEnv(conn) || !!conn.confirm_writes;
}

/** True when the connection carries anything worth showing: a label or the
 *  read only lock. */
export function hasConnFlags(conn: ConnGuard): boolean {
  return !!conn.read_only || tidyEnvLabel(conn.env_label) !== null;
}

/** Why a write on this connection asks first, in a sentence for the confirm
 *  dialog. Null when it does not ask. */
export function envConfirmReason(conn: ConnGuard): string | null {
  if (isProductionEnv(conn)) return "This is a Production connection.";
  if (conn.confirm_writes) {
    return "Confirm before writes is on for this connection.";
  }
  return null;
}
