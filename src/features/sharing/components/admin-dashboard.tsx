import { useCallback, useEffect, useMemo, useState } from "react";
import {
  serversOrgMembers,
  serversOrgInvitesList,
  serversOrgLinksList,
  serversOrgAudit,
} from "@/shared/api/client";
import { useStudioStore } from "@/shared/store";
import { RefreshCw, Search } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import type { AuditEntry } from "@/shared/api/server-admin";
import { canInvite, canManageAccounts } from "@/shared/api/server-access";
import { isNoOrgAccess } from "@/shared/api/server-admin";
import type { OrgEmailInvite, OrgLink, OrgMember, Tab } from "./types";
import { TABS } from "./types";
import { MembersPanel } from "./members-panel";
import { OrgLinksSection } from "./org-links-section";
import { OrgInvitesSection } from "./org-invites-section";
import { MyDevicesPanel } from "./my-devices-panel";
import { AccessInvitesSection } from "./access-invites-section";
import { AccessOrgsSection } from "./access-orgs-section";
import { AccessPeopleSection } from "./access-people-section";

export function AdminDashboard({
  profileId,
  orgId,
}: {
  profileId: string;
  orgId: string;
}) {
  const [tab, setTab] = useState<Tab>("members");
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invites, setInvites] = useState<OrgEmailInvite[]>([]);
  const [links, setLinks] = useState<OrgLink[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  // The server says this person is not in the org (removed, or left).
  const [no_access, setNoAccess] = useState(false);
  const [filter, setFilter] = useState("");
  const disconnectServer = useStudioStore((s) => s.disconnectServer);
  const serverName = useStudioStore(
    (s) => s.serverSessions[profileId]?.profile.name ?? "",
  );
  const me = useStudioStore((s) => s.serverSessions[profileId]?.me);
  // Server level invites and accounts sit under Invites and Members, for
  // server owners and admins; the server refuses anyone else.
  const show_server_invites = me !== undefined && canInvite(me);
  const show_server_people = me !== undefined && canManageAccounts(me);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [mems, invs, lnks, log] = await Promise.all([
        serversOrgMembers(profileId, orgId),
        serversOrgInvitesList(profileId, orgId),
        serversOrgLinksList(profileId, orgId),
        serversOrgAudit(profileId, orgId, 200),
      ]);
      setMembers(mems);
      setInvites(invs);
      setLinks(lnks);
      setAudit(log);
      setNoAccess(false);
    } catch (e) {
      if (isNoOrgAccess(e)) {
        setNoAccess(true);
        return;
      }
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

  /** This device's session on the server ended (its own row, or Sign out
   *  everywhere): every profile on that server shares it, so drop them all. */
  async function afterSignedOut() {
    const { serverSessions } = useStudioStore.getState();
    const url = serverSessions[profileId]?.profile.url;
    for (const [id, sess] of Object.entries(serverSessions)) {
      if (id === profileId || (url && sess.profile.url === url)) {
        await disconnectServer(id);
      }
    }
  }

  const filtered_members = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [members, filter]);

  if (no_access) {
    return (
      <div className="px-6 py-5">
        <p className="text-sm font-medium">
          You no longer have access to this organization
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          An owner or admin removed you, or you left. Ask one of them to invite
          you again, or pick another organization from the Team servers menu.
        </p>
      </div>
    );
  }

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
        {tab === "devices" ? (
          <MyDevicesPanel
            profileId={profileId}
            serverName={serverName}
            onSignedOut={() => void afterSignedOut()}
          />
        ) : loading ? (
          <p className="text-muted-foreground py-4 text-sm">Loading…</p>
        ) : tab === "members" ? (
          <div className="space-y-8">
            <section className="space-y-3">
              {show_server_invites && (
                <SectionHeading
                  title="Organization members"
                  hint="Who belongs to this organization and their role in it."
                />
              )}
              <MembersPanel
                members={filtered_members}
                profileId={profileId}
                orgId={orgId}
                onChanged={() => void refresh()}
              />
            </section>
            {show_server_invites && (
              <section className="space-y-3 border-t pt-6">
                <SectionHeading
                  title="Server accounts"
                  hint={`Everyone with an account on ${serverName} and their server role.`}
                />
                {show_server_people && me ? (
                  <AccessPeopleSection profileId={profileId} me={me} />
                ) : (
                  <p className="text-muted-foreground text-xs">
                    Managing people is off for your account. Ask a server owner
                    to turn on “Can manage roles” for you.
                  </p>
                )}
              </section>
            )}
            {me?.server_role === "owner" && (
              <section className="space-y-3 border-t pt-6">
                <SectionHeading
                  title="Organizations on this server"
                  hint="Who may create organizations, and every organization here."
                />
                <AccessOrgsSection profileId={profileId} />
              </section>
            )}
          </div>
        ) : tab === "invites" ? (
          <div className="space-y-8">
            <section className="space-y-3">
              <SectionHeading
                title="Invite by email"
                hint="Only the person with that email can join."
              />
              <OrgInvitesSection
                invites={invites}
                profileId={profileId}
                orgId={orgId}
                onChanged={() => void refresh()}
              />
            </section>
            <section className="space-y-3 border-t pt-6">
              <SectionHeading
                title="Shareable link"
                hint="A code that lets people who already have an account join."
              />
              <OrgLinksSection
                links={links}
                profileId={profileId}
                orgId={orgId}
                onChanged={() => void refresh()}
              />
            </section>
            {show_server_invites && (
              <section className="space-y-3 border-t pt-6">
                <SectionHeading
                  title="Server invites"
                  hint={`Who may sign in to ${serverName} by email.`}
                />
                <AccessInvitesSection profileId={profileId} />
              </section>
            )}
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

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}
