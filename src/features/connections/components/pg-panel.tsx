import { Check, Cloud, Copy, Eraser, HardDrive, Link2, Save } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import type { LandingEditTarget } from "@/shared/store";
import { type FormTabKey } from "./form-tabs";
import { FilePathInput } from "./file-path-input";
import { SshFields } from "./ssh-fields";

export interface PgFormValues {
  name: string;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  ssl_mode: string;
  /** Path to a CA certificate file verifying the server's certificate. */
  ssl_ca_file: string;
  /** Path to a client certificate file, for mutual TLS (mTLS). */
  ssl_client_cert_file: string;
  /** Path to the client certificate's (unencrypted) private key file. */
  ssl_client_key_file: string;
  /** Max pool connections (blank = default 12). */
  pool_max: string;
  /** Min pool connections kept open (blank = default 1). */
  pool_min: string;
  /** How long to wait for a pooled connection before giving up, in seconds
   *  (blank = default 30). */
  connect_timeout_secs: string;
  /** How long a pooled connection can sit idle before being closed, in
   *  seconds (blank = default 900, i.e. 15 minutes). */
  idle_timeout_secs: string;
  /** Max lifetime of a pooled connection regardless of activity, in seconds
   *  (blank = default 1800, i.e. 30 minutes). */
  max_lifetime_secs: string;
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

export interface PgPanelProps {
  // Form fields
  form: PgFormValues;
  setField: (key: keyof PgFormValues, value: string) => void;
  // Which section tab (General/SSH/SSL) is active — owned by the parent so
  // the tab bar itself can render above the card, where the old
  // per-database-type tabs used to live.
  tab: FormTabKey;

  // URL import / export
  url_text: string;
  setUrlText: (v: string) => void;
  url_error: string | null;
  copied: boolean;
  onImport: () => void;
  onExport: () => void;

  // Test
  testing: boolean;
  test_ok: boolean | null;
  test_error: string | null;
  onTest: () => void;

  // Connect
  connecting: boolean;
  onConnect: () => void;

  // Save
  saving_to: string | null;
  admin_servers: { profile: { id: string; name: string } }[];
  editing: LandingEditTarget | null;
  onSaveLocal: () => void;
  onSaveServer: (profileId: string, serverName: string) => void;
  onUpdate: () => void;
  onCancelEdit: () => void;

