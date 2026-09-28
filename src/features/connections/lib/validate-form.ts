import { WEB } from "@/shared/api/web";
import type {
  MongoFormValues,
  PgFormValues,
  SshFormValue,
} from "./form-values";
import { tabsFor, type FormDraft, type FormTabKey } from "./tab-fields";

export interface FieldError {
  tab: FormTabKey;
  field: string;
  message: string;
}

const WHOLE = /^\d+$/;

function checkPort(port: string, out: FieldError[]) {
  const v = port.trim();
  if (!v) return;
  const n = Number(v);
  if (!WHOLE.test(v) || n < 1 || n > 65535) {
    out.push({
      tab: "connection",
      field: "port",
      message: "Port must be a whole number from 1 to 65535.",
    });
  }
}

function checkSsh(v: SshFormValue, web: boolean, out: FieldError[]) {
  if (!v.ssh_host.trim()) return;
  if (!v.ssh_user.trim()) {
    out.push({
      tab: "ssh",
      field: "ssh_user",
      message: "SSH user is required.",
    });
  }
  if (!web && v.ssh_auth_mode === "key" && !v.ssh_key_file.trim()) {
    out.push({
      tab: "ssh",
      field: "ssh_key_file",
      message: "Choose the private key file.",
    });
  }
}

function checkAdvanced<T extends PgFormValues | MongoFormValues>(
  v: T,
  keys: (keyof T & string)[],
  out: FieldError[],
) {
  for (const key of keys) {
    const raw = String(v[key]).trim();
    if (raw && !WHOLE.test(raw)) {
      out.push({
        tab: "advanced",
        field: key,
        message: "Use a whole number of 0 or more.",
      });
    }
  }
  const min = v.pool_min.trim();
  const max = v.pool_max.trim();
  if (
    WHOLE.test(min) &&
    WHOLE.test(max) &&
    Number(min) > Number(max) &&
    !out.some((e) => e.field === "pool_min")
  ) {
    out.push({
      tab: "advanced",
      field: "pool_min",
      message: "Min pool connections can't be above max.",
    });
  }
}

export function validateForm(draft: FormDraft, web = WEB): FieldError[] {
  const out: FieldError[] = [];
  switch (draft.kind) {
    case "sqlite":
      if (!draft.values.path) {
        out.push({
          tab: "connection",
          field: "path",
          message: "Choose a database file.",
        });
      }
      break;
    case "postgres": {
      const v = draft.values;
      checkPort(v.port, out);
      checkSsh(v, web, out);
      checkAdvanced(
        v,
        [
          "pool_max",
          "pool_min",
          "connect_timeout_secs",
          "idle_timeout_secs",
          "max_lifetime_secs",
        ],
        out,
      );
      break;
    }
    case "mongodb":
    case "documentdb": {
      const v = draft.values;
      if (!v.srv) checkPort(v.port, out);
      if (!v.database.trim()) {
        out.push({
          tab: "connection",
          field: "database",
          message: "Database is required.",
        });
      }
      if (v.srv && v.ssh_host.trim()) {
        out.push({
          tab: "ssh",
          field: "ssh_host",
          message:
            "An SSH tunnel can't be combined with mongodb+srv://. Turn off SRV on the Connection tab.",
        });
      } else {
        checkSsh(v, web, out);
      }
      checkAdvanced(
        v,
        [
          "pool_max",
          "pool_min",
          "connect_timeout_secs",
          "idle_timeout_secs",
          "server_selection_timeout_secs",
        ],
        out,
      );
      break;
    }
  }
  return out;
}

export function firstErrorTab(
  kind: FormDraft["kind"],
  errors: FieldError[],
): FormTabKey | null {
  const tab = tabsFor(kind).find((t) => errors.some((e) => e.tab === t.key));
  return tab?.key ?? null;
}
