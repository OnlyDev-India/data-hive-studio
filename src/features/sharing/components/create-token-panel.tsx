import { useMemo, useState } from "react";
import { serversAdminMintToken } from "@/shared/api/client";
import { Check, Copy, Plus } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { useStudioStore, type StudioStore } from "@/shared/store";
import type { ConnLite } from "./types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui";

// ---- Shared ----------------------------------------------------------------

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label="Copy code"
      onClick={() => {
        void navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? (
        <Check className="size-3.5 text-emerald-600" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </Button>
  );
}

// ---- Connection picker -----------------------------------------------------

/** Connection picker: searchable, shows first 5 by default. */
function ConnectionPicker({
  conns,
  value,
  onChange,
}: {
  conns: ConnLite[];
  value: Record<
    string,
    { can_read: boolean; can_update: boolean; can_delete: boolean }
  >;
  onChange: (
    next: Record<
      string,
      { can_read: boolean; can_update: boolean; can_delete: boolean }
    >,
  ) => void;
}) {
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conns.slice(0, 5);
    return conns.filter((c) => c.name.toLowerCase().includes(q));
  }, [conns, search]);

  function toggle(connId: string) {
    if (value[connId]) {
      const next = { ...value };
      delete next[connId];
      onChange(next);
    } else {
      onChange({
        ...value,
        [connId]: { can_read: true, can_update: false, can_delete: false },
      });
    }
  }

  function toggleField(
    connId: string,
    field: "can_read" | "can_update" | "can_delete",
  ) {
    const current = value[connId];
    if (!current) return;
    const next = {
      ...value,
      [connId]: { ...current, [field]: !current[field] },
    };
    // if all permissions removed, remove the connection entirely
    if (
      !next[connId].can_read &&
      !next[connId].can_update &&
      !next[connId].can_delete
    ) {
      delete next[connId];
    }
    onChange(next);
  }

  if (!conns.length) {
    return (
      <p className="text-muted-foreground text-xs">
        No shared connections exist yet — create one first.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search your connections…"
        className="mb-1 h-7 text-xs"
      />
      {visible.map((c) => {
        const selected = !!value[c.id];
        const perms = value[c.id];
        return (
          <div key={c.id} className="hover:bg-muted/50 rounded px-1 py-0.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={selected}
                onCheckedChange={() => toggle(c.id)}
              />
              <span className="truncate">{c.name}</span>
            </label>
            {selected && perms && (
              <div className="mt-0.5 ml-6 flex items-center gap-2 text-[11px]">
                <label className="flex cursor-pointer items-center gap-1">
                  <Checkbox
                    checked={perms.can_read}
                    onCheckedChange={() => toggleField(c.id, "can_read")}
                  />
                  read
                </label>
                <label className="flex cursor-pointer items-center gap-1">
                  <Checkbox
                    checked={perms.can_update}
                    onCheckedChange={() => toggleField(c.id, "can_update")}
                  />
                  update
                </label>
                <label className="flex cursor-pointer items-center gap-1">
                  <Checkbox
                    checked={perms.can_delete}
                    onCheckedChange={() => toggleField(c.id, "can_delete")}
                  />
                  delete
                </label>
              </div>
            )}
          </div>
        );
      })}
      {conns.length > 5 && !search && (
        <p className="text-muted-foreground text-[11px]">
          Showing 5 of {conns.length} — type in the search box to find more.
        </p>
      )}
    </div>
  );
}

// ---- Create token form -----------------------------------------------------

/** Form to create a new adm_ or tem_ token. */
export function CreateTokenForm({
  profileId,
  conns,
  on_created,
}: {
  profileId: string;
  conns: ConnLite[];
  on_created: () => void;
}) {
  const pushNotification = useStudioStore(
    (s: StudioStore) => s.pushNotification,
  );
  const [scope, setScope] = useState<"admin" | "team">("team");
  const [team_name, setTeamName] = useState("");
  const [grants, setGrants] = useState<
    Record<
      string,
      { can_read: boolean; can_update: boolean; can_delete: boolean }
    >
  >({});
  const [busy, setBusy] = useState(false);
  const [created_token, setCreatedToken] = useState<string | null>(null);

  async function mint() {
    if (busy) return;
    setBusy(true);
    try {
      const grant_specs =
        scope === "team"
          ? Object.entries(grants)
              .filter(([, v]) => v.can_read || v.can_update || v.can_delete)
              .map(([conn_id, v]) => ({
                conn_id,
                can_read: v.can_read,
                can_update: v.can_update,
                can_delete: v.can_delete,
              }))
          : [];
      const out = await serversAdminMintToken(profileId, {
        kind: scope,
        user_name: "",
        team_name: scope === "team" ? team_name.trim() || undefined : undefined,
        grants: grant_specs,
      });
      setCreatedToken(out.token);
      pushNotification({
        kind: "success",
        title: "Token created",
        detail: out.token,
      });
      on_created();
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Failed to create token",
        detail: String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="ct-scope">Scope</Label>
        <Select
          id="ct-scope"
          // className="h-9 max-w-60 rounded-md border bg-background px-2"
          value={scope}
          onValueChange={(e) => setScope(e as "admin" | "team")}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={"team"}>Team token (scoped)</SelectItem>
            <SelectItem value="admin">Admin token (unrestricted)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {scope === "team" && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="ct-team">Team name</Label>
            <Input
              id="ct-team"
              value={team_name}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder='e.g. "acme"'
            />
          </div>
          <div className="rounded-md border p-3">
            <Label className="mb-2 block">
              Connection access{" "}
              <span className="text-muted-foreground font-normal">
                (
                {
                  Object.values(grants).filter(
                    (v) => v.can_read || v.can_update || v.can_delete,
                  ).length
                }{" "}
                selected)
              </span>
            </Label>
            <ConnectionPicker
              conns={conns}
              value={grants}
              onChange={setGrants}
            />
          </div>
        </>
      )}

      <Button disabled={busy} onClick={() => void mint()}>
        <Plus className="size-4" /> {busy ? "Creating…" : "Create token"}
      </Button>

      {created_token && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3">
          <p className="mb-1 text-[11px] font-medium tracking-wide text-emerald-600 uppercase dark:text-emerald-400">
            Token — copy it now, it is shown only once
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 font-mono text-xs break-all">
              {created_token}
            </code>
            <CopyCode code={created_token} />
          </div>
        </div>
      )}
    </div>
  );
}
