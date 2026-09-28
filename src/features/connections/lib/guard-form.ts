import {
  envPreset,
  isEnvColor,
  tidyEnvLabel,
  type ConnGuard,
} from "@/shared/api";

// The four guard fields as a connection form holds them (spec 0007): plain
// strings and booleans an input can bind to. `guardFromForm` turns them into
// the `ConnGuard` the backend takes; `guardToForm` goes the other way when a
// saved connection is loaded into the form.

export interface GuardFormValues {
  /** Refuse every write from this app on this connection. */
  read_only: boolean;
  /** Environment name: "" for none, a preset name, or custom text. */
  env_label: string;
  /** Palette key. Only means something for a custom label; "" otherwise.
   *  A custom environment whose name is not typed yet is `env_label: ""`
   *  with a colour set, which is how the form tells that from "none". */
  env_color: string;
  /** Ask before every write, even without a Production label. */
  confirm_writes: boolean;
}

export const EMPTY_GUARD_FORM: GuardFormValues = {
  read_only: false,
  env_label: "",
  env_color: "",
  confirm_writes: false,
};

/** The colour a custom environment starts with. */
export const DEFAULT_CUSTOM_COLOR = "grey";

/** Which choice the environment select shows: none, one of the presets (by
 *  its label), or a custom name. */
export type EnvMode = "none" | "custom" | (string & {});

export function envModeOf(v: GuardFormValues): EnvMode {
  const preset = envPreset(v.env_label);
  if (preset) return preset.label;
  if (v.env_label.trim() !== "" || v.env_color !== "") return "custom";
  return "none";
}

/** The guard to send when connecting or saving. An empty label means no
 *  environment at all (no colour either), and a preset carries no colour of
 *  its own because the preset decides it. Absent fields stay absent. */
export function guardFromForm(v: GuardFormValues): ConnGuard {
  const label = tidyEnvLabel(v.env_label);
  const guard: ConnGuard = { read_only: v.read_only };
  if (label) {
    guard.env_label = label;
    if (!envPreset(label)) {
      guard.env_color = isEnvColor(v.env_color)
        ? v.env_color
        : DEFAULT_CUSTOM_COLOR;
    }
  }
  if (v.confirm_writes) guard.confirm_writes = true;
  return guard;
}

/** Form values for a saved connection (or anything carrying a guard). A
 *  connection saved before this feature has none of the fields and loads as
 *  not read only, no label. */
export function guardToForm(
  saved: ConnGuard | null | undefined,
): GuardFormValues {
  const label = tidyEnvLabel(saved?.env_label) ?? "";
  return {
    read_only: saved?.read_only ?? false,
    env_label: label,
    env_color:
      label && !envPreset(label) && isEnvColor(saved?.env_color)
        ? saved.env_color
        : "",
    confirm_writes: saved?.confirm_writes ?? false,
  };
}

/** True when the guard says nothing: not read only, no label, no confirm. A
 *  plain connection is opened exactly as it was before this feature, with no
 *  guard sent at all. */
export function isPlainGuard(guard: ConnGuard): boolean {
  return !guard.read_only && !guard.env_label && !guard.confirm_writes;
}

/** Apply a `GuardFields` change to a form that keeps its values flat and sets
 *  them one key at a time. */
export function applyGuardPatch(
  setField: (key: keyof GuardFormValues, value: string | boolean) => void,
  patch: Partial<GuardFormValues>,
): void {
  for (const [key, value] of Object.entries(patch)) {
    setField(key as keyof GuardFormValues, value);
  }
}
