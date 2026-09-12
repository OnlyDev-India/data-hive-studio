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
import { FilePathInput } from "./file-path-input";

export interface SshFormValue {
  ssh_host: string;
  ssh_port: string;
  ssh_user: string;
  /** "password" | "key". */
  ssh_auth_mode: string;
  ssh_password: string;
  ssh_key_file: string;
  ssh_key_passphrase: string;
  ssh_host_key_fingerprint: string;
}

/** The SSH tab's content — shared by the Postgres and MongoDB forms since
 *  the tunnel itself is identical either way (it just forwards a local
 *  port to whatever `host:port` the rest of the form already names). An
 *  empty `ssh_host` means "no tunnel" everywhere else in the app, so the
 *  enable checkbox is really just "is ssh_host non-empty", with a local
 *  `show` flag so unchecking (which clears it) doesn't also throw away
 *  the other fields the user already typed. */
export function SshFields({
  value,
  onChange,
}: {
  value: SshFormValue;
  onChange: (key: keyof SshFormValue, v: string) => void;
}) {
  const [show, setShow] = useState(() => value.ssh_host.trim().length > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={show}
          onCheckedChange={(checked) => {
            setShow(checked);
            if (!checked) onChange("ssh_host", "");
          }}
        />
        <label className="text-muted-foreground text-sm">
          Use an SSH tunnel
        </label>
      </div>

      {show && (
        <div className="flex flex-col gap-3 pl-1">
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Input
              placeholder="ssh host (bastion/jump host)"
              value={value.ssh_host}
              onChange={(e) => onChange("ssh_host", e.target.value)}
            />
            <Input
              placeholder="22"
              inputMode="numeric"
              value={value.ssh_port}
              onChange={(e) => onChange("ssh_port", e.target.value)}
            />
          </div>
          <Input
            placeholder="ssh user"
            value={value.ssh_user}
            onChange={(e) => onChange("ssh_user", e.target.value)}
          />

          <div className="grid gap-1">
            <Label className="text-muted-foreground text-2xs font-normal">
              Authentication
            </Label>
            <Select
              value={value.ssh_auth_mode || "password"}
              onValueChange={(v) => onChange("ssh_auth_mode", v ?? "password")}
            >
              <SelectTrigger className="w-40" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">Password</SelectItem>
                <SelectItem value="key">Private key</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {value.ssh_auth_mode === "key" ? (
            <>
              <div className="grid gap-1">
                <Label className="text-muted-foreground text-2xs font-normal">
                  Private key file
                </Label>
                <FilePathInput
                  placeholder="/home/me/.ssh/id_ed25519"
                  value={value.ssh_key_file}
                  onChange={(v) => onChange("ssh_key_file", v)}
                />
              </div>
              <Input
                type="password"
                placeholder="key passphrase (optional, if encrypted)"
                value={value.ssh_key_passphrase}
                onChange={(e) => onChange("ssh_key_passphrase", e.target.value)}
              />
            </>
          ) : (
            <Input
              type="password"
              placeholder="ssh password"
              value={value.ssh_password}
              onChange={(e) => onChange("ssh_password", e.target.value)}
            />
          )}

          <div className="grid gap-1">
            <Label className="text-muted-foreground text-2xs font-normal">
              Pinned host key (optional — leave blank to trust the server's key
              on each connect; paste a fingerprint here to reject a connection
              whose key doesn't match)
            </Label>
            <div className="flex gap-1">
              <Input
                className="min-w-0 flex-1 font-mono text-xs"
                placeholder="SHA256:..."
                value={value.ssh_host_key_fingerprint}
                onChange={(e) =>
                  onChange("ssh_host_key_fingerprint", e.target.value)
                }
              />
              {value.ssh_host_key_fingerprint && (
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
          </div>
        </div>
      )}
    </div>
  );
}
