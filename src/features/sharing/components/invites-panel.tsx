import { useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { serversOrgInviteRevoke } from "@/shared/api/client";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { useStudioStore } from "@/shared/store";
import type { OrgInvite } from "./types";

export function InvitesPanel({
  invites,
  profileId,
  orgId,
  onRefresh,
}: {
  invites: OrgInvite[];
  profileId: string;
  orgId: string;
  onRefresh: () => void;
}) {
  const pushNotification = useStudioStore((s) => s.pushNotification);
  const [revoking, setRevoking] = useState<string | null>(null);
  // Snapshot once on mount rather than calling Date.now() during render
  // (react-hooks/purity) — "expired" is a display hint refreshed on the
  // next refetch anyway, doesn't need to tick live.
  const [now] = useState(() => Date.now());

  if (!invites.length) {
    return (
      <p className="text-muted-foreground py-4 text-xs">
        No invite codes yet — create one above.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {invites.map((inv) => {
        const expired = inv.expires_ms != null && inv.expires_ms < now;
        const exhausted =
          inv.max_uses != null && inv.uses_count >= inv.max_uses;
        const dead = expired || exhausted;
        return (
          <div
            key={inv.code}
            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <Badge
              variant={dead ? "secondary" : "default"}
              className="shrink-0"
            >
              {inv.role}
            </Badge>
            <code className="min-w-0 flex-1 truncate font-mono text-xs">
              {inv.code}
            </code>
            <span className="text-muted-foreground shrink-0 text-2xs">
              {inv.uses_count}
              {inv.max_uses != null ? `/${inv.max_uses}` : ""} used
              {expired && " · expired"}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="size-6 shrink-0"
              title="Copy invite code"
              onClick={() => {
                void navigator.clipboard.writeText(inv.code);
                pushNotification({
                  kind: "success",
                  title: "Copied invite code",
                });
              }}
            >
              <Copy className="size-3" />
            </Button>
            <Button
              size={revoking === inv.code ? "icon" : "default"}
              variant={revoking === inv.code ? "destructive" : "ghost"}
              className="h-6 w-auto shrink-0 px-2"
              title={
                revoking === inv.code
                  ? "Click again to confirm"
                  : "Revoke invite"
              }
              onClick={() => {
                if (revoking !== inv.code) {
                  setRevoking(inv.code);
                  setTimeout(
                    () => setRevoking((r) => (r === inv.code ? null : r)),
                    3000,
                  );
                  return;
                }
                void serversOrgInviteRevoke(profileId, orgId, inv.code)
                  .then(() => {
                    pushNotification({
                      kind: "success",
                      title: "Invite revoked",
                    });
                    onRefresh();
                  })
                  .catch((e: unknown) => {
                    pushNotification({
                      kind: "error",
                      title: "Revoke failed",
                      detail: String(e),
                    });
                  })
                  .finally(() => setRevoking(null));
              }}
            >
              <Trash2 className="size-3" />
              {revoking === inv.code && (
                <span className="ml-0.5 text-3xs">confirm</span>
              )}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