  // Clear all fields back to defaults
  onClear: () => void;
}

export function PgPanel({
  form,
  setField,
  tab,
  url_text,
  setUrlText,
  url_error,
  copied,
  onImport,
  onExport,
  testing,
  test_ok,
  test_error,
  onTest,
  connecting,
  onConnect,
  saving_to,
  admin_servers,
  editing,
  onSaveLocal,
  onSaveServer,
  onUpdate,
  onCancelEdit,
  onClear,
}: PgPanelProps) {
  const disabled = connecting || testing || form.database.trim().length === 0;

  return (
    <>
      {/* URL bar */}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Link2 className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            className="pl-7 font-mono text-xs"
            placeholder="postgres://user:pass@host:5432/db"
            value={url_text}
            onChange={(e) => setUrlText(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          onClick={onImport}
          disabled={!url_text.trim()}
        >
          Import
        </Button>
        <Button
          variant="outline"
          onClick={onExport}
          title="Copy connection URL"
        >
          {copied ? (
            <>
              <Check className="text-success-dark size-4" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-4" />
              Export
            </>
          )}
        </Button>
      </div>
      {url_error && <p className="text-destructive text-xs">{url_error}</p>}

      {tab === "general" && (
        <div className="flex flex-col gap-3 pt-1">
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <Input
              placeholder="host"
              value={form.host}
              onChange={(e) => setField("host", e.target.value)}
            />
            <Input
              placeholder="port"
              inputMode="numeric"
              value={form.port}
              onChange={(e) => setField("port", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="user"
              value={form.user}
              onChange={(e) => setField("user", e.target.value)}
            />
            <Input
              type="password"
              placeholder="password"
              value={form.password}
              onChange={(e) => setField("password", e.target.value)}
            />
          </div>
          <Input
            placeholder="database"
            value={form.database}
            onChange={(e) => setField("database", e.target.value)}
          />
          <Input
            placeholder="connection name (optional)"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
          />
        </div>
      )}

      {tab === "ssh" && (
        <div className="pt-1">
          <SshFields
            value={form}
            onChange={(key, value) => setField(key, value)}
          />
        </div>
      )}

      {tab === "ssl" && (
        <div className="flex flex-col gap-3 pt-1">
          <div className="grid grid-cols-[1fr_auto] items-center gap-2">
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              SSL mode
              <Select
                value={form.ssl_mode}
                onValueChange={(v) => setField("ssl_mode", v ?? "prefer")}
              >
                <SelectTrigger className="w-36" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {[
                      "disable",
                      "prefer",
                      "require",
                      "verify-ca",
                      "verify-full",
                    ].map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
          </div>

          {/* Which cert fields are meaningful depends on the mode, not just
              whether SSL is on at all:
              - CA cert only does anything under verify-ca/verify-full — those
                are the only modes that actually check the server's
                certificate against it. Under require/prefer libpq accepts
                but silently ignores it, so showing it there is misleading.
              - Client cert+key (mTLS) need TLS to actually be negotiated,
                which "prefer" doesn't guarantee — shown for require and up.
              All three are genuinely optional even when shown: sqlx starts
              from the public CA trust store (the same one browsers use)
              and only layers a custom CA on top if you give it one, so a
              server with a normal publicly-signed certificate (Neon, RDS,
              Supabase, …) verifies fine with nothing filled in here. They
              only matter for a self-signed/private-CA server, or a server
              that specifically demands a client certificate. */}
          {(form.ssl_mode === "require" ||
            form.ssl_mode === "verify-ca" ||
            form.ssl_mode === "verify-full") && (
            <div className="grid gap-2">
              {(form.ssl_mode === "verify-ca" || form.ssl_mode === "verify-full") && (
                <div className="grid gap-1">
                  <Label className="text-muted-foreground text-[11px] font-normal">
                    CA certificate file (optional — only needed for a
                    self-signed or private-CA server)
                  </Label>
                  <FilePathInput
                    placeholder="/path/to/ca.pem"
                    value={form.ssl_ca_file}
                    onChange={(v) => setField("ssl_ca_file", v)}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label className="text-muted-foreground text-[11px] font-normal">
                    Client certificate (optional, for mTLS)
                  </Label>
                  <FilePathInput
                    placeholder="/path/to/client-cert.pem"
                    value={form.ssl_client_cert_file}
                    onChange={(v) => setField("ssl_client_cert_file", v)}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-muted-foreground text-[11px] font-normal">
                    Client private key (optional, for mTLS)
                  </Label>
                  <FilePathInput
                    placeholder="/path/to/client-key.pem"
                    value={form.ssl_client_key_file}
                    onChange={(v) => setField("ssl_client_key_file", v)}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "advanced" && (
        <div className="flex flex-col gap-3 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-[11px] font-normal">
                Max pool connections (default 12)
              </Label>
              <Input
                type="number"
                placeholder="12"
                value={form.pool_max}
                onChange={(e) => setField("pool_max", e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-[11px] font-normal">
                Min pool connections (default 1)
              </Label>
              <Input
                type="number"
                placeholder="1"
                value={form.pool_min}
                onChange={(e) => setField("pool_min", e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-[11px] font-normal">
                Connection acquire timeout, seconds (default 30)
              </Label>
              <Input
                type="number"
                placeholder="30"
                value={form.connect_timeout_secs}
                onChange={(e) => setField("connect_timeout_secs", e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-[11px] font-normal">
                Idle timeout, seconds (default 900 = 15 min)
              </Label>
              <Input
                type="number"
                placeholder="900"
                value={form.idle_timeout_secs}
                onChange={(e) => setField("idle_timeout_secs", e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label className="text-muted-foreground text-[11px] font-normal">
              Max connection lifetime, seconds (default 1800 = 30 min) —
              connections are recycled after this long regardless of activity
            </Label>
            <Input
              type="number"
              placeholder="1800"
              value={form.max_lifetime_secs}
              onChange={(e) => setField("max_lifetime_secs", e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        <Button
          variant="outline"
          onClick={onTest}
          disabled={testing || connecting || !form.database.trim()}
        >
          {testing ? "Testing…" : "Test connection"}
        </Button>
        <Button onClick={onConnect} disabled={disabled}>
          {connecting ? "Connecting…" : "Connect"}
        </Button>
        {editing ? (
          <>
            <Button
              variant="secondary"
              disabled={saving_to !== null || !form.database.trim()}
              onClick={onUpdate}
            >
              {saving_to ? "Updating…" : "Update"}
            </Button>
            <Button variant="outline" onClick={onCancelEdit}>
              Cancel
            </Button>
          </>
        ) : admin_servers.length === 0 ? (
          <Button
            variant="secondary"
            onClick={onSaveLocal}
            disabled={!form.database.trim()}
            title="Save to this device"
          >
            <Save className="size-4" /> Save
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="secondary"
                  disabled={!form.database.trim() || saving_to !== null}
                >
                  <Save className="size-4" />
                  {saving_to ? "Saving…" : "Save"}
                </Button>
              }
            />
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={onSaveLocal}>
                <HardDrive className="size-3.5" /> This device
              </DropdownMenuItem>
              {admin_servers.map((s) => (
                <DropdownMenuItem
                  key={s.profile.id}
                  onClick={() => onSaveServer(s.profile.id, s.profile.name)}
                >
                  <Cloud className="size-3.5" />
                  {s.profile.name}
                  <span className="text-muted-foreground ml-auto text-[10px]">
                    shared
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="ghost"
          onClick={onClear}
          title="Clear all fields"
          className="ml-auto"
        >
          <Eraser className="size-4" /> Clear
        </Button>
      </div>

      {/* Test result */}
      {test_ok === true && (
        <p className="text-success-dark text-xs">Connection successful.</p>
      )}
      {test_ok === false && (
        <p className="wrap-break-words text-destructive text-xs">
          {test_error}
        </p>
      )}
    </>
  );
}
