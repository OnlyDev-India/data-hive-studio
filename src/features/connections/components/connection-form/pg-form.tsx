import { WEB } from "@/shared/api/web";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import type { PgFormValues } from "../../lib/form-values";
import type { FormTabKey } from "../../lib/tab-fields";
import { parseConnectionUrl } from "../../lib/url-import";
import { FilePathInput } from "../file-path-input";
import { GuardFields } from "../guard-fields";
import { RememberSecret } from "../remember-secret";
import { SshFields } from "../ssh-fields";
import {
  fieldId,
  HostPortRow,
  NumberRows,
  PasswordRow,
  TextRow,
  TypeRow,
  UrlRow,
} from "./fields";
import { FormRow, FormRowPlain } from "./form-row";

const SSL_MODES = ["disable", "prefer", "require", "verify-ca", "verify-full"];

const ADVANCED_ROWS = [
  { key: "pool_max", label: "Max pool", placeholder: "12" },
  { key: "pool_min", label: "Min pool", placeholder: "1" },
  {
    key: "connect_timeout_secs",
    label: "Acquire timeout",
    placeholder: "30",
    hint: "Seconds to wait for a pooled connection.",
  },
  {
    key: "idle_timeout_secs",
    label: "Idle timeout",
    placeholder: "900",
    hint: "Seconds before an idle connection closes.",
  },
  {
    key: "max_lifetime_secs",
    label: "Max lifetime",
    placeholder: "1800",
    hint: "Seconds before a connection is recycled.",
  },
] as const;

export function PgForm({
  values: v,
  patch,
  tab,
  errors,
  onChangeKind,
}: {
  values: PgFormValues;
  patch: (p: Partial<PgFormValues>) => void;
  tab: FormTabKey;
  errors: (field: string) => string | undefined;
  onChangeKind: () => void;
}) {
  if (tab === "safety") {
    return <GuardFields idPrefix="pg" value={v} onChange={patch} />;
  }
  if (tab === "ssh") {
    return (
      <SshFields
        value={v}
        onChange={(key, value) => patch({ [key]: value })}
        errors={{
          ssh_user: errors("ssh_user"),
          ssh_key_file: errors("ssh_key_file"),
        }}
      />
    );
  }
  if (tab === "ssl") {
    const verifies = v.ssl_mode === "verify-ca" || v.ssl_mode === "verify-full";
    const tls = v.ssl_mode === "require" || verifies;
    return (
      <div className="flex flex-col gap-3">
        <FormRow label="SSL mode" htmlFor={fieldId("ssl_mode")}>
          <Select
            value={v.ssl_mode}
            onValueChange={(m) => patch({ ssl_mode: m ?? "prefer" })}
          >
            <SelectTrigger id={fieldId("ssl_mode")} className="w-40" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {SSL_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </FormRow>
        {!WEB && (
          <>
            <FormRow
              label="CA certificate"
              disabled={!verifies}
              hint="Used by verify-ca and verify-full. Only needed for a self signed or private CA server."
            >
              <FilePathInput
                disabled={!verifies}
                placeholder="/path/to/ca.pem"
                value={v.ssl_ca_file}
                onChange={(ssl_ca_file) => patch({ ssl_ca_file })}
              />
            </FormRow>
            <FormRow
              label="Client certificate"
              disabled={!tls}
              hint="Optional, for mTLS. Needs require or stricter."
            >
              <FilePathInput
                disabled={!tls}
                placeholder="/path/to/client-cert.pem"
                value={v.ssl_client_cert_file}
                onChange={(ssl_client_cert_file) =>
                  patch({ ssl_client_cert_file })
                }
              />
            </FormRow>
            <FormRow
              label="Client key"
              disabled={!tls}
              hint="Optional, for mTLS. Needs require or stricter."
            >
              <FilePathInput
                disabled={!tls}
                placeholder="/path/to/client-key.pem"
                value={v.ssl_client_key_file}
                onChange={(ssl_client_key_file) =>
                  patch({ ssl_client_key_file })
                }
              />
            </FormRow>
          </>
        )}
      </div>
    );
  }
  if (tab === "advanced") {
    return (
      <div className="flex flex-col gap-3">
        <NumberRows
          rows={ADVANCED_ROWS}
          values={v}
          onChange={(key, value) => patch({ [key]: value })}
          errors={errors}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <UrlRow
        placeholder="postgres://user:pass@host:5432/db"
        onImport={(raw) => {
          const r = parseConnectionUrl("postgres", raw);
          if (!r.ok) return r.message;
          patch(r.patch);
          return null;
        }}
      />
      <TextRow
        field="name"
        label="Name"
        placeholder="Connection name, auto generated if empty"
        value={v.name}
        onChange={(name) => patch({ name })}
      />
      <TypeRow kind="postgres" onChange={onChangeKind} />
      <HostPortRow
        host={v.host}
        port={v.port}
        onHost={(host) => patch({ host })}
        onPort={(port) => patch({ port })}
        hostPlaceholder="localhost"
        portError={errors("port")}
      />
      <TextRow
        field="user"
        label="User"
        value={v.user}
        onChange={(user) => patch({ user })}
      />
      <PasswordRow
        value={v.password}
        onChange={(password) => patch({ password })}
      />
      <FormRowPlain>
        <RememberSecret
          checked={v.remember_secret}
          onChange={(remember_secret) => patch({ remember_secret })}
        />
      </FormRowPlain>
      <TextRow
        field="database"
        label="Database"
        placeholder="Optional, defaults to postgres"
        value={v.database}
        onChange={(database) => patch({ database })}
      />
    </div>
  );
}
