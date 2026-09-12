import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
  serversOrgRemoveMember,
  serversOrgSetMemberRole,
} from "@/shared/api/client";
import { Button } from "@/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui";
import { useStudioStore } from "@/shared/store";
import { ROLES, type OrgMember, type OrgRole } from "./types";

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
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function setRole(userId: string, role: OrgRole) {
    setBusy(userId);
    try {
      await serversOrgSetMemberRole(profileId, orgId, userId, role);
      onChanged();
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Couldn't change role",
        detail: String(e),
      });
    } finally {
      setBusy(null);
    }
  }

  async function remove(userId: string) {
    if (removing !== userId) {
      setRemoving(userId);
      setTimeout(() => setRemoving((r) => (r === userId ? null : r)), 3000);
      return;
    }
    setBusy(userId);
    try {
      await serversOrgRemoveMember(profileId, orgId, userId);
      pushNotification({ kind: "success", title: "Member removed" });
      onChanged();
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Couldn't remove member",
        detail: String(e),
      });
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
      {members.map((m) => (
        <div
          key={m.user_id}
          className="flex items-center gap-3 rounded-md border px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{m.name}</div>
            <div className="text-muted-foreground text-2xs truncate">
              {m.email}
            </div>
          </div>
          <Select
            value={m.role}
            onValueChange={(v) => void setRole(m.user_id, v as OrgRole)}
          >
            <SelectTrigger
              className="h-7 w-28 text-xs"
              disabled={busy === m.user_id}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size={removing === m.user_id ? "icon" : "default"}
            variant={removing === m.user_id ? "destructive" : "ghost"}
            className="h-7 w-auto shrink-0 px-2"
            disabled={busy === m.user_id}
            title={
              removing === m.user_id
                ? "Click again to confirm"
                : "Remove from organization"
            }
            onClick={() => void remove(m.user_id)}
          >
            <Trash2 className="size-3.5" />
            {removing === m.user_id && (
              <span className="text-3xs ml-0.5">confirm</span>
            )}
          </Button>
        </div>
      ))}
    </div>
  );
}
