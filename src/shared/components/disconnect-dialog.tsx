import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui";
import { useStudioStore } from "../store";
import { closeConnection } from "../api";
import { CornerDownLeft } from "lucide-react";
import { useShortcuts } from "../hooks/use-shortcut";

/** The single disconnect-confirm dialog, shared by every trigger —
 *  `DisconnectDbBtn` (tab strip / action bar) and the command palette's
 *  disconnect commands ("Disconnect current connection" and `diss:`) all
 *  just call `setDisconnectPendingId(connId)`; this dialog, mounted once as
 *  a singleton in `Studio`, is the only place the confirmation UI and the
 *  actual disconnect logic live. Shows which connection is about to be
 *  disconnected since a trigger can target any open connection, not
 *  necessarily whichever tab is currently focused. */
export function DisconnectDialog() {
  const pending_id = useStudioStore((s) => s.disconnectPendingId);
  const setPendingId = useStudioStore((s) => s.setDisconnectPendingId);
  const closeConn = useStudioStore((s) => s.closeConn);
  const conn = useStudioStore((s) =>
    s.open.find((c) => c.id === s.disconnectPendingId),
  );

  async function handle_disconnect() {
    if (!pending_id) return;
    try {
      await closeConnection(pending_id);
    } finally {
      closeConn(pending_id);
      setPendingId(null);
    }
  }

  // Escape already closes the dialog via Base UI's own built-in dialog
  // behavior — only Enter-to-confirm needs wiring up here.
  useShortcuts([{ key: "Enter", handler: () => void handle_disconnect() }], {
    enabled: pending_id !== null,
  });

  return (
    <Dialog
      open={pending_id !== null}
      onOpenChange={(open) => !open && setPendingId(null)}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disconnect</DialogTitle>
          <DialogDescription>
            {conn
              ? `Disconnect "${conn.name}"? Any unsaved changes will be lost.`
              : "Are you sure you want to disconnect? Any unsaved changes will be lost."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPendingId(null)}>
            Cancel
            <kbd className="bg-muted text-muted-foreground ml-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium">
              ESC
            </kbd>
          </Button>
          <Button variant="secondary" onClick={handle_disconnect}>
            Disconnect
            <kbd className="bg-muted text-muted-foreground ml-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium">
              <CornerDownLeft className="size-4" strokeWidth={1.75} />
            </kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
