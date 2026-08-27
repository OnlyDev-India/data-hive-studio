import { useMemo, useState } from "react";
import { serversAdminRevokeDevice } from "@/shared/api/client";
import { Trash2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import { useStudioStore } from "@/shared/store";
import type { DeviceInfo } from "./types";

export function DevicesPanel({
  devices,
  filter,
  profileId,
  tokenStrings,
  onTokenClick,
}: {
  devices: DeviceInfo[];
  filter: string;
  profileId: string;
  tokenStrings: Set<string>;
  onTokenClick: (token: string) => void;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const pushNotification = useStudioStore((s) => s.pushNotification);

  const filtered = useMemo(() => {
    if (!filter) return devices;
    return devices.filter(
      (d) =>
        d.user_name.toLowerCase().includes(filter) ||
        (d.team_name ?? "").toLowerCase().includes(filter),
    );
  }, [devices, filter]);

  async function removeDevice(d: DeviceInfo) {
    if (removing !== d.id) {
      setRemoving(d.id);
      setTimeout(() => setRemoving((r) => (r === d.id ? null : r)), 3000);
      return;
    }
    try {
      await serversAdminRevokeDevice(profileId, d.id);
      pushNotification({
        kind: "success",
        title: "Device removed",
        detail: d.user_name,
      });
    } catch {
      setRemoving(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {filtered.map((d) => {
        const tokenDeleted = !tokenStrings.has(d.token);
        return (
          <div
            key={d.id}
            className={cn(
              "rounded-md border p-2.5",
              tokenDeleted && "border-destructive/40 bg-destructive/5",
            )}
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {d.user_name}
                  {d.admin && <Badge>admin</Badge>}
                  {!d.admin && d.team_name && (
                    <Badge variant="secondary">team · {d.team_name}</Badge>
                  )}
                </div>
                <button
                  className={cn(
                    "mt-1 flex items-center gap-1 font-mono text-[11px] transition-colors",
                    tokenDeleted
                      ? "text-destructive/70 cursor-default line-through"
                      : "text-muted-foreground hover:text-foreground cursor-pointer",
                  )}
                  title={
                    tokenDeleted
                      ? "This token has been deleted"
                      : "View token in Tokens tab"
                  }
                  onClick={() => {
                    if (!tokenDeleted) onTokenClick(d.token);
                  }}
                >
                  {tokenDeleted && (
                    <span className="bg-destructive mr-0.5 inline-block size-1.5 rounded-full" />
                  )}
                  {d.token.slice(0, 12)}…
                </button>
              </div>
              <Button
                size="sm"
                variant={removing === d.id ? "destructive" : "ghost"}
                title={
                  removing === d.id
                    ? "Click again to confirm"
                    : "Remove this device and kill its session"
                }
                onClick={() => void removeDevice(d)}
              >
                <Trash2 className="size-3.5" /> Remove
              </Button>
            </div>
          </div>
        );
      })}
      {!filtered.length && (
        <p className="text-muted-foreground text-xs">
          {filter
            ? "No devices match your search."
            : "No devices enrolled yet."}
        </p>
      )}
    </div>
  );
}
