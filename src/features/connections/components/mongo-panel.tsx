import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Check,
  Cloud,
  Copy,
  Eraser,
  HardDrive,
  Link2,
  Save,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { type FormTabKey } from "./form-tabs";
import { FilePathInput } from "./file-path-input";
import { SshFields } from "./ssh-fields";

export interface MongoFormValues {
  name: string;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  /** Auth source database; "admin" when blank. */
  auth_db: string;
  /** Use mongodb+srv:// (DNS seedlist) instead of mongodb://. */
  srv: boolean;
  /** Require TLS on a plain mongodb:// connection (srv:// gets it by default). */
  tls: boolean;
  /** Path to a CA certificate file verifying the server's certificate. */
  ssl_ca_file: string;
  /** Path to a client cert+key PEM file for mutual TLS (mTLS) —
   *  MongoDB's `tlsCertificateKeyFile`, both combined in one file. */
  ssl_client_cert_file: string;
  /** Disable retryable writes (retryWrites=false) — required for Amazon DocumentDB. */
  retry_writes: boolean;
  /** Replica set name (replicaSet=...) — required by a real Amazon
   *  DocumentDB cluster, typically "rs0". */
  replica_set: string;
  /** Max connections per server in the pool (blank = driver default 10). */
  pool_max: string;
  /** Min connections per server kept open (blank = driver default 0). */
  pool_min: string;
  /** TCP connect timeout in seconds (blank = driver default 10). */
  connect_timeout_secs: string;
  /** How long a pooled connection can sit idle before being closed, in
   *  seconds (blank = driver default: never). */
  idle_timeout_secs: string;
  /** How long to keep trying to find a usable server before giving up on an
   *  operation, in seconds (blank = driver default 30). */
  server_selection_timeout_secs: string;
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

export interface MongoPanelProps {
  form: MongoFormValues;
  setField: (key: keyof MongoFormValues, value: string | boolean) => void;
  // Which section tab (General/SSH/SSL) is active — owned by the parent so
  // the tab bar itself can render above the card, where the old
  // per-database-type tabs used to live.
  tab: FormTabKey;
  testing: boolean;
  test_ok: boolean | null;
  test_error: string | null;
  onTest: () => void;
  connecting: boolean;
  onConnect: () => void;
  // URL import/export
  url_text: string;
  setUrlText: (v: string) => void;
  url_error: string | null;
  copied: boolean;
  onImport: () => void;
  onExport: () => void;
  // Save (local device, or a team server the caller is admin on)
  saving_to: string | null;
  admin_servers: { profile: { id: string; name: string } }[];
  editing: boolean;
  onSaveLocal: () => void;
  onSaveServer: (profileId: string, serverName: string) => void;
  onUpdate: () => void;
  onCancelEdit: () => void;

  // Clear all fields back to defaults
  onClear: () => void;

  // Amazon DocumentDB was picked in the database-type dropdown — hides
  // fields that don't apply to it (DNS seedlist, mTLS client cert) instead
  // of leaving them sitting there unused.
  is_document_db?: boolean;
}

export function MongoPanel({
  form,
  setField,
  tab,
  testing,
  test_ok,
  test_error,
  onTest,
  connecting,
  onConnect,
  url_text,
  setUrlText,
  url_error,
  copied,
  onImport,
  onExport,
  saving_to,
  admin_servers,
  editing,
  onSaveLocal,
  onSaveServer,
  onUpdate,
  onCancelEdit,
  onClear,
  is_document_db = false,
}: MongoPanelProps) {
  const disabled = connecting || testing || form.database.trim().length === 0;
  const tls_active = form.srv || form.tls;

  return (
    <>
      {/* URL bar */}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Link2 className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <Input
            className="pl-7 font-mono text-xs"
            placeholder="mongodb://user:pass@host:27017/db or mongodb+srv://..."
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
              placeholder={
                form.srv ? "host" : "host, or host1:port1,host2:port2,..."
              }
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
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="database"
              value={form.database}
              onChange={(e) => setField("database", e.target.value)}
            />
            <Input
              placeholder="auth source (admin)"
              value={form.auth_db}
              onChange={(e) => setField("auth_db", e.target.value)}
            />
          </div>

          {/* DocumentDB never supports DNS-seedlist discovery — not a
              choice a DocumentDB connection ever has, so don't show it. */}
          {!is_document_db && (
            <div className="flex items-center gap-2">
              <Checkbox
                checked={form.srv}
                onCheckedChange={(checked) => setField("srv", checked)}
              />
              <label className="text-muted-foreground text-sm">
                Use mongodb+srv:// (DNS seedlist, no port)
              </label>
            </div>
          )}

          <Input
            placeholder="connection name (optional)"
            value={form.name}
            onChange={(e) => setField("name", e.target.value)}
          />
        </div>
      )}

