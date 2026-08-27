import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  serversAdminDeleteToken,
  serversAdminGrants,
  serversAdminSetGrant,
  serversAdminRevokeGrant,
} from "@/shared/api/client";
import {
  Copy,
  Loader2,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import { useStudioStore } from "@/shared/store";
import type { TokenInfo } from "@/shared/api/types";
import type { ConnLite, GrantRow } from "./types";

// ---- Token save button (lives in the row, triggers GrantPanel save) ----

function TokenSaveButton({
  dirty,
  saving,
  onSaveRequest,
}: {
  dirty: boolean;
  saving: boolean;
  onSaveRequest: () => void;
}) {
  if (!dirty) return null;
  return (
    <Button
      size={"default"}
      variant="ghost"
      className="h-6 shrink-0"
      title="Save grant changes"
      disabled={saving}
      onClick={onSaveRequest}
    >
      {saving && <Loader2 className="size-3 animate-spin" />}
      <span className="text-[11px] font-medium">Save</span>
    </Button>
  );
}

// ---- Grant panel (per-token expanded) -------------------------------------------

function GrantPanel({
  profileId,
  token,
  conns,
  onDirtyChange,
  onSavingChange,
  saveRef,
}: {
  profileId: string;
  token: TokenInfo;
  conns: ConnLite[];
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
  saveRef: React.MutableRefObject<(() => void) | null>;
}) {
  const pushNotification = useStudioStore((s) => s.pushNotification);
  const [grants, setGrants] = useState<GrantRow[] | null>(null);
  const [draft, setDraft] = useState<
    Record<
      string,
      { can_read: boolean; can_update: boolean; can_delete: boolean }
    >
  >({});
  const [adding, setAdding] = useState(false);

  const connName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of conns) map.set(c.id, c.name);
    return (id: string) => map.get(id) ?? id;
  }, [conns]);

  const fetchGrants = useCallback(async () => {
    try {
      const g = await serversAdminGrants<GrantRow[]>(profileId, token.token);
      setGrants(g);
      const d: Record<
        string,
        { can_read: boolean; can_update: boolean; can_delete: boolean }
      > = {};
      for (const row of g) {
        d[row.conn_id] = {
          can_read: row.can_read,
          can_update: row.can_update,
          can_delete: row.can_delete,
        };
      }
      setDraft(d);
      onDirtyChange(false);
    } catch {
      setGrants([]);
      setDraft({});
    }
  }, [profileId, token.token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void fetchGrants();
  }, [fetchGrants]);

  function toggleDraft(
    connId: string,
    field: "can_read" | "can_update" | "can_delete",
  ) {
    setDraft((prev) => {
      const current = prev[connId] ?? {
        can_read: false,
        can_update: false,
        can_delete: false,
      };
      return { ...prev, [connId]: { ...current, [field]: !current[field] } };
    });
    onDirtyChange(true);
  }

  async function saveGrants() {
    onSavingChange(true);
    try {
      const promises = Object.entries(draft).map(([connId, p]) =>
        serversAdminSetGrant(
          profileId,
          token.token,
          connId,
          p.can_read,
          p.can_update,
          p.can_delete,
        ),
      );
      await Promise.all(promises);
      pushNotification({ kind: "success", title: "Grants saved" });
      onDirtyChange(false);
      await fetchGrants();
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Save failed",
        detail: String(e),
      });
    } finally {
      onSavingChange(false);
    }
  }

  // Expose saveGrants to parent via ref
  useEffect(() => {
    saveRef.current = saveGrants;
    return () => {
      saveRef.current = null;
    };
  });

  async function removeGrant(connId: string) {
    try {
      await serversAdminRevokeGrant(profileId, token.token, connId);
      pushNotification({ kind: "success", title: "Grant removed" });
      await fetchGrants();
    } catch (e) {
      pushNotification({ kind: "error", title: "Failed", detail: String(e) });
    }
  }

  if (grants === null) {
    return (
      <Loader2 className="text-muted-foreground mx-auto my-2 size-3 animate-spin" />
    );
  }

  const granted_ids = new Set(grants.map((g) => g.conn_id));

  return (
    <div className="px-3 pt-1 pb-2">
      {Object.keys(draft).length > 0 && (
        <ul className="mb-2 flex flex-col gap-1.5">
          {Object.entries(draft).map(([connId, perms]) => (
            <li key={connId} className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-medium">
                {connName(connId)}
              </span>
              <label
                className="flex cursor-pointer items-center gap-1"
                title="Can read"
              >
                <Checkbox
                  checked={perms.can_read}
                  onCheckedChange={() => toggleDraft(connId, "can_read")}
                />
                read
              </label>
              <label
                className="flex cursor-pointer items-center gap-1"
                title="Can update"
              >
                <Checkbox
                  checked={perms.can_update}
                  onCheckedChange={() => toggleDraft(connId, "can_update")}
                />
                update
              </label>
              <label
                className="flex cursor-pointer items-center gap-1"
                title="Can delete"
              >
                <Checkbox
                  checked={perms.can_delete}
                  onCheckedChange={() => toggleDraft(connId, "can_delete")}
                />
                delete
              </label>
              <Button
                size="icon"
                variant="ghost"
                className="size-5"
                title="Remove grant"
                onClick={() => void removeGrant(connId)}
              >
                <Trash2 className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {Object.keys(draft).length === 0 && !adding && (
        <p className="text-muted-foreground mb-2 text-xs">
          No grants — add one below.
        </p>
      )}
      <div className="flex items-center gap-2">
        {!adding ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1 size-3" /> Add connection
          </Button>
        ) : (
          <AddGrantForm
            profileId={profileId}
            token={token.token}
            conns={conns}
            granted_ids={granted_ids}
            on_done={() => {
              setAdding(false);
              void fetchGrants();
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---- Add grant form ---------------------------------------------------------

function AddGrantForm({
  profileId,
  token,
  conns,
  granted_ids,
  on_done,
}: {
  profileId: string;
  token: string;
  conns: ConnLite[];
  granted_ids: Set<string>;
  on_done: () => void;
}) {
  const pushNotification = useStudioStore((s) => s.pushNotification);
  const [connId, setConnId] = useState("");
  const [canRead, setCanRead] = useState(true);
  const [canUpdate, setCanUpdate] = useState(false);
  const [canDelete, setCanDelete] = useState(false);

  const available = conns.filter((c) => !granted_ids.has(c.id));

  async function save() {
    if (!connId) return;
    try {
      await serversAdminSetGrant(
        profileId,
        token,
        connId,
        canRead,
        canUpdate,
        canDelete,
      );
      pushNotification({ kind: "success", title: "Grant added" });
      on_done();
    } catch (e) {
      pushNotification({ kind: "error", title: "Failed", detail: String(e) });
    }
  }

  if (!available.length) {
    return (
      <p className="text-muted-foreground text-xs">
        All connections are already granted.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded border p-2">
      <select
        className="bg-background h-8 rounded border px-2 text-xs"
        value={connId}
        onChange={(e) => setConnId(e.target.value)}
      >
        <option value="">Select connection…</option>
        {available.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5">
          <Checkbox
            checked={canRead}
            onCheckedChange={() => setCanRead(!canRead)}
          />
          read
        </label>
        <label className="flex items-center gap-1.5">
          <Checkbox
            checked={canUpdate}
            onCheckedChange={() => setCanUpdate(!canUpdate)}
          />
          update
        </label>
        <label className="flex items-center gap-1.5">
          <Checkbox
            checked={canDelete}
            onCheckedChange={() => setCanDelete(!canDelete)}
          />
          delete
        </label>
      </div>
      <div className="flex gap-1">
        <Button size="sm" disabled={!connId} onClick={() => void save()}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={on_done}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---- Tokens list ------------------------------------------------------------

/** Collapsed row per token; click to expand and see grants. */
export function TokensList({
  tokens,
  filter,
  profileId,
  conns,
  onRefresh,
}: {
  tokens: TokenInfo[];
  filter: string;
  profileId: string;
  conns: ConnLite[];
  onRefresh: () => void;
}) {
  const pushNotification = useStudioStore((s) => s.pushNotification);
  const [expanded_id, setExpandedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [tokenDirty, setTokenDirty] = useState(false);
  const [tokenSaving, setTokenSaving] = useState(false);
  const tokenSaveRef = useRef<(() => void) | null>(null);

  const filtered = useMemo(() => {
    if (!filter) return tokens;
    return tokens.filter(
      (d) =>
        d.token.toLowerCase().includes(filter) ||
        d.user_name.toLowerCase().includes(filter) ||
        (d.team_name ?? "").toLowerCase().includes(filter),
    );
  }, [tokens, filter]);

  if (!filtered.length) {
    return (
      <p className="text-muted-foreground py-4 text-xs">
        {filter ? "No tokens match your search." : "No tokens yet."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {filtered.map((d) => {
        const kind =
          d.prefix === "adm_"
            ? "admin"
            : d.team_name
              ? `team · ${d.team_name}`
              : "token";
        const is_open = expanded_id === d.token;
        return (
          <div key={d.token} className="rounded-md border">
            <div className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => setExpandedId(is_open ? null : d.token)}
              >
                {is_open ? (
                  <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
                )}
                <Badge
                  variant={d.prefix === "adm_" ? "default" : "secondary"}
                  className="shrink-0"
                >
                  {kind}
                </Badge>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {d.user_name}
                </span>
                <span className="text-muted-foreground shrink-0 text-[11px]">
                  {new Date(d.created_ms).toLocaleDateString()}
                </span>
              </button>
              <Button
                size="icon"
                variant="ghost"
                className="size-6 shrink-0"
                title="Copy token to clipboard"
                onClick={() => {
                  void navigator.clipboard.writeText(d.token);
                  pushNotification({
                    kind: "success",
                    title: "Copied token",
                    detail: "Full token copied to clipboard",
                  });
                }}
              >
                <Copy className="size-3" />
              </Button>
              {is_open && d.prefix !== "adm_" && (
                <TokenSaveButton
                  dirty={tokenDirty}
                  saving={tokenSaving}
                  onSaveRequest={() => tokenSaveRef.current?.()}
                />
              )}
              {d.prefix !== "adm_" && (
                <Button
                  size={deleting === d.token ? "icon" : "default"}
                  variant={deleting === d.token ? "destructive" : "ghost"}
                  className={cn("h-6 w-auto shrink-0 px-2")}
                  title={
                    deleting === d.token
                      ? "Click again to confirm delete"
                      : "Delete token"
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    if (deleting !== d.token) {
                      setDeleting(d.token);
                      setTimeout(
                        () => setDeleting((r) => (r === d.token ? null : r)),
                        3000,
                      );
                      return;
                    }
                    void serversAdminDeleteToken(profileId, d.token)
                      .then(() => {
                        pushNotification({
                          kind: "success",
                          title: "Token deleted",
                        });
                        if (expanded_id === d.token) setExpandedId(null);
                        onRefresh();
                      })
                      .catch((e: unknown) => {
                        pushNotification({
                          kind: "error",
                          title: "Delete failed",
                          detail: String(e),
                        });
                      })
                      .finally(() => setDeleting(null));
                  }}
                >
                  <Trash2 className="size-3" />
                  {deleting === d.token && (
                    <span className="ml-0.5 text-[10px]">confirm</span>
                  )}
                </Button>
              )}
            </div>
            {is_open && d.prefix !== "adm_" && (
              <GrantPanel
                profileId={profileId}
                token={d}
                conns={conns}
                onDirtyChange={setTokenDirty}
                onSavingChange={setTokenSaving}
                saveRef={tokenSaveRef}
              />
            )}
            {is_open && d.prefix === "adm_" && (
              <div className="text-muted-foreground px-3 pb-2 text-xs">
                Unrestricted — full access to every connection.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
