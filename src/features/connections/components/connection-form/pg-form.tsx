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

/** What differs between the SQL server forms: Postgres, and MySQL with
 *  MariaDB (spec 0025), which share every field but these. */
const ENGINES = {
  postgres: {
    sslModes: ["disable", "prefer", "require", "verify-ca", "verify-full"],
    defaultSsl: "prefer",
    verifyModes: ["verify-ca", "verify-full"],
    tlsModes: ["require", "verify-ca", "verify-full"],
    url: "postgres://user:pass@host:5432/db",
    database: "Optional, defaults to postgres",
    caHint:
      "Used by verify-ca and verify-full. Only needed for a self signed or private CA server.",
    certHint: "Optional, for mTLS. Needs require or stricter.",
  },
  mysql: {
    sslModes: [
      "DISABLED",
      "PREFERRED",
      "REQUIRED",
      "VERIFY_CA",
      "VERIFY_IDENTITY",
    ],
    defaultSsl: "PREFERRED",
    verifyModes: ["VERIFY_CA", "VERIFY_IDENTITY"],
    tlsModes: ["REQUIRED", "VERIFY_CA", "VERIFY_IDENTITY"],
    url: "mysql://user:pass@host:3306/db",
    database: "Optional, leave empty to browse every database",
    caHint:
      "Used by VERIFY_CA and VERIFY_IDENTITY. Only needed for a self signed or private CA server.",
    certHint: "Optional, for mTLS. Needs REQUIRED or stricter.",
  },
};

export type SqlServerKind = "postgres" | "mysql" | "mariadb";

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
  kind = "postgres",
  values: v,
  patch,
  tab,
  errors,
  onChangeKind,
}: {
  kind?: SqlServerKind;
  values: PgFormValues;
  patch: (p: Partial<PgFormValues>) => void;
  tab: FormTabKey;
  errors: (field: string) => string | undefined;
  onChangeKind: () => void;
}) {
  const engine = ENGINES[kind === "postgres" ? "postgres" : "mysql"];
  if (tab === "safety") {
    return (
      <GuardFields
        idPrefix={kind === "postgres" ? "pg" : "mysql"}
        value={v}
        onChange={patch}
      />
    );
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
    const verifies = engine.verifyModes.includes(v.ssl_mode);
    const tls = engine.tlsModes.includes(v.ssl_mode);
    return (
      <div className="flex flex-col gap-3">
        <FormRow label="SSL mode" htmlFor={fieldId("ssl_mode")}>
          <Select
            value={v.ssl_mode}
            onValueChange={(m) => patch({ ssl_mode: m ?? engine.defaultSsl })}
          >
            <SelectTrigger id={fieldId("ssl_mode")} className="w-44" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {engine.sslModes.map((m) => (
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
              hint={engine.caHint}
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
              hint={engine.certHint}
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
            <FormRow label="Client key" disabled={!tls} hint={engine.certHint}>
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
        placeholder={engine.url}
        onImport={(raw) => {
          const r =
            kind === "postgres"
              ? parseConnectionUrl("postgres", raw)
              : parseConnectionUrl(kind, raw);
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
      <TypeRow kind={kind} onChange={onChangeKind} />
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
        placeholder={engine.database}
        value={v.database}
        onChange={(database) => patch({ database })}
      />
    </div>
  );
}
