import { useState } from "react";
import { Lock, LogOut, Trash2 } from "lucide-react";
import {
  serversOrgRemoveMember,
  serversOrgSetMemberRole,
} from "@/shared/api/client";
import { accessErrorMessage } from "@/shared/api/server-access";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui";
import { useStudioStore } from "@/shared/store";
import { assignableOrgRoles, canRemoveMember } from "../org-rules";
import type { OrgMember, OrgRole } from "./types";

const LAST_OWNER_HINT =
  "The last owner can't be demoted or removed. Make someone else an owner first.";

export function MembersPanel({
  members,
  profileId,
  orgId,
  onChanged,
}: {
  members: OrgMember[];
  profileId: string;
  orgId: string;
  onChanged: () => void;
}) {
  const pushNotification = useStudioStore((s) => s.pushNotification);
  const disconnectServer = useStudioStore((s) => s.disconnectServer);
  const me = useStudioStore((s) => s.serverSessions[profileId]?.me);
  const org = me?.orgs.find((o) => o.id === orgId);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The list can be filtered by search, so the last owner guard has to count
  // owners from every member the server sent, not just the visible rows.
  const owner_count = members.filter((m) => m.role === "owner").length;

  async function setRole(userId: string, role: OrgRole) {
    setBusy(userId);
    try {
      await serversOrgSetMemberRole(profileId, orgId, userId, role);
      onChanged();
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Couldn't change role",
        detail: accessErrorMessage(e),
      });
      // The server is the truth: show what it has, not what was picked.
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function remove(userId: string, leaving: boolean) {
    if (removing !== userId) {
      setRemoving(userId);
      setTimeout(() => setRemoving((r) => (r === userId ? null : r)), 3000);
      return;
    }
    setBusy(userId);
    try {
      await serversOrgRemoveMember(profileId, orgId, userId);
      if (leaving) {
        pushNotification({
          kind: "success",
          title: `You left ${org?.name ?? "the organization"}`,
        });
        // Nothing here is theirs any more: drop this org's connection.
        await disconnectServer(profileId);
      } else {
        pushNotification({ kind: "success", title: "Member removed" });
        onChanged();
      }
    } catch (e) {
      pushNotification({
        kind: "error",
        title: leaving ? "Couldn't leave" : "Couldn't remove member",
        detail: accessErrorMessage(e),
      });
      onChanged();
    } finally {
      setBusy(null);
      setRemoving(null);
    }
  }

  if (!members.length) {
    return (
      <p className="text-muted-foreground py-4 text-xs">
        No members match your search.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {members.map((m) => {
        const is_self = m.user_id === me?.user_id;
        const locked = m.role === "owner" && owner_count <= 1;
        const roles = locked ? [] : assignableOrgRoles(org?.role, m.role);
        const can_remove =
          !locked && canRemoveMember(org?.role, m.role, is_self);
        const confirming = removing === m.user_id;
        return (
          <div
            key={m.user_id}
            className="flex items-center gap-3 rounded-md border px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {m.name}
                {is_self && (
                  <span className="text-muted-foreground text-2xs ml-1.5 font-normal">
                    (you)
                  </span>
                )}
              </div>
              <div className="text-muted-foreground text-2xs truncate">
                {m.email}
              </div>
            </div>
            {roles.length > 0 ? (
              <Select
                value={m.role}
                onValueChange={(v) => void setRole(m.user_id, v as OrgRole)}
              >
                <SelectTrigger
                  className="h-7 w-28 text-xs"
                  aria-label={`Role of ${m.email}`}
                  disabled={busy === m.user_id}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge
                variant="secondary"
                className="shrink-0"
                title={locked ? LAST_OWNER_HINT : undefined}
              >
                {locked && <Lock className="mr-1 size-3" />}
                {m.role}
              </Badge>
            )}
            {can_remove ? (
              <Button
                size={confirming ? "icon" : "default"}
                variant={confirming ? "destructive" : "ghost"}
                className="h-7 w-auto shrink-0 px-2"
                disabled={busy === m.user_id}
                aria-label={
                  is_self ? "Leave organization" : `Remove ${m.email}`
                }
                title={
                  confirming
                    ? "Click again to confirm"
                    : is_self
                      ? "Leave organization"
                      : "Remove from organization"
                }
                onClick={() => void remove(m.user_id, is_self)}
              >
                {is_self ? (
                  <LogOut className="size-3.5" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
                {confirming && <span className="text-3xs ml-0.5">confirm</span>}
              </Button>
            ) : (
              // Keeps the columns lined up when a row has no action.
              <span className="w-8 shrink-0" aria-hidden />
            )}
          </div>
        );
      })}
    </div>
  );
}
