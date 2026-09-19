import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui";
import { listUnappliedWorkFor, useStudioStore } from "@/shared/store";

/** Offered after saving edits to a connection that is open (spec 0007). Read
 *  only and the environment label are fixed when a connection connects, so
 *  the new settings apply on a new connection. Reconnecting closes the open
 *  one, and anything in it that is not saved is lost, so this lists what that
 *  is and offers Later. Until the reconnect the old settings hold. */
export function ReconnectDialog({
  conn_ids,
  busy,
  onReconnect,
  onLater,
}: {
  /** The open connections that no longer match their saved settings. `null`
   *  closes the dialog. */
  conn_ids: string[] | null;
  busy: boolean;
  onReconnect: () => void;
  onLater: () => void;
}) {
  const open = conn_ids !== null;
  // Read once per opening: the list is a snapshot of what a reconnect would
  // throw away right now, not something to keep re-deriving on every render.
  const work = useMemo(() => {
    const state = useStudioStore.getState();
    return (conn_ids ?? []).flatMap((id) => listUnappliedWorkFor(state, id));
  }, [conn_ids]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onLater()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reconnect to apply your changes?</DialogTitle>
          <DialogDescription>
            Read only and the environment label take effect on a new connection.
            Until you reconnect, the open connection keeps its old settings.
          </DialogDescription>
        </DialogHeader>
        {work.length > 0 && (
          <div className="flex flex-col gap-1.5 text-sm">
            <p className="text-destructive">
              Reconnecting closes the open connection, so this would be lost:
            </p>
            <ul className="bg-muted/30 flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border p-3">
              {work.map((item, i) => (
                <li key={i} className="flex flex-col">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-muted-foreground text-xs">
                    {item.parts.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onLater} disabled={busy}>
            Later
          </Button>
          <Button onClick={onReconnect} disabled={busy}>
            <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} />
            {busy ? "Reconnecting…" : "Reconnect now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
