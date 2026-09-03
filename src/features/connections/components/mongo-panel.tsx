import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Checkbox,
} from "@/shared/components/ui/checkbox";
import { Copy, Link2, Check, Save } from "lucide-react";

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
}

export interface MongoPanelProps {
  form: MongoFormValues;
  setField: (key: keyof MongoFormValues, value: string | boolean) => void;
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
  // Save (local device — Mongo connects have no team-server sharing)
  editing: boolean;
  onSaveLocal: () => void;
  onUpdate: () => void;
  onCancelEdit: () => void;
}

export function MongoPanel({
  form,
  setField,
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
  editing,
  onSaveLocal,
  onUpdate,
  onCancelEdit,
}: MongoPanelProps) {
  const disabled = connecting || testing || form.database.trim().length === 0;

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

      {/* SRV checkbox */}
      <div className="flex items-center gap-2">
        <Checkbox
          checked={form.srv}
          onCheckedChange={(checked) => setField("srv", checked)}
        />
        <label className="text-sm text-muted-foreground">Use mongodb+srv:// (DNS seedlist, no port)</label>
      </div>

      {/* TLS checkbox — mongodb+srv:// already gets TLS by default, so this
          only matters (and is only shown) for a plain mongodb:// connection. */}
      {!form.srv && (
        <div className="flex items-center gap-2">
          <Checkbox
            checked={form.tls}
            onCheckedChange={(checked) => setField("tls", checked)}
          />
          <label className="text-sm text-muted-foreground">Require TLS</label>
        </div>
      )}

      <Input
        placeholder="connection name (optional)"
        value={form.name}
        onChange={(e) => setField("name", e.target.value)}
      />

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
              disabled={!form.database.trim()}
              onClick={onUpdate}
            >
              Update
            </Button>
            <Button variant="outline" onClick={onCancelEdit}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            onClick={onSaveLocal}
            disabled={!form.database.trim()}
            title="Save to this device"
          >
            <Save className="size-4" /> Save
          </Button>
        )}
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
