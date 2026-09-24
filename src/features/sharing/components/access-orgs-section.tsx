import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Label } from "@/shared/components/ui/label";
import { Switch } from "@/shared/components/ui";
import {
  accessErrorMessage,
  serverOrgsList,
  serverSetOpenOrgCreation,
  serverSettingsGet,
  type ServerOrg,
} from "@/shared/api/server-access";
import { useStudioStore } from "@/shared/store";

/** Server owner only: who may create organizations, and every org on this
 *  server. The list is names and counts, never another org's members,
 *  invites or connections. */
export function AccessOrgsSection({ profileId }: { profileId: string }) {
  const pushNotification = useStudioStore((s) => s.pushNotification);
  const [orgs, setOrgs] = useState<ServerOrg[] | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [list, settings] = await Promise.all([
        serverOrgsList(profileId),
        serverSettingsGet(profileId),
      ]);
      setOrgs(list);
      setOpen(settings.open_org_creation);
    } catch (e) {
      setOrgs([]);
      pushNotification({
        kind: "error",
        title: "Couldn't load organizations",
        detail: accessErrorMessage(e),
      });
    }
  }, [profileId, pushNotification]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount
    void refresh();
  }, [refresh]);

  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      await serverSetOpenOrgCreation(profileId, enabled);
      setOpen(enabled);
    } catch (e) {
      pushNotification({
        kind: "error",
        title: "Couldn't change the setting",
        detail: accessErrorMessage(e),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (orgs === null || open === null) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-4 text-xs">
        <Loader2 className="size-3.5 animate-spin" /> Loading organizations…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3 rounded-md border px-3 py-2">
        <div className="min-w-0 flex-1">
          <Label htmlFor="open-org-creation" className="text-sm font-medium">
            Anyone signed in can create an organization
          </Label>
          <p className="text-muted-foreground text-2xs">
            Each person can create one. When this is off, only you, and admins
            you switch on under Server accounts, can create organizations.
            Turning it off never removes an organization.
          </p>
        </div>
        <Switch
          id="open-org-creation"
          checked={open}
          disabled={busy}
          onCheckedChange={(enabled) => void toggle(enabled)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        {orgs.length === 0 && (
          <p className="text-muted-foreground text-xs">
            No organizations on this server yet.
          </p>
        )}
        {orgs.map((o) => (
          <div
            key={o.id}
            className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{o.name}</div>
              <div className="text-muted-foreground text-2xs truncate">
                Owners: {o.owners.join(", ") || "none"} · Created by{" "}
                {o.created_by ?? "unknown"}
              </div>
            </div>
            <span className="text-muted-foreground text-xs">
              {o.member_count} {o.member_count === 1 ? "member" : "members"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
