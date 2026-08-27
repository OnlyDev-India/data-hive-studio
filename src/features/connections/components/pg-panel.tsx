import { Check, Cloud, Copy, HardDrive, Link2, Save } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
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

export interface PgFormValues {
  name: string;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  ssl_mode: string;
}

export interface PgPanelProps {
  // Form fields
  form: PgFormValues;
  setField: (key: keyof PgFormValues, value: string) => void;

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
}

export function PgPanel({
  form,
  setField,
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

      {/* Connection fields */}
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

      {/* SSL mode */}
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

      {/* Action buttons */}
      <div className="flex gap-2">
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
