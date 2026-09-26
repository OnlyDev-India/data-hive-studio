import { WEB } from "@/shared/api/web";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Label } from "@/shared/components/ui/label";
import type { MongoFormValues } from "../../lib/form-values";
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
  SrvTunnelNote,
  TextRow,
  TypeRow,
  UrlRow,
} from "./fields";
import { FormRow, FormRowPlain } from "./form-row";

const ADVANCED_ROWS = [
  { key: "pool_max", label: "Max pool", placeholder: "10" },
  { key: "pool_min", label: "Min pool", placeholder: "0" },
  {
    key: "connect_timeout_secs",
    label: "Connect timeout",
    placeholder: "10",
    hint: "Seconds.",
  },
  {
    key: "server_selection_timeout_secs",
    label: "Server selection",
    placeholder: "30",
    hint: "Seconds to keep looking for a usable server.",
  },
  {
    key: "idle_timeout_secs",
    label: "Idle timeout",
    placeholder: "never",
    hint: "Seconds before an idle connection closes.",
  },
] as const;

function CheckRow({
  id,
  checked,
  onChange,
  disabled,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(c) => onChange(c === true)}
      />
      <Label htmlFor={id} className="text-sm font-normal">
        {children}
      </Label>
    </div>
  );
}

export function MongoForm({
  values: v,
  patch,
  tab,
  errors,
  documentDb,
  onChangeKind,
}: {
  values: MongoFormValues;
  patch: (p: Partial<MongoFormValues>) => void;
  tab: FormTabKey;
  errors: (field: string) => string | undefined;
  documentDb: boolean;
  onChangeKind: () => void;
}) {
  const kind = documentDb ? "documentdb" : "mongodb";

  if (tab === "safety") {
    return <GuardFields idPrefix="mongo" value={v} onChange={patch} />;
  }
  if (tab === "ssh") {
    return (
      <SshFields
        disabled={v.srv}
        note={v.srv && <SrvTunnelNote error={errors("ssh_host")} />}
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
    const tls = v.srv || v.tls;
    return (
      <div className="flex flex-col gap-3">
        <FormRowPlain>
          <CheckRow
            id={fieldId("tls")}
            checked={tls}
            disabled={v.srv}
            onChange={(t) => patch({ tls: t })}
          >
            Require TLS{v.srv && " (implied by mongodb+srv://)"}
          </CheckRow>
        </FormRowPlain>
        {!WEB && (
          <FormRow
            label="CA certificate"
            disabled={!tls}
            hint={
              documentDb
                ? "AWS's global-bundle.pem."
                : "Only for a self signed or private CA server."
            }
          >
            <FilePathInput
              disabled={!tls}
              placeholder="/path/to/ca.pem"
              value={v.ssl_ca_file}
              onChange={(ssl_ca_file) => patch({ ssl_ca_file })}
            />
          </FormRow>
        )}
        {!WEB && (
          <FormRow
            label="Client certificate"
            disabled={!tls || documentDb}
            hint={
              documentDb
                ? "DocumentDB signs in with a password, not a client certificate."
                : "Optional, for mTLS. One PEM with the certificate and key."
            }
          >
            <FilePathInput
              disabled={!tls || documentDb}
              placeholder="/path/to/client.pem"
              value={v.ssl_client_cert_file}
              onChange={(ssl_client_cert_file) =>
                patch({ ssl_client_cert_file })
              }
            />
          </FormRow>
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
        <FormRowPlain>
          <CheckRow
            id={fieldId("retry_writes")}
            checked={v.retry_writes}
            onChange={(retry_writes) => patch({ retry_writes })}
          >
            Disable retryable writes
          </CheckRow>
        </FormRowPlain>
        {!documentDb && (
          <TextRow
            field="replica_set"
            label="Replica set"
            placeholder="rs0"
            hint="Leave blank for plain MongoDB."
            value={v.replica_set}
            onChange={(replica_set) => patch({ replica_set })}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <UrlRow
        placeholder={
          documentDb
            ? "mongodb://user:pass@host:27017/db"
            : "mongodb://user:pass@host:27017/db or mongodb+srv://…"
        }
        onImport={(raw) => {
          const r = parseConnectionUrl(kind, raw);
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
        hostPlaceholder={
          v.srv ? "cluster.example.net" : "host, or host1:port,host2:port"
        }
        hidePort={v.srv}
        portError={errors("port")}
        below={
          !documentDb && (
            <div className="pt-1">
              <CheckRow
                id={fieldId("srv")}
                checked={v.srv}
                onChange={(srv) => patch({ srv })}
              >
                Use mongodb+srv://
              </CheckRow>
            </div>
          )
        }
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
      {WEB && (
        <FormRowPlain>
          <RememberSecret
            checked={v.remember_secret}
            onChange={(remember_secret) => patch({ remember_secret })}
          />
        </FormRowPlain>
      )}
      <TextRow
        field="database"
        label="Database"
        value={v.database}
        error={errors("database")}
        onChange={(database) => patch({ database })}
      />
      <TextRow
        field="auth_db"
        label="Auth source"
        placeholder="admin"
        value={v.auth_db}
        onChange={(auth_db) => patch({ auth_db })}
      />
      {documentDb && (
        <TextRow
          field="replica_set"
          label="Replica set"
          placeholder="rs0"
          value={v.replica_set}
          onChange={(replica_set) => patch({ replica_set })}
        />
      )}
    </div>
  );
}
