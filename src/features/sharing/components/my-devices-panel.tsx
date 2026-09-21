import { useCallback, useEffect, useState } from "react";
import { Globe, Loader2, Monitor } from "lucide-react";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import {
  serversSessionEnd,
  serversSessionsEndAll,
  serversSessionsList,
  type DeviceSession,
} from "@/shared/api/server-sessions";

/** How long ago a device was last used, in plain words. */
export function lastUsedLabel(last_used_ms: number, now: number): string {
  const minutes = Math.floor((now - last_used_ms) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * My devices: every device signed in as you on this server, with a Sign out
 * for each and Sign out everywhere. The server only ever lists your own
 * devices. Ending this device (or everywhere) ends your session here too, so
 * `onSignedOut` runs and the caller shows the server as signed out.
 */
export function MyDevicesPanel({
  profileId,
  serverName,
  onSignedOut,
}: {
  profileId: string;
  serverName: string;
  /** This device's session ended (from its own row or Sign out everywhere). */
  onSignedOut: () => void;
}) {
  const [devices, setDevices] = useState<DeviceSession[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  // When the list was loaded, so "last used" is measured from a fixed moment.
  const [loadedAt, setLoadedAt] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoadError(null);
    setDevices(null);
    try {
      setDevices(await serversSessionsList(profileId));
      setLoadedAt(Date.now());
    } catch (e) {
      setLoadError(String(e));
    }
  }, [profileId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load();
    setConfirmAll(false);
    setActionError(null);
  }, [load]);

  async function endOne(device: DeviceSession) {
    setBusyId(device.id);
    setActionError(null);
    try {
      const signedOut = await serversSessionEnd(profileId, device);
      if (signedOut) {
        onSignedOut();
      } else {
        setDevices((d) => d?.filter((x) => x.id !== device.id) ?? d);
      }
    } catch (e) {
      setActionError(`Couldn't sign that device out: ${String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function endAll() {
    setBusyId("all");
    setActionError(null);
    try {
      await serversSessionsEndAll(profileId);
      onSignedOut();
    } catch (e) {
      setActionError(`Couldn't sign out everywhere: ${String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold">My devices</h2>
        <p className="text-muted-foreground text-xs">
          Every device signed in to {serverName} as you. Sign out any you don't
          recognise or no longer use.
        </p>
      </div>

      {loadError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="border-destructive/40 bg-destructive/10 text-destructive w-full rounded-md border px-3 py-2 text-xs">
            Couldn't load your devices: {loadError}
          </p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : devices === null ? (
        <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
          <Loader2 className="size-4 animate-spin" /> Loading your devices…
        </div>
      ) : (
        <ul className="divide-y rounded-md border" aria-label="Devices">
          {devices.map((d) => {
            const Icon = d.platform === "web" ? Globe : Monitor;
            return (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                <Icon className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {d.device_name}
                    </span>
                    {d.current && <Badge variant="success">This device</Badge>}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {d.platform === "web" ? "Web" : "Desktop app"} · Last used{" "}
                    {lastUsedLabel(d.last_used_ms, loadedAt).toLowerCase()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyId !== null}
                  aria-label={`Sign out ${d.device_name}`}
                  onClick={() => void endOne(d)}
                >
                  {busyId === d.id && (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  )}
                  Sign out
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {actionError && (
        <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs">
          {actionError}
        </p>
      )}

      {devices !== null && !loadError && (
        <div className="flex flex-col gap-2 border-t pt-3">
          {confirmAll ? (
            <>
              <p className="text-sm">
                This signs out every device, including this one. You'll need to
                sign in again on each.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busyId !== null}
                  onClick={() => void endAll()}
                >
                  {busyId === "all" && (
                    <Loader2 className="mr-1 size-3.5 animate-spin" />
                  )}
                  Sign out everywhere
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busyId !== null}
                  onClick={() => setConfirmAll(false)}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              disabled={busyId !== null}
              onClick={() => setConfirmAll(true)}
            >
              Sign out everywhere
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
