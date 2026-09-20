import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@/shared/components/ui";
import type { MeResult, ServerRole } from "@/shared/api/server-admin";
import {
  accessErrorMessage,
  assignableRoles,
  serverAccountSetManageRoles,
  serverAccountSetRole,
  serverAccountsList,
  type ServerAccount,
} from "@/shared/api/server-access";
import { useStudioStore } from "@/shared/store";

/** Accounts on this server and their server roles. An owner can change any
 *  role and turn "Can manage roles" on for an admin. An admin with that switch
 *  on can only move people between member and admin, so owner rows stay read
 *  only for them. The server enforces all of this; the controls just don't
 *  offer what would be refused. */
export function AccessPeopleSection({
  profileId,
  me,
}: {
  profileId: string;
  me: MeResult;
}) {
  const pushNotification = useStudioStore((s) => s.pushNotification);
  const [accounts, setAccounts] = useState<ServerAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const is_owner = me.server_role === "owner";

  const refresh = useCallback(async () => {
    try {
      setAccounts(await serverAccountsList(profileId));
    } catch (e) {
      setAccounts([]);
      pushNotification({
        kind: "error",
        title: "Couldn't load people",
        detail: accessErrorMessage(e),
      });
    }
  }, [profileId, pushNotification]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void refresh();
  }, [refresh]);

  async function change(id: string, work: () => Promise<void>, failed: string) {
    setBusy(id);
    try {
      await work();
      await refresh();
    } catch (e) {
      pushNotification({
        kind: "error",
        title: failed,
        detail: accessErrorMessage(e),
      });
      // The list may have moved on under us (someone else changed a role).
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (accounts === null) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-4 text-xs">
        <Loader2 className="size-3.5 animate-spin" /> Loading people…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {accounts.map((a) => {
        const roles = assignableRoles(me, a.server_role);
        return (
          <div
            key={a.id}
            className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {a.name || a.email}
                {a.id === me.user_id && (
                  <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                    (you)
                  </span>
                )}
              </div>
              <div className="text-muted-foreground text-2xs flex items-center gap-1.5 truncate">
                <span className="truncate">{a.email}</span>
                {a.providers.map((p) => (
                  <Badge key={p} variant="outline" className="text-3xs">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>

            {is_owner && a.server_role === "admin" && (
              <div className="flex items-center gap-2">
                <Label
                  htmlFor={`manage-${a.id}`}
                  className="text-muted-foreground text-xs font-normal"
                >
                  Can manage roles
                </Label>
                <Switch
                  id={`manage-${a.id}`}
                  checked={a.can_manage_roles}
                  disabled={busy === a.id}
                  onCheckedChange={(enabled) =>
                    void change(
                      a.id,
                      () =>
                        serverAccountSetManageRoles(profileId, a.id, enabled),
                      "Couldn't change the switch",
                    )
                  }
                />
              </div>
            )}

            {roles.length === 0 ? (
              <Badge variant="secondary" className="w-28 justify-center">
                {a.server_role}
              </Badge>
            ) : (
              <Select
                value={a.server_role}
                onValueChange={(v) =>
                  void change(
                    a.id,
                    () =>
                      serverAccountSetRole(profileId, a.id, v as ServerRole),
                    "Couldn't change the role",
                  )
                }
              >
                <SelectTrigger
                  className="h-7 w-28 text-xs"
                  disabled={busy === a.id}
                  aria-label={`Role for ${a.email}`}
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
            )}
          </div>
        );
      })}
    </div>
  );
}
