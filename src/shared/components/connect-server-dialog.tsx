import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/lib/utils";
import { WEB } from "@/shared/api/web";
import { useStudioStore } from "@/shared/store";

export interface ConnectResult {
  token: string;
  team_name?: string;
  /** Only set on desktop — the server URL entered by the user. */
  server_url?: string;
  /** Only set on desktop — the display name entered by the user. */
  server_name?: string;
}

interface ConnectServerFormProps {
  on_connect: (result: ConnectResult) => void;
  initial_token?: string;
  initial_team?: string;
  initial_user?: string;
  /** Show Name + Server URL fields (desktop only). */
  show_server_fields?: boolean;
  initial_name?: string;
  initial_url?: string;
  /** External error message (e.g. from parent after connect fails). */
  error?: string | null;
}

/**
 * Shared credential form used by WebGate AND the desktop Servers page.
 *
 * Two tabs (Admin / Team):
 *   Admin → [user name] [token (adm_…)]
 *   Team  → [user name] [token (tem_…)] [team name]
 *
 * Desktop mode also shows:
 *   [Name] [Server URL]
 *
 * Calls GET /v1/me to verify the token, then fires on_connect.
 */
export function ConnectServerForm({
  on_connect,
  initial_token = "",
  initial_team = "",
  show_server_fields = false,
  initial_name = "",
  initial_url = "",
  error: externalError,
}: ConnectServerFormProps) {
  const [tab, setTab] = useState<"admin" | "team">(
    initial_token.startsWith("tem_") ? "team" : "admin",
  );
  const [token, setToken] = useState(initial_token);
  const [team, setTeam] = useState(initial_team);
  const [name, setName] = useState(initial_name);
  const [url, setUrl] = useState(initial_url);
  const [busy, setBusy] = useState(false);

  // Surface externally-passed errors (e.g. from a parent connect attempt) as
  // notifications instead of inline text.
  useEffect(() => {
    if (externalError) {
      useStudioStore.getState().pushNotification({
        kind: "error",
        title: "Server connection failed",
        detail: externalError,
      });
    }
  }, [externalError]);

  async function verify() {
    if (busy || !token.trim()) return;
    setBusy(true);
    try {
      // Verify the token against the server.
      const base =
        show_server_fields && url.trim() ? url.trim().replace(/\/+$/, "") : "";
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token.trim()}`,
      };
      if (tab === "team" && team.trim()) {
        headers["X-Team"] = team.trim();
      }
      const res = await fetch(`${base}/v1/me`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      on_connect({
        server_name: name.trim() || undefined,
        token: token.trim(),
        team_name: tab === "team" ? team.trim() || undefined : undefined,
        ...(show_server_fields ? { server_url: url.trim() } : {}),
      });
    } catch (e) {
      const msg = String(e);
      useStudioStore.getState().pushNotification({
        kind: "error",
        title: "Server connection failed",
        detail: msg,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Tab toggle */}
      <div className="flex items-center gap-1 border-b pb-2">
        {(["admin", "team"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab(t)}
          >
            {t === "admin" ? "Admin" : "Team"}
          </button>
        ))}
      </div>

      <form
        className="grid gap-3 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          void verify();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="cs-name">Name</Label>
          <Input
            id="cs-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme team"
          />
        </div>
        {show_server_fields && (
          <>
            {!WEB && (
              <div className="grid gap-1.5">
                <Label htmlFor="cs-url">Server URL</Label>
                <Input
                  id="cs-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://db.acme.com:8080"
                />
              </div>
            )}
          </>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="cs-token">Token</Label>
          <Input
            id="cs-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={tab === "admin" ? "adm_…" : "tem_…"}
          />
        </div>

{tab === "team" && (
          <div className="grid gap-1.5">
            <Label htmlFor="cs-team">Team name</Label>
            <Input
              id="cs-team"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder='e.g. "acme"'
            />
          </div>
        )}

        <Button
          type="submit"
          disabled={
            busy || !token.trim() || (show_server_fields && !WEB && !url.trim())
          }
        >
          {busy ? (
            <>
              <Loader2 className="mr-1 size-4 animate-spin" /> Verifying…
            </>
          ) : (
            "Connect"
          )}
        </Button>
      </form>
    </div>
  );
}
