import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { WEB } from "@/shared/api/web";
import type { SshFormValue } from "../lib/form-values";
import { FilePathInput } from "./file-path-input";
import { FormRow, FormRowPlain } from "./connection-form/form-row";

const id = (key: string) => `conn-${key}`;

/** A blank `ssh_host` means no tunnel; `show` keeps the other fields when
 *  the box is unticked. */
export function SshFields({
  value,
  onChange,
  errors = {},
  disabled = false,
  note,
}: {
  value: SshFormValue;
  onChange: (key: keyof SshFormValue, v: string) => void;
  errors?: Partial<Record<keyof SshFormValue, string>>;
  /** The whole tunnel is unavailable, `note` says why. */
  disabled?: boolean;
  note?: React.ReactNode;
}) {
  const [show, setShow] = useState(() => value.ssh_host.trim().length > 0);
  const off = disabled || !show;
  const keyMode = !WEB && value.ssh_auth_mode === "key";

  return (
    <div className="flex flex-col gap-3">
      {note}
      <FormRowPlain>
        <div className="flex items-center gap-2">
          <Checkbox
            id={id("ssh_on")}
            checked={show && !disabled}
            disabled={disabled}
            onCheckedChange={(checked) => {
              setShow(checked);
              if (!checked) onChange("ssh_host", "");
            }}
          />
          <Label htmlFor={id("ssh_on")} className="text-sm font-normal">
            Use an SSH tunnel
          </Label>
        </div>
      </FormRowPlain>

      <>
        <FormRow label="SSH host" htmlFor={id("ssh_host")} disabled={off}>
          <div className="flex gap-2">
            <Input
              id={id("ssh_host")}
              disabled={off}
              className="min-w-0 flex-1"
              placeholder="bastion or jump host"
              value={value.ssh_host}
              onChange={(e) => onChange("ssh_host", e.target.value)}
            />
            <Input
              aria-label="SSH port"
              disabled={off}
              inputMode="numeric"
              placeholder="22"
              className="w-20"
              value={value.ssh_port}
              onChange={(e) => onChange("ssh_port", e.target.value)}
            />
          </div>
        </FormRow>
        <FormRow
          label="SSH user"
          htmlFor={id("ssh_user")}
          disabled={off}
          error={errors.ssh_user}
        >
          <Input
            id={id("ssh_user")}
            disabled={off}
            aria-invalid={!!errors.ssh_user}
            value={value.ssh_user}
            onChange={(e) => onChange("ssh_user", e.target.value)}
          />
        </FormRow>

        {!WEB && (
          <FormRow
            label="Authentication"
            htmlFor={id("ssh_auth_mode")}
            disabled={off}
          >
            <Select
              disabled={off}
              value={value.ssh_auth_mode || "password"}
              onValueChange={(v) => onChange("ssh_auth_mode", v ?? "password")}
            >
              <SelectTrigger
                id={id("ssh_auth_mode")}
                className="w-40"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">Password</SelectItem>
                <SelectItem value="key">Private key</SelectItem>
              </SelectContent>
            </Select>
          </FormRow>
        )}

        <FormRow
          label="SSH password"
          htmlFor={id("ssh_password")}
          disabled={off || keyMode}
        >
          <Input
            id={id("ssh_password")}
            type="password"
            disabled={off || keyMode}
            value={value.ssh_password}
            onChange={(e) => onChange("ssh_password", e.target.value)}
          />
        </FormRow>
        {!WEB && (
          <>
            <FormRow
              label="Private key"
              disabled={off || !keyMode}
              error={errors.ssh_key_file}
            >
              <FilePathInput
                disabled={off || !keyMode}
                placeholder="~/.ssh/id_ed25519"
                value={value.ssh_key_file}
                onChange={(v) => onChange("ssh_key_file", v)}
              />
            </FormRow>
            <FormRow
              label="Passphrase"
              htmlFor={id("ssh_key_passphrase")}
              disabled={off || !keyMode}
              hint="Only if the key is encrypted."
            >
              <Input
                id={id("ssh_key_passphrase")}
                type="password"
                disabled={off || !keyMode}
                value={value.ssh_key_passphrase}
                onChange={(e) => onChange("ssh_key_passphrase", e.target.value)}
              />
            </FormRow>
          </>
        )}

        {!WEB && (
          <FormRow
            label="Pinned host key"
            htmlFor={id("ssh_host_key_fingerprint")}
            disabled={off}
            hint="Optional. Leave blank to trust the server's key on each connect. Paste a fingerprint to reject a connection whose key doesn't match."
          >
            <div className="flex gap-1">
              <Input
                id={id("ssh_host_key_fingerprint")}
                disabled={off}
                className="min-w-0 flex-1 font-mono text-xs"
                placeholder="SHA256:..."
                value={value.ssh_host_key_fingerprint}
                onChange={(e) =>
                  onChange("ssh_host_key_fingerprint", e.target.value)
                }
              />
              {value.ssh_host_key_fingerprint && !off && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange("ssh_host_key_fingerprint", "")}
                >
                  Clear
                </Button>
              )}
            </div>
          </FormRow>
        )}
      </>
    </div>
  );
}
