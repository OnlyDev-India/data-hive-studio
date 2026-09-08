import { useCallback, useEffect, useMemo, useState } from "react";
import {
  serversOrgMembers,
  serversOrgInvitesList,
  serversOrgAudit,
} from "@/shared/api/client";
import { useStudioStore } from "@/shared/store";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import type { AuditEntry } from "@/shared/api/server-admin";
import type { OrgInvite, OrgMember, Tab } from "./types";
import { TABS } from "./types";
import { MembersPanel } from "./members-panel";
import { InvitesPanel } from "./invites-panel";
import { CreateInviteForm } from "./create-invite-panel";

export function AdminDashboard({
  profileId,
  orgId,
}: {
  profileId: string;
  orgId: string;
}) {
  const [tab, setTab] = useState<Tab>("members");
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [mems, invs, log] = await Promise.all([
        serversOrgMembers(profileId, orgId),
        serversOrgInvitesList(profileId, orgId),
        serversOrgAudit(profileId, orgId, 200),
      ]);
      setMembers(mems);
      setInvites(invs);
      setAudit(log);
    } catch (e) {
      useStudioStore.getState().pushNotification({
        kind: "error",
        title: "Failed to load admin data",
        detail: String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [profileId, orgId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void refresh();
  }, [refresh]);

  const filtered_members = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [members, filter]);

  return (
    <div className="flex flex-col gap-4">
      {/* Tab bar — same visual language as the editor tab strip */}
      <div
        className="bg-background flex w-full shrink-0 items-center gap-1 overflow-x-auto border-b pl-1.5"
        role="tablist"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "shrink-0 cursor-pointer rounded-t-md border-b-2 px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors select-none",
              tab === t.key
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-6 px-6 py-5">
        {/* Toolbar (search + reload) — visible on list tabs only */}
        {(tab === "members" || tab === "invites") && (
          <div className="flex items-center gap-2">
            {tab === "members" && (
              <div className="relative min-w-0 flex-1">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                <Input
                  className="h-8 pl-8 text-xs"
                  placeholder="Search members by name or email…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
            )}
            {tab === "invites" && <div className="flex-1" />}
            <Button
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => void refresh()}
            >
              <RefreshCw
                className={cn("size-3.5", loading && "animate-spin")}
              />
              Reload
            </Button>
          </div>
        )}
        {loading ? (
          <p className="text-muted-foreground py-4 text-sm">Loading…</p>
        ) : tab === "members" ? (
          <MembersPanel
            members={filtered_members}
            profileId={profileId}
            orgId={orgId}
            onChanged={() => void refresh()}
          />
        ) : tab === "invites" ? (
          <div className="space-y-6">
            <CreateInviteForm
              profileId={profileId}
              orgId={orgId}
              on_created={() => void refresh()}
            />
            <InvitesPanel
              invites={invites}
              profileId={profileId}
              orgId={orgId}
              onRefresh={() => void refresh()}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {audit.length === 0 && (
              <p className="text-muted-foreground py-4 text-xs">
                No activity recorded yet.
              </p>
            )}
            {audit.map((a, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs"
              >
                <span className="text-muted-foreground w-36 shrink-0">
                  {new Date(a.ts_ms).toLocaleString()}
                </span>
                <span className="font-medium">{a.action}</span>
                <span className="text-muted-foreground truncate">
                  {a.target}
                </span>
                {a.detail && (
                  <span className="text-muted-foreground truncate">
                    — {a.detail}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