      {tab === "ssh" &&
        (form.srv ? (
          <p className="text-muted-foreground py-6 text-center text-xs">
            An SSH tunnel can't be combined with mongodb+srv:// — turn off "DNS
            seedlist" in the General tab and list the replica set members
            directly in the Host field instead.
          </p>
        ) : (
          <div className="pt-1">
            <SshFields
              value={form}
              onChange={(key, value) => setField(key, value)}
            />
          </div>
        ))}

      {tab === "ssl" && (
        <div className="flex flex-col gap-3 pt-1">
          {/* Always visible — mongodb+srv:// already implies TLS, so the
              checkbox is checked and locked in that case, but still shown,
              so it's clear WHY the cert fields below appear instead of
              them just materializing with no explanation. */}
          <div className="flex items-center gap-2">
            <Checkbox
              checked={tls_active}
              disabled={form.srv}
              onCheckedChange={(checked) => setField("tls", checked)}
            />
            <label className="text-muted-foreground text-sm">
              Require TLS
              {form.srv && " (implied by mongodb+srv://)"}
            </label>
          </div>

          {tls_active && (
            <div className="grid gap-2">
              {/* CA cert is optional either way: the driver verifies
                  against the public CA trust store by default, so a
                  normally-signed server (Atlas, etc.) needs it only for a
                  self-signed/private-CA server — for DocumentDB, that's
                  AWS's own global-bundle.pem, which isn't in that trust
                  store. Client certificate + key (mTLS) is hidden for
                  DocumentDB: it authenticates over username/password
                  (SCRAM) only, not client certificates. */}
              <div className="grid gap-1">
                <Label className="text-muted-foreground text-2xs font-normal">
                  {is_document_db
                    ? "CA certificate file — AWS's global-bundle.pem"
                    : "CA certificate file (optional — only needed for a self-signed or private-CA server)"}
                </Label>
                <FilePathInput
                  placeholder="/path/to/ca.pem"
                  value={form.ssl_ca_file}
                  onChange={(v) => setField("ssl_ca_file", v)}
                />
              </div>
              {!is_document_db && (
                <div className="grid gap-1">
                  <Label className="text-muted-foreground text-2xs font-normal">
                    Client certificate + key (optional, for mTLS — one combined
                    PEM file)
                  </Label>
                  <FilePathInput
                    placeholder="/path/to/client.pem"
                    value={form.ssl_client_cert_file}
                    onChange={(v) => setField("ssl_client_cert_file", v)}
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 border-t pt-3">
            {!is_document_db && (
              <p className="text-muted-foreground text-2xs">
                For Amazon DocumentDB: TLS above with a downloaded{" "}
                <code className="text-3xs">global-bundle.pem</code> as
                the CA certificate, plus both fields below.
              </p>
            )}
            <div className="flex items-center gap-2">
              <Checkbox
                checked={form.retry_writes}
                onCheckedChange={(checked) => setField("retry_writes", checked)}
              />
              <label className="text-muted-foreground text-sm">
                Disable retryable writes
              </label>
            </div>
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-2xs font-normal">
                Replica set name (e.g. rs0)
                {!is_document_db &&
                  " — leave blank for plain MongoDB or the local DocumentDB emulator"}
              </Label>
              <Input
                placeholder="rs0"
                value={form.replica_set}
                onChange={(e) => setField("replica_set", e.target.value)}
              />
            </div>
          </div>
        </div>
      )}

      {tab === "advanced" && (
        <div className="flex flex-col gap-3 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-2xs font-normal">
                Max pool connections (default 10)
              </Label>
              <Input
                type="number"
                placeholder="10"
                value={form.pool_max}
                onChange={(e) => setField("pool_max", e.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-2xs font-normal">
                Min pool connections (default 0)
              </Label>
              <Input
                type="number"
                placeholder="0"
                value={form.pool_min}
                onChange={(e) => setField("pool_min", e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-2xs font-normal">
                Connect timeout, seconds (default 10)
              </Label>
              <Input
                type="number"
                placeholder="10"
                value={form.connect_timeout_secs}
                onChange={(e) =>
                  setField("connect_timeout_secs", e.target.value)
                }
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-muted-foreground text-2xs font-normal">
                Server selection timeout, seconds (default 30)
              </Label>
              <Input
                type="number"
                placeholder="30"
                value={form.server_selection_timeout_secs}
                onChange={(e) =>
                  setField("server_selection_timeout_secs", e.target.value)
                }
              />
            </div>
          </div>
          <div className="grid gap-1">
            <Label className="text-muted-foreground text-2xs font-normal">
              Idle timeout, seconds (default: never) — a pooled connection open
              this long with nothing happening gets closed
            </Label>
            <Input
              type="number"
              placeholder="never"
              value={form.idle_timeout_secs}
              onChange={(e) => setField("idle_timeout_secs", e.target.value)}
            />
          </div>
        </div>
      )}

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
                  <span className="text-muted-foreground ml-auto text-3xs">
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
